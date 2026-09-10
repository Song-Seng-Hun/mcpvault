"""Local, data-only PDF worker. No default model downloads or document network IO.

The parent owns the hard deadline, memory limit, sandbox, private temp directory,
queue and cache. The cooperative deadline here cannot interrupt a native library.
"""
import argparse
import contextlib
import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import sys
import time

MAX_INPUT_BYTES = 50 * 1024 * 1024
MAX_PAGE_BYTES = 4 * 1024 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
MAX_PAGES = 200
MAX_REGIONS = 20_000
PROFILE = 'mcpvault-pdf-v1'
PINS = {'docling-slim': '2.126.0', 'docling-core': '2.95.0',
        'docling-parse': '7.18.0', 'pypdfium2': '5.13.0'}
ENRICHMENT_PINS = {'docling-ibm-models': '4.0.2', 'torch': '2.10.0'}
OCR_PINS = {'rapidocr': '3.9.2', 'onnxruntime': '1.23.2'}
# RapidOCR defaults upscale the shortest side of narrow crops to 736 pixels,
# allowing an extremely wide detector tensor. Cap its longest side and internal
# batches independently of the host's memory budget. Include these in the
# extraction profile; the backend maps resized coordinates back to PDF points.
OCR_LIMITS = {'Det.limit_type': 'max', 'Det.limit_side_len': 960,
              'Rec.rec_batch_num': 1, 'Cls.cls_batch_num': 1}
# The v4 Chinese direction classifier confidently flips upright Korean lines.
# Do not apply that destructive rotation; upside-down text is not auto-corrected.
OCR_USE_CLS = False
OCR_SCAN_MODE = 'full_page'
OCR_MIXED_MODE = 'pdf_aware_layout_regions'


class WorkerError(Exception):
    def __init__(self, code, exit_status=3):
        super().__init__(code)
        self.code = code
        self.exit_status = exit_status


@contextlib.contextmanager
def offline_runtime():
    """Best-effort local-only guards; the parent must also deny OS-level egress.

    Global environment/socket changes are suitable only for this single-job
    process, not for embedding run_job in a concurrent Python application.
    """
    environment = {key: '2' for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS',
        'OPENBLAS_NUM_THREADS', 'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS')}
    environment.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_DATASETS_OFFLINE='1',
                       HF_HUB_DISABLE_TELEMETRY='1', DO_NOT_TRACK='1', TOKENIZERS_PARALLELISM='false')
    # Host debug/download overrides must not activate file exports or remote IO.
    inherited_docling = {key: value for key, value in os.environ.items() if key.startswith('DOCLING_')}
    old = {key: os.environ.get(key) for key in environment}
    calls = [(socket, 'create_connection'), (socket.socket, 'connect'),
             (socket.socket, 'connect_ex'), (socket, 'getaddrinfo')]
    originals = [getattr(owner, name) for owner, name in calls]
    def denied(*args, **kwargs):
        raise WorkerError('network_disabled', 2)
    try:
        for key in inherited_docling:
            os.environ.pop(key, None)
        os.environ.update(environment)
        for owner, name in calls:
            setattr(owner, name, denied)
        with open(os.devnull, 'w', encoding='utf-8') as sink:
            with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                yield
    finally:
        for (owner, name), original in zip(calls, originals):
            setattr(owner, name, original)
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        os.environ.update(inherited_docling)


def gap(code, severity='warning'):
    return {'code': code, 'severity': severity}


def empty_result():
    return {'version': 1, 'sourceSha256': None, 'profile': PROFILE,
            'pages': [], 'gaps': [], 'metrics': {
                'inputBytes': 0, 'totalPages': None, 'requestedPages': 0,
                'processedPages': 0, 'failedPages': 0, 'threads': 2,
                'elapsedMs': 0, 'exitCode': 0}}


def fail(result, code, status):
    result['gaps'].append(gap(code, 'error'))
    result['metrics']['exitCode'] = status
    return result


def failed_page(number, code):
    return {'page': number, 'text': '', 'regions': [], 'status': 'failed',
            'gaps': [gap(code, 'error')]}


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      separators=(',', ':')).encode('utf-8')


def assemble_page(number, data):
    """Join extracted chunks; offsets index the returned text, never PDF bytes."""
    chunks, regions, notes = [], [], [gap(code) for code in dict.fromkeys(data.get('gaps', []))]
    offset = 0
    byte_count = 0
    for count, chunk in enumerate(data['chunks']):
        if count >= MAX_REGIONS:
            return failed_page(number, 'region_budget_exceeded')
        text = chunk['text']
        if not isinstance(text, str):
            return failed_page(number, 'invalid_backend_text')
        if not text:
            continue
        try:
            # Cheap bound before JSON escaping and region serialization.
            byte_count += len(text.encode('utf-8')) + 1
            length = len(text.encode('utf-16-le')) // 2
        except UnicodeError:
            return failed_page(number, 'invalid_backend_text')
        if byte_count > MAX_PAGE_BYTES:
            return failed_page(number, 'output_budget_exceeded')
        if chunks:
            offset += 1  # exactly one synthetic LF between source chunks
        chunks.append(text)
        bbox = chunk.get('bbox')
        if (isinstance(bbox, (list, tuple)) and len(bbox) == 4
                and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in bbox)
                and 0 <= bbox[0] <= bbox[2] and 0 <= bbox[1] <= bbox[3]):
            kind = chunk.get('kind', 'text')
            if not isinstance(kind, str) or not re.fullmatch(r'[a-zA-Z_]{1,48}', kind):
                kind = 'text'
            regions.append({'startOffset': offset, 'endOffset': offset + length,
                            'bbox': list(bbox), 'kind': kind})
        elif gap('bbox_unavailable') not in notes:
            notes.append(gap('bbox_unavailable'))
        offset += length
    text = '\n'.join(chunks)
    if not text.strip():
        notes.append(gap('no_extractable_text', 'error'))
    incomplete = {'enrichment_failed', 'invalid_provenance', 'unlocated_content',
                  'table_page_mapping_unavailable', 'table_cells_unavailable', 'page_extraction_failed'}
    for note in notes:
        if note['code'] in incomplete:
            note['severity'] = 'error'
    page = {'page': number, 'text': text, 'regions': regions,
            'status': 'ok' if text.strip() and not any(n['severity'] == 'error' for n in notes) else 'failed', 'gaps': notes}
    if len(json_bytes(page)) > MAX_PAGE_BYTES:
        return failed_page(number, 'output_budget_exceeded')
    return page


def lexical_path(value):
    """Reject URL/UNC/device/ADS paths before any filesystem operation."""
    value = os.fspath(value)
    if not value or '\x00' in value or '://' in value or value.startswith(('\\\\', '//')):
        raise WorkerError('input_unavailable')
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts:
        raise WorkerError('input_unavailable')
    if ':' in value[len(path.drive):]:
        raise WorkerError('input_unavailable')
    return path


def local_path(value, *, trusted_root=None):
    """Check links within a broker-pinned Windows root, or all ancestors.

    A trusted root is a native-host contract, NOT a caller-supplied permission:
    the broker rejects these flags from callers, audits canonical ancestors and
    retains no-delete handles through child exit. The AppContainer cannot query
    ancestor metadata above its private grants. Standalone use keeps full checks.
    """
    path = lexical_path(value)
    components = [path, *path.parents]
    if trusted_root is not None:
        root = lexical_path(trusted_root)
        if os.name != 'nt' or len(root.parts) < 3 or not path.is_relative_to(root):
            raise WorkerError('input_unavailable')
        components = components[:components.index(root) + 1]
    for component in components:
        info = component.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise WorkerError('input_unavailable')
        if component != path and not stat.S_ISDIR(info.st_mode):
            raise WorkerError('input_unavailable')
    return path


def read_pdf(path, *, trusted_root=None):
    try:
        path = local_path(path, trusted_root=trusted_root)
        info = path.stat()
        if not stat.S_ISREG(info.st_mode):
            raise WorkerError('input_unavailable')
        if info.st_size > MAX_INPUT_BYTES:
            raise WorkerError('input_budget_exceeded')
        with path.open('rb') as stream:
            opened = os.fstat(stream.fileno())
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise WorkerError('source_changed')
            data = stream.read(MAX_INPUT_BYTES + 1)
            after = os.fstat(stream.fileno())
            if (opened.st_size, opened.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise WorkerError('source_changed')
        if len(data) > MAX_INPUT_BYTES:
            raise WorkerError('input_budget_exceeded')
        return data
    except (OSError, ValueError) as exc:
        raise WorkerError('input_unavailable') from exc


def dependency_report(layout=False, ocr=False):
    pins = dict(PINS)
    if layout or ocr:
        pins.update(ENRICHMENT_PINS)
    if ocr:
        pins.update(OCR_PINS)
    report = []
    for name, expected in pins.items():
        try:
            installed = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            installed = None
        report.append({'name': name, 'expected': expected, 'installed': installed,
                       'status': 'ok' if installed == expected else 'missing' if installed is None else 'version_mismatch'})
    return report


def check_environment(*, layout=False, ocr=False, model_manifest=None, model_root=None):
    result = empty_result()
    report = dependency_report(layout, ocr)
    result['metrics'].update(check=True, dependencies=report, available=False,
                             backendProbe='not_run', models='not_required')
    if any(row['status'] != 'ok' for row in report):
        fail(result, 'dependencies_unavailable', 2)
    if layout or ocr:
        try:
            models = validate_manifest(model_manifest, ocr=ocr, trusted_root=model_root)
            result['metrics']['models'] = models['fingerprint']
        except WorkerError as exc:
            result['metrics']['models'] = 'unavailable'
            fail(result, exc.code, exc.exit_status)
    result['metrics']['available'] = result['metrics']['exitCode'] == 0
    return result


def configured_profile(settings, models, report):
    material = {'pins': report, 'layout': settings['layout'], 'ocr': settings['ocr'],
                'models': models['fingerprint'] if models else None,
                'python': list(sys.version_info[:2]), 'threads': 2}
    if settings['ocr']:
        material['ocrLimits'] = OCR_LIMITS
        material['ocrUseCls'] = OCR_USE_CLS
        material['ocrModes'] = [OCR_SCAN_MODE, OCR_MIXED_MODE]
    return PROFILE + ':' + hashlib.sha256(json_bytes(material)).hexdigest()


@offline_runtime()
def run_job(input_path, *, max_pages=200, timeout_seconds=120, pages=None,
            layout=False, ocr=False, model_manifest=None, expected_sha256=None,
            backend_factory=None, clock=time.monotonic, input_root=None, model_root=None):
    result = empty_result()
    start = clock()
    backend = None
    try:
        if (type(max_pages) is not int or not 1 <= max_pages <= MAX_PAGES
                or not isinstance(timeout_seconds, (float, int)) or isinstance(timeout_seconds, bool)
                or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 3600):
            raise WorkerError('invalid_arguments')
        if pages is not None and (not pages or len(pages) > MAX_PAGES
                or any(type(p) is not int or not 1 <= p <= max_pages for p in pages)):
            raise WorkerError('invalid_arguments')
        selected = tuple(sorted(set(pages))) if pages is not None else None
        settings = {'max_pages': max_pages, 'timeout': timeout_seconds,
                    'pages': selected, 'layout': layout, 'ocr': ocr}
        raw = read_pdf(input_path, trusted_root=input_root)
        result['metrics']['inputBytes'] = len(raw)
        result['sourceSha256'] = hashlib.sha256(raw).hexdigest()
        if not re.match(br'%PDF-\d\.\d', raw[:8]):
            raise WorkerError('invalid_pdf')
        if expected_sha256 is not None and expected_sha256 != result['sourceSha256']:
            raise WorkerError('source_hash_mismatch')
        models = validate_manifest(model_manifest, ocr=ocr, trusted_root=model_root) if layout or ocr else None
        report = dependency_report(layout, ocr) if backend_factory is None else [{'name': 'test-backend', 'status': 'test'}]
        result['profile'] = configured_profile(settings, models, report)
        if backend_factory is None and any(row['status'] != 'ok' for row in report):
            result['metrics']['dependencies'] = report
            raise WorkerError('dependencies_unavailable', 2)
        remaining = timeout_seconds - (clock() - start)
        if remaining <= 0:
            raise WorkerError('timeout', 4)
        settings['timeout'] = remaining
        backend = (backend_factory or DoclingBackend)(raw, settings, models)
        count = backend.page_count
        if type(count) is not int or count < 1:
            raise WorkerError('invalid_pdf')
        result['metrics']['totalPages'] = count
        if count > max_pages:
            raise WorkerError('page_budget_exceeded')
        if selected and selected[-1] > count:
            raise WorkerError('page_selection_out_of_range')
        selected = selected or tuple(range(1, count + 1))
        result['metrics']['requestedPages'] = len(selected)
        output_size = 64 * 1024  # reserve bounded metadata and failure placeholders
        for number in selected:
            if clock() - start >= timeout_seconds:
                page = failed_page(number, 'timeout')
            else:
                try:
                    data = backend.native_page(number)
                    needs_ocr = ocr and (data.get('hasImages') or not any(c['text'].strip() for c in data['chunks']))
                    if layout or needs_ocr:
                        remaining = timeout_seconds - (clock() - start)
                        if remaining <= 0:
                            raise WorkerError('timeout', 4)
                        try:
                            data = backend.enhanced_page(number, ocr=bool(needs_ocr), timeout=remaining)
                        except Exception:
                            data['gaps'] = [*data.get('gaps', []), 'enrichment_failed']
                    elif data.get('hasImages'):
                        data['gaps'] = [*data.get('gaps', []), 'image_text_not_extracted']
                    if not any(c['text'].strip() for c in data['chunks']) and not ocr:
                        data['gaps'] = [*data.get('gaps', []), 'ocr_unavailable']
                    page = assemble_page(number, data)
                    if clock() - start >= timeout_seconds:
                        page = failed_page(number, 'timeout')
                except WorkerError as exc:
                    page = failed_page(number, exc.code)
                except Exception:
                    page = failed_page(number, 'page_extraction_failed')
            size = len(json_bytes(page))
            if output_size + size > MAX_OUTPUT_BYTES:
                page = failed_page(number, 'output_budget_exceeded')
                size = len(json_bytes(page))
            output_size += size
            result['pages'].append(page)
        failed = sum(p['status'] == 'failed' for p in result['pages'])
        result['metrics'].update(processedPages=len(selected) - failed, failedPages=failed,
                                 exitCode=4 if failed else 0)
    except WorkerError as exc:
        fail(result, exc.code, exc.exit_status)
    except (ImportError, ModuleNotFoundError):
        fail(result, 'dependencies_unavailable', 2)
    except Exception:
        fail(result, 'backend_failed', 5)
    finally:
        if backend is not None:
            try:
                backend.close()
            except Exception:
                fail(result, 'backend_cleanup_failed', 5)
        result['metrics']['elapsedMs'] = max(0, round((clock() - start) * 1000))
    return result


def validate_manifest(path, *, ocr=False, trusted_root=None):
    """Validate an operator-owned, complete local bundle before loading models.

    This proves pins/file integrity, not model quality or that a Docling pipeline
    can initialize. Model packages and the containing directory must be trusted.
    """
    try:
        manifest_path = local_path(path, trusted_root=trusted_root)
        with manifest_path.open('rb') as stream:
            raw = stream.read(128 * 1024 + 1)
        if len(raw) > 128 * 1024:
            raise WorkerError('models_unavailable', 2)
        def unique_keys(pairs):
            value = {}
            for key, item in pairs:
                if key in value:
                    raise WorkerError('models_unavailable', 2)
                value[key] = item
            return value
        manifest = json.loads(raw, object_pairs_hook=unique_keys)
        if (manifest.get('version') != 1 or manifest.get('docling') != PINS['docling-slim']
                or not isinstance(manifest.get('layout'), dict)
                or not isinstance(manifest['layout'].get('revision'), str)
                or not 1 <= len(manifest['layout']['revision']) <= 128):
            raise WorkerError('models_unavailable', 2)
        if 'table' in manifest and (not isinstance(manifest['table'], dict)
                or not isinstance(manifest['table'].get('revision'), str)
                or not 1 <= len(manifest['table']['revision']) <= 128):
            raise WorkerError('models_unavailable', 2)
        root = local_path(manifest['artifactsRoot'], trusted_root=trusted_root)
        if not root.is_dir():
            raise WorkerError('models_unavailable', 2)
        files = manifest['files']
        if not isinstance(files, list) or not 1 <= len(files) <= 256:
            raise WorkerError('models_unavailable', 2)
        verified = {}
        total = 0
        for entry in files:
            name = entry['path']
            digest = entry['sha256']
            if (not isinstance(name, str) or not 1 <= len(name) <= 512
                    or '\\' in name or ':' in name or name.startswith('/')
                    or any(p in ('', '.', '..') for p in name.split('/'))
                    or name in verified or not re.fullmatch(r'[a-f0-9]{64}', digest)):
                raise WorkerError('models_unavailable', 2)
            target = local_path(root / name, trusted_root=trusted_root)
            size = target.stat().st_size
            total += size
            if not target.is_file() or size > 512 * 1024 * 1024 or total > 2 * 1024 * 1024 * 1024:
                raise WorkerError('model_budget_exceeded', 2)
            sha = hashlib.sha256()
            read = 0
            with target.open('rb') as stream:
                while block := stream.read(1024 * 1024):
                    read += len(block)
                    if read > size:
                        raise WorkerError('model_hash_mismatch', 2)
                    sha.update(block)
            if read != size or sha.hexdigest() != digest:
                raise WorkerError('model_hash_mismatch', 2)
            verified[name] = str(target)
        # Reject extra, unpinned artifacts; also stop directory floods and links.
        encountered = set()
        directories = [root]
        entries_seen = 0
        while directories:
            directory = directories.pop()
            for child in directory.iterdir():
                entries_seen += 1
                if entries_seen > 1024:
                    raise WorkerError('model_budget_exceeded', 2)
                local_path(child, trusted_root=trusted_root)
                if child.is_dir():
                    directories.append(child)
                elif child.is_file():
                    encountered.add(child.relative_to(root).as_posix())
                else:
                    raise WorkerError('models_unavailable', 2)
        if encountered != set(verified):
            raise WorkerError('model_manifest_incomplete', 2)
        if ocr:
            config = manifest['rapidocr']
            required = {'version': OCR_PINS['rapidocr'], 'onnxruntime': OCR_PINS['onnxruntime'],
                        'engine': 'onnxruntime', 'language': 'korean', 'ocrVersion': 'PP-OCRv5'}
            if any(config.get(key) != value for key, value in required.items()):
                raise WorkerError('models_unavailable', 2)
            if not isinstance(config.get('revision'), str) or not 1 <= len(config['revision']) <= 128:
                raise WorkerError('models_unavailable', 2)
            for key in ('detection', 'classification', 'recognition', 'keys'):
                if config[key] not in verified:
                    raise WorkerError('models_unavailable', 2)
            if any(not config[key].endswith('.onnx') for key in ('detection', 'classification', 'recognition')):
                raise WorkerError('models_unavailable', 2)
        # Paths do not affect extraction identity; content pins/configuration do.
        identity = {key: value for key, value in manifest.items() if key != 'artifactsRoot'}
        identity['files'] = sorted(files, key=lambda item: item['path'])
        fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        return {'root': root, 'files': verified, 'manifest': manifest, 'fingerprint': fingerprint}
    except WorkerError:
        raise
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        raise WorkerError('models_unavailable', 2) from exc


def bbox_top_left(bbox, height):
    if bbox is None:
        return None
    origin = getattr(bbox.coord_origin, 'value', bbox.coord_origin)
    if origin == 'TOPLEFT':
        return [bbox.l, bbox.t, bbox.r, bbox.b]
    if origin == 'BOTTOMLEFT' and isinstance(height, (int, float)) and math.isfinite(height):
        return [bbox.l, height - bbox.t, bbox.r, height - bbox.b]
    return None


def normalize_docling(document):
    """Extract source-provenanced items; never export generated Markdown as text."""
    pages = {int(number): {'chunks': [], 'gaps': [], 'hasImages': False}
             for number in document.pages}
    for count, (item, _depth) in enumerate(document.iterate_items()):
        if count >= MAX_REGIONS * MAX_PAGES:
            raise WorkerError('region_budget_exceeded', 4)
        kind = getattr(getattr(item, 'label', None), 'value', 'text')
        provenance = getattr(item, 'prov', [])
        text = getattr(item, 'text', None)
        if text and not provenance:
            for page in pages.values():
                page['gaps'].append('unlocated_content')
        if kind in ('table', 'document_index'):
            page_numbers = {prov.page_no for prov in provenance}
            if len(page_numbers) != 1:
                for number in page_numbers & pages.keys():
                    pages[number]['gaps'].append('table_page_mapping_unavailable')
                continue
            number = next(iter(page_numbers))
            if number not in pages:
                continue
            height = document.pages[number].size.height
            cells = getattr(getattr(item, 'data', None), 'table_cells', [])
            if not cells:
                pages[number]['gaps'].append('table_cells_unavailable')
            for cell in cells:
                pages[number]['chunks'].append({'text': cell.text,
                    'bbox': bbox_top_left(cell.bbox, height),
                    'kind': 'tableHeader' if cell.column_header else 'tableCell'})
            continue
        for prov in provenance:
            if prov.page_no not in pages:
                continue
            page = pages[prov.page_no]
            if kind == 'picture':
                page['hasImages'] = True
                continue
            if text is None:
                continue
            span = prov.charspan
            if (len(span) != 2 or any(type(v) is not int for v in span)
                    or not 0 <= span[0] <= span[1] <= len(text)
                    or (text and span[0] == span[1])):
                page['gaps'].append('invalid_provenance')
                continue
            page['chunks'].append({'text': text[span[0]:span[1]],
                'bbox': bbox_top_left(prov.bbox, document.pages[prov.page_no].size.height), 'kind': kind})
    return pages


class DoclingBackend:
    def __init__(self, raw, settings, models):
        # All optional imports are lazy. The native pipeline has no model stage.
        from docling.document_converter import DocumentConverter, NativePdfFormatOption
        from docling.datamodel.base_models import InputFormat, DocumentStream
        from docling.datamodel.pipeline_options import NativePdfPipelineOptions
        self.raw = raw
        self.settings = settings
        self.models = models
        self._stream = DocumentStream
        self._pdf = InputFormat.PDF
        self._enhanced = {}
        options = NativePdfPipelineOptions(parser_threads=2,
            generate_picture_images=False, generate_page_images=False,
            enable_remote_services=False, allow_external_plugins=False,
            document_timeout=settings['timeout'])
        converter = DocumentConverter(allowed_formats=[self._pdf],
            format_options={self._pdf: NativePdfFormatOption(pipeline_options=options)})
        self._native = {}
        self.page_count = 0
        selected = settings['pages']
        # Sparse resume processes each selected page once; normal conversion is one batch.
        ranges = [(p, p) for p in selected] if selected else [(1, settings['max_pages'])]
        start = time.monotonic()
        for page_range in ranges:
            remaining = settings['timeout'] - (time.monotonic() - start)
            if remaining <= 0:
                break
            options.document_timeout = remaining
            converted = converter.convert(self._stream(name='source.pdf', stream=io.BytesIO(raw)),
                raises_on_error=False, max_num_pages=settings['max_pages'],
                max_file_size=MAX_INPUT_BYTES, page_range=page_range)
            self.page_count = converted.input.page_count
            if self.page_count > settings['max_pages']:
                raise WorkerError('page_budget_exceeded')
            if self.page_count < 1:
                raise WorkerError('invalid_pdf')
            normalized = normalize_docling(converted.document)
            for item in normalized.values():
                item['gaps'].append('reading_order_unverified')
            for error in converted.errors:
                number = getattr(error, 'page_no', None)
                if number in normalized:
                    normalized[number]['gaps'].append('page_extraction_failed')
            self._native.update(normalized)

    def native_page(self, number):
        if number not in self._native:
            raise WorkerError('page_extraction_failed', 4)
        return self._native[number]

    def enhanced_page(self, number, *, ocr, timeout):
        if self.models is None:
            raise WorkerError('models_unavailable', 2)
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
        from docling.datamodel.backend_options import ThreadedDoclingParseBackendOptions
        from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
        import torch
        torch.set_num_threads(2)
        # PyTorch allows inter-op configuration only before its first parallel work.
        if not self._enhanced:
            torch.set_num_interop_threads(1)
        tables = self.settings['layout'] and 'table' in self.models['manifest']
        # Full-page OCR avoids narrow layout crops on scans. Mixed pages retain
        # PDF-first merging so recognized pixels cannot replace native text.
        native_text = any(c['text'].strip() for c in self._native[number]['chunks'])
        mode = (OCR_MIXED_MODE if native_text else OCR_SCAN_MODE) if ocr else None
        cache_key = (ocr, mode)
        options = PdfPipelineOptions(artifacts_path=self.models['root'],
            enable_remote_services=False, allow_external_plugins=False,
            do_ocr=ocr, do_table_structure=tables, document_timeout=timeout,
            do_picture_description=False, do_picture_classification=False, do_chart_extraction=False,
            do_code_enrichment=False, do_formula_enrichment=False,
            generate_page_images=False, generate_picture_images=False,
            accelerator_options=AcceleratorOptions(num_threads=2, device=AcceleratorDevice.CPU),
            ocr_batch_size=1, layout_batch_size=1, table_batch_size=1, queue_max_size=2)
        if ocr:
            import onnxruntime
            from rapidocr import OCRVersion, ModelType
            onnxruntime.disable_telemetry_events()
            config = self.models['manifest']['rapidocr']
            paths = self.models['files']
            options.ocr_options = RapidOcrOptions(backend='onnxruntime', lang=['korean'], mode=mode,
                det_model_path=paths[config['detection']], cls_model_path=paths[config['classification']],
                rec_model_path=paths[config['recognition']], rec_keys_path=paths[config['keys']],
                use_det=True, use_cls=OCR_USE_CLS, use_rec=True, print_verbose=False,
                rapidocr_params={**OCR_LIMITS, 'Det.ocr_version': OCRVersion.PPOCRV5,
                                 'Rec.ocr_version': OCRVersion.PPOCRV5,
                                 'Cls.ocr_version': OCRVersion.PPOCRV4,
                                 'Det.model_type': ModelType.MOBILE,
                                 'Rec.model_type': ModelType.MOBILE,
                                 'Cls.model_type': ModelType.MOBILE,
                                 'Rec.lang_type': 'korean',
                                 'EngineConfig.onnxruntime.intra_op_num_threads': 2,
                                 'EngineConfig.onnxruntime.inter_op_num_threads': 1})
        converter = self._enhanced.get(cache_key)
        if converter is None:
            converter = DocumentConverter(allowed_formats=[self._pdf],
                format_options={self._pdf: PdfFormatOption(pipeline_options=options,
                    backend_options=ThreadedDoclingParseBackendOptions(parser_threads=2))})
            self._enhanced[cache_key] = converter
        # Keep cached options stable: changing their hash would load models again.
        # The parent hard deadline and run_job's between-page checks still apply.
        converted = converter.convert(self._stream(name='source.pdf', stream=io.BytesIO(self.raw)),
            raises_on_error=False, max_num_pages=self.settings['max_pages'],
            max_file_size=MAX_INPUT_BYTES, page_range=(number, number))
        if converted.errors:
            raise WorkerError('enrichment_failed', 4)
        page = normalize_docling(converted.document).get(number)
        if page is None or not any(chunk['text'].strip() for chunk in page['chunks']):
            raise WorkerError('enrichment_failed', 4)
        if page['gaps']:
            raise WorkerError('enrichment_failed', 4)
        page['gaps'].append('layout_order_unverified')
        if self.settings['layout'] and not tables:
            page['gaps'].append('table_structure_unavailable')
        if ocr:
            page['gaps'].append('ocr_quality_unverified')
        return page

    def close(self):
        self._native.clear()
        self._enhanced.clear()
        self.raw = b''


def tesseract_comparison_command(executable, image_path, tessdata_dir):
    """Return a reviewable argv for fixture comparison; never execute it here."""
    return [os.fspath(executable), os.fspath(image_path), 'stdout', '--tessdata-dir',
            os.fspath(tessdata_dir), '-l', 'kor+eng', '--psm', '3', 'tsv']


def exit_code(result):
    return result['metrics']['exitCode']


def encode_result(result):
    encoded = json_bytes(result) + b'\n'
    if len(encoded) > MAX_OUTPUT_BYTES:
        result['pages'] = [failed_page(p['page'], 'output_budget_exceeded') for p in result['pages'][:MAX_PAGES]]
        result['metrics'].update(processedPages=0, failedPages=len(result['pages']))
        fail(result, 'output_budget_exceeded', 3)
        encoded = json_bytes(result) + b'\n'
        if len(encoded) > MAX_OUTPUT_BYTES:
            # Metadata must obey the same bound; discard verbose diagnostics too.
            minimal = empty_result()
            minimal['sourceSha256'] = result['sourceSha256']
            minimal['profile'] = result['profile']
            minimal['pages'] = result['pages']
            minimal['metrics'].update(failedPages=len(minimal['pages']))
            fail(minimal, 'output_budget_exceeded', 3)
            result.clear()
            result.update(minimal)
            encoded = json_bytes(result) + b'\n'
    return encoded


class JsonArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise WorkerError('invalid_arguments')


def main(argv=None, *, stdout=None):
    parser = JsonArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--input')
    parser.add_argument('--output-json', choices=['stdout'], default='stdout')
    parser.add_argument('--max-pages', type=int, default=200)
    parser.add_argument('--timeout-seconds', type=float, default=120)
    parser.add_argument('--pages', help='Original one-based page numbers, comma separated')
    parser.add_argument('--layout', action='store_true')
    parser.add_argument('--ocr', choices=['off', 'rapidocr'], default='off')
    parser.add_argument('--model-manifest')
    parser.add_argument('--expected-sha256')
    # Native broker appends these after auditing/pinning, never forwards them
    # from its input argument allowlist. They do not grant filesystem access.
    parser.add_argument('--trusted-input-root', help=argparse.SUPPRESS)
    parser.add_argument('--trusted-model-root', help=argparse.SUPPRESS)
    try:
        args = parser.parse_args(argv)
        if os.name != 'nt' and (args.trusted_input_root is not None or args.trusted_model_root is not None):
            raise WorkerError('invalid_arguments')
        if args.check:
            result = check_environment(layout=args.layout, ocr=args.ocr == 'rapidocr', model_manifest=args.model_manifest,
                                       model_root=args.trusted_model_root)
        elif not args.input:
            raise WorkerError('invalid_arguments')
        else:
            try:
                pages = tuple(int(p) for p in args.pages.split(',')) if args.pages is not None else None
            except ValueError as exc:
                raise WorkerError('invalid_arguments') from exc
            result = run_job(args.input, max_pages=args.max_pages, timeout_seconds=args.timeout_seconds,
                             pages=pages, layout=args.layout, ocr=args.ocr == 'rapidocr',
                             model_manifest=args.model_manifest, expected_sha256=args.expected_sha256,
                             input_root=args.trusted_input_root, model_root=args.trusted_model_root)
    except WorkerError as exc:
        result = fail(empty_result(), exc.code, exc.exit_status)
    payload = encode_result(result)
    out = stdout or sys.stdout
    if hasattr(out, 'buffer'):
        out.buffer.write(payload)
        out.buffer.flush()
    else:
        out.write(payload.decode('utf-8'))
    return exit_code(result)


if __name__ == '__main__':
    if any(arg in ('--help', '-h') for arg in sys.argv[1:]):
        raise SystemExit(main())
    # Reserve a private protocol handle, then discard both Python and native
    # library diagnostic streams. Native stdout can otherwise corrupt JSON or
    # expose extracted private text. The worker emits bounded error codes only.
    protocol_fd = os.dup(sys.stdout.fileno())
    sys.stdout.flush()
    sys.stderr.flush()
    with open(os.devnull, 'wb') as diagnostic_sink:
        os.dup2(diagnostic_sink.fileno(), sys.stdout.fileno())
        os.dup2(diagnostic_sink.fileno(), sys.stderr.fileno())
        with os.fdopen(protocol_fd, 'w', encoding='utf-8', newline='\n') as protocol:
            status = main(stdout=protocol)
    raise SystemExit(status)
