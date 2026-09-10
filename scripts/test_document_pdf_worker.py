"""Dependency-independent worker contract tests; no PDFs/models leave this process."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import patch

WORKER = Path(__file__).with_name('document_pdf_worker.py')
spec = importlib.util.spec_from_file_location('document_pdf_worker', WORKER)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class FakeBackend:
    def __init__(self, raw, settings, models):
        self.raw = raw
        self.page_count = 3
        self.calls = []
        self.closed = False

    def native_page(self, page):
        self.calls.append(('native', page))
        if page == 2:
            raise RuntimeError('private backend error / do not leak')
        return {'chunks': [{'text': '한글 😀' if page == 1 else 'last page',
                            'bbox': [0, 1, 20, 30], 'kind': 'text'}],
                'gaps': ['reading_order_unverified'], 'hasImages': False}

    def enhanced_page(self, page, *, ocr, timeout):
        self.calls.append(('enhanced', page))
        return {'chunks': [{'text': 'OCR 한글', 'bbox': [1, 2, 30, 40], 'kind': 'text'}],
                'gaps': [], 'hasImages': False}

    def close(self):
        self.closed = True


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'source.pdf'
        self.raw = b'%PDF-1.7\nfixture\x00\xff\n%%EOF'
        self.path.write_bytes(self.raw)
        self.instances = []

    def factory(self, raw, settings, models):
        instance = FakeBackend(raw, settings, models)
        self.instances.append(instance)
        return instance

    def run_job(self, **kwargs):
        return worker.run_job(self.path, backend_factory=self.factory, **kwargs)

    def test_hash_bytes_and_failed_middle_page_keep_original_numbers(self):
        result = self.run_job()
        self.assertEqual(result['sourceSha256'], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual([p['page'] for p in result['pages']], [1, 2, 3])
        self.assertEqual([p['status'] for p in result['pages']], ['ok', 'failed', 'ok'])
        self.assertEqual(result['pages'][2]['text'], 'last page')
        self.assertNotIn('private backend', json.dumps(result))
        self.assertEqual(self.path.read_bytes(), self.raw)
        self.assertTrue(self.instances[0].closed)
        self.assertEqual(worker.exit_code(result), 4)

    def test_utf16_offsets_include_surrogate_pairs_and_inserted_separators(self):
        page = worker.assemble_page(7, {'chunks': [
            {'text': '한😀', 'bbox': [0, 0, 10, 10], 'kind': 'text'},
            {'text': 'B\r\nC', 'bbox': [0, 11, 10, 20], 'kind': 'tableHeader'},
        ], 'gaps': []})
        self.assertEqual(page['text'], '한😀\nB\r\nC')
        self.assertEqual([(r['startOffset'], r['endOffset']) for r in page['regions']], [(0, 3), (4, 8)])
        encoded = page['text'].encode('utf-16-le')
        self.assertEqual(encoded[0:6].decode('utf-16-le'), '한😀')

    def test_resume_selected_pages_does_not_renumber_or_repeat_failed_pages(self):
        result = self.run_job(pages=(3, 1))
        self.assertEqual([p['page'] for p in result['pages']], [1, 3])
        self.assertEqual(self.instances[0].calls, [('native', 1), ('native', 3)])

    def test_size_signature_page_and_argument_limits_are_explicit(self):
        for kwargs in [{'max_pages': 201}, {'max_pages': 0}, {'timeout_seconds': 0},
                       {'timeout_seconds': float('nan')}, {'pages': (0,)}, {'pages': (201,)}]:
            result = self.run_job(**kwargs)
            self.assertEqual(worker.exit_code(result), 3)
        with patch.object(worker, 'MAX_INPUT_BYTES', 8):
            result = self.run_job()
            self.assertIn('input_budget_exceeded', [g['code'] for g in result['gaps']])
        self.path.write_bytes(b'not PDF')
        self.assertEqual(worker.exit_code(self.run_job()), 3)

    def test_pdf_above_page_budget_is_rejected_without_a_silent_prefix(self):
        result = self.run_job(max_pages=2)
        self.assertEqual(result['pages'], [])
        self.assertIn('page_budget_exceeded', [g['code'] for g in result['gaps']])

    def test_expected_hash_mismatch_stops_before_backend(self):
        result = self.run_job(expected_sha256='0' * 64)
        self.assertEqual(self.instances, [])
        self.assertIn('source_hash_mismatch', [g['code'] for g in result['gaps']])

    @unittest.skipUnless(os.name == 'nt', 'Windows native broker contract')
    def test_broker_root_reads_accessible_file_without_parent_metadata(self):
        original = Path.lstat
        def limited(path, *args, **kwargs):
            if path in self.root.parents:
                raise PermissionError('ancestor metadata deliberately denied')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'lstat', limited):
            with self.assertRaises(worker.WorkerError):
                worker.read_pdf(self.path)
            self.assertEqual(worker.read_pdf(self.path, trusted_root=self.root), self.raw)
            result = self.run_job(input_root=self.root, expected_sha256='0' * 64)
            self.assertIn('source_hash_mismatch', [g['code'] for g in result['gaps']])
            self.assertEqual(self.instances, [])

    @unittest.skipUnless(os.name == 'nt', 'Windows native broker contract')
    def test_broker_root_rejects_escape_reparse_and_denied_components(self):
        for path in [self.root.parent / 'outside.pdf', self.root / '..' / 'outside.pdf',
                     Path(str(self.root) + '-sibling') / 'source.pdf']:
            with self.assertRaises(worker.WorkerError):
                worker.read_pdf(path, trusted_root=self.root)
        original = Path.lstat
        for denied in [self.root, self.path]:
            def reparse(path, *args, **kwargs):
                if path == denied:
                    return SimpleNamespace(st_mode=0, st_file_attributes=0x400)
                return original(path, *args, **kwargs)
            with patch.object(Path, 'lstat', reparse):
                with self.assertRaises(worker.WorkerError):
                    worker.read_pdf(self.path, trusted_root=self.root)
        with patch.object(Path, 'lstat', side_effect=PermissionError('denied')):
            with self.assertRaises(worker.WorkerError):
                worker.read_pdf(self.path, trusted_root=self.root)

    @unittest.skipUnless(os.name == 'nt', 'Windows native broker contract')
    def test_broker_model_root_covers_all_manifest_paths(self):
        manifest, _ = self.make_manifest()
        original = Path.lstat
        def limited(path, *args, **kwargs):
            if path in self.root.parents:
                raise PermissionError('ancestor metadata deliberately denied')
            return original(path, *args, **kwargs)
        with patch.object(Path, 'lstat', limited):
            models = worker.validate_manifest(manifest, trusted_root=self.root)
            self.assertTrue(models['files'])
            with self.assertRaises(worker.WorkerError):
                worker.validate_manifest(manifest, trusted_root=self.root / 'artifacts')

    def test_timeout_marks_remaining_pages_and_does_not_retry(self):
        times = iter([0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5])
        result = self.run_job(timeout_seconds=1, clock=lambda: next(times, 5))
        self.assertTrue(any(g['code'] == 'timeout' for p in result['pages'] for g in p['gaps']))
        self.assertLessEqual(len(self.instances[0].calls), 1)

    def test_missing_dependencies_check_needs_no_backend_import(self):
        with patch.object(worker.importlib.metadata, 'version', side_effect=worker.importlib.metadata.PackageNotFoundError):
            result = worker.check_environment()
        self.assertFalse(result['metrics']['available'])
        self.assertEqual(worker.exit_code(result), 2)
        self.assertTrue(all(d['status'] == 'missing' for d in result['metrics']['dependencies']))

    def test_models_are_required_before_opt_in_enrichment(self):
        result = self.run_job(ocr=True)
        self.assertEqual(self.instances, [])
        self.assertIn('models_unavailable', [g['code'] for g in result['gaps']])
        self.assertEqual(worker.exit_code(result), 2)

    def test_output_budget_reports_failed_pages_instead_of_truncating_json(self):
        with patch.object(worker, 'MAX_PAGE_BYTES', 200):
            page = worker.assemble_page(9, {'chunks': [{'text': '😀' * 200, 'bbox': [0, 0, 1, 1], 'kind': 'text'}], 'gaps': []})
        self.assertEqual(page['status'], 'failed')
        self.assertIn('output_budget_exceeded', [g['code'] for g in page['gaps']])
        self.assertEqual(page['text'], '')
        self.assertLessEqual(len(worker.encode_result(self.run_job())), 16 * 1024 * 1024)

    def test_invalid_bbox_is_not_fabricated_but_text_is_retained_with_gap(self):
        page = worker.assemble_page(1, {'chunks': [{'text': 'keep text', 'bbox': [0, 0, float('nan'), 10], 'kind': 'text'}], 'gaps': []})
        self.assertEqual(page['text'], 'keep text')
        self.assertEqual(page['regions'], [])
        self.assertIn('bbox_unavailable', [g['code'] for g in page['gaps']])

    def test_empty_native_page_reports_ocr_gap(self):
        page = worker.assemble_page(5, {'chunks': [], 'gaps': ['ocr_unavailable']})
        self.assertEqual(page['status'], 'failed')
        self.assertIn('no_extractable_text', [g['code'] for g in page['gaps']])

    def test_cli_check_is_json_and_does_not_accept_backend_plugin_or_remote_input(self):
        out = io.StringIO()
        with patch.object(worker.importlib.metadata, 'version', side_effect=worker.importlib.metadata.PackageNotFoundError):
            code = worker.main(['--check'], stdout=out)
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(out.getvalue())['version'], 1)
        out = io.StringIO()
        code = worker.main(['--input', 'https://example.test/a.pdf', '--output-json', 'stdout'], stdout=out)
        self.assertEqual(code, 3)
        self.assertIn('input_unavailable', out.getvalue())

    def test_cli_rejects_broker_roots_on_non_windows_even_if_unused(self):
        for flag in ['--trusted-input-root', '--trusted-model-root']:
            out = io.StringIO()
            with patch.object(worker.os, 'name', 'posix'):
                code = worker.main(['--check', flag, 'C:/private/job'], stdout=out)
            self.assertEqual(code, 3)
            self.assertIn('invalid_arguments', out.getvalue())

    def make_manifest(self, ocr=False):
        root = self.root / 'artifacts'
        root.mkdir(exist_ok=True)
        paths = ['layout/config.json', 'layout/model.safetensors']
        if ocr:
            paths += ['ocr/det.onnx', 'ocr/cls.onnx', 'ocr/rec.onnx', 'ocr/keys.txt']
        files = []
        for name in paths:
            path = root / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(b'local fake artifact ' + name.encode())
            files.append({'path': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        manifest = {'version': 1, 'docling': '2.126.0', 'artifactsRoot': str(root),
                    'files': files, 'layout': {'revision': 'fixture-layout-v1'}}
        if ocr:
            manifest['rapidocr'] = {'version': '3.9.2', 'onnxruntime': '1.23.2',
                'ocrVersion': 'PP-OCRv5', 'language': 'korean', 'engine': 'onnxruntime',
                'detection': 'ocr/det.onnx', 'classification': 'ocr/cls.onnx',
                'recognition': 'ocr/rec.onnx', 'keys': 'ocr/keys.txt', 'revision': 'fixture-v5'}
        path = self.root / 'models.json'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        return path, manifest

    def test_manifest_requires_exact_versions_all_local_hashes_and_no_unlisted_files(self):
        path, manifest = self.make_manifest(ocr=True)
        first = worker.validate_manifest(path, ocr=True)
        self.assertEqual(first['fingerprint'], worker.validate_manifest(path, ocr=True)['fingerprint'])
        manifest['rapidocr']['ocrVersion'] = 'PP-OCRv6'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaisesRegex(worker.WorkerError, 'models_unavailable'):
            worker.validate_manifest(path, ocr=True)
        path, manifest = self.make_manifest(ocr=True)
        (Path(manifest['artifactsRoot']) / 'ocr/rec.onnx').write_bytes(b'tampered')
        with self.assertRaisesRegex(worker.WorkerError, 'model_hash_mismatch'):
            worker.validate_manifest(path, ocr=True)
        path, manifest = self.make_manifest()
        (Path(manifest['artifactsRoot']) / 'extra.txt').write_text('not pinned')
        with self.assertRaisesRegex(worker.WorkerError, 'model_manifest_incomplete'):
            worker.validate_manifest(path)

    def test_manifest_rejects_traversal_and_absent_ocr_configuration(self):
        path, manifest = self.make_manifest()
        with self.assertRaisesRegex(worker.WorkerError, 'models_unavailable'):
            worker.validate_manifest(path, ocr=True)
        manifest['files'][0]['path'] = '../secret'
        path.write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaises(worker.WorkerError):
            worker.validate_manifest(path)

    def test_ocr_is_selective_and_native_always_precedes_enrichment(self):
        path, _ = self.make_manifest(ocr=True)
        class ImageBackend(FakeBackend):
            def native_page(self, page):
                data = super().native_page(page)
                data['hasImages'] = page == 3
                return data
        instance = ImageBackend(self.raw, {}, {})
        result = worker.run_job(self.path, pages=(1, 3), ocr=True, model_manifest=path,
                                backend_factory=lambda *args: instance)
        self.assertEqual(instance.calls, [('native', 1), ('native', 3), ('enhanced', 3)])
        self.assertEqual(result['pages'][1]['text'], 'OCR 한글')
        self.assertEqual(worker.exit_code(result), 0)

    def test_failed_enrichment_keeps_native_text_but_is_marked_incomplete(self):
        path, _ = self.make_manifest()
        class Broken(FakeBackend):
            def enhanced_page(self, *args, **kwargs):
                raise RuntimeError('bad layout')
        result = worker.run_job(self.path, pages=(1,), layout=True, model_manifest=path,
                                backend_factory=Broken)
        self.assertEqual(result['pages'][0]['text'], '한글 😀')
        self.assertEqual(result['pages'][0]['status'], 'failed')
        self.assertEqual(worker.exit_code(result), 4)

    def test_normalizer_uses_source_pages_charspans_top_left_boxes_and_table_cells(self):
        def box(l, t, r, b, origin='BOTTOMLEFT'):
            return SimpleNamespace(l=l, t=t, r=r, b=b, coord_origin=SimpleNamespace(value=origin))
        def prov(page, span, bbox):
            return SimpleNamespace(page_no=page, charspan=span, bbox=bbox)
        text = SimpleNamespace(text='A😀B', label=SimpleNamespace(value='text'),
                               prov=[prov(2, (1, 3), box(1, 90, 20, 80))])
        table = SimpleNamespace(label=SimpleNamespace(value='table'),
            prov=[prov(2, (0, 0), box(0, 75, 30, 10))], data=SimpleNamespace(table_cells=[
                SimpleNamespace(text='제목', column_header=True, bbox=box(1, 75, 20, 65)),
                SimpleNamespace(text='값', column_header=False, bbox=box(1, 64, 20, 54))]))
        document = SimpleNamespace(pages={2: SimpleNamespace(size=SimpleNamespace(height=100, width=100))},
                                   iterate_items=lambda: iter([(text, 0), (table, 0)]))
        normalized = worker.normalize_docling(document)
        page = worker.assemble_page(2, normalized[2])
        self.assertEqual(page['text'], '😀B\n제목\n값')
        self.assertEqual(page['regions'][0]['bbox'], [1, 10, 20, 20])
        self.assertEqual(page['regions'][1]['kind'], 'tableHeader')

    def test_real_adapter_contract_uses_native_pipeline_bytes_and_bounded_options(self):
        calls = []
        class Options:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)
        class Converter:
            def __init__(self, **kwargs):
                calls.append(('options', kwargs))
            def convert(self, source, **kwargs):
                calls.append(('convert', source, kwargs))
                return SimpleNamespace(input=SimpleNamespace(page_count=3),
                    document=SimpleNamespace(pages={1: SimpleNamespace(size=SimpleNamespace(height=100))},
                        iterate_items=lambda: iter([])), errors=[])
        modules = {}
        for name, attributes in {
            'docling.document_converter': {'DocumentConverter': Converter, 'NativePdfFormatOption': Options},
            'docling.datamodel.base_models': {'InputFormat': SimpleNamespace(PDF='pdf'), 'DocumentStream': Options},
            'docling.datamodel.pipeline_options': {'NativePdfPipelineOptions': Options},
        }.items():
            module = ModuleType(name)
            module.__dict__.update(attributes)
            modules[name] = module
        with patch.dict('sys.modules', modules):
            backend = worker.DoclingBackend(self.raw, {'timeout': 10, 'max_pages': 20, 'pages': (1,), 'layout': False, 'ocr': False}, None)
        self.assertEqual(backend.page_count, 3)
        opts = calls[0][1]['format_options']['pdf'].pipeline_options
        self.assertEqual(opts.parser_threads, 2)
        self.assertFalse(opts.generate_page_images)
        self.assertFalse(opts.generate_picture_images)
        self.assertFalse(opts.enable_remote_services)
        self.assertFalse(opts.allow_external_plugins)
        self.assertEqual(calls[1][1].stream.getvalue(), self.raw)
        self.assertEqual(calls[1][2]['max_num_pages'], 20)
        self.assertEqual(calls[1][2]['max_file_size'], worker.MAX_INPUT_BYTES)
        self.assertEqual(calls[1][2]['page_range'], (1, 1))
        backend.close()

    def test_tesseract_comparison_produces_argv_only_never_a_shell_command(self):
        command = worker.tesseract_comparison_command('tesseract', 'fixture.png', 'traineddata')
        self.assertEqual(command, ['tesseract', 'fixture.png', 'stdout', '--tessdata-dir', 'traineddata', '-l', 'kor+eng', '--psm', '3', 'tsv'])

    def test_offline_runtime_caps_threads_and_blocks_python_network_connections(self):
        import socket
        previous = os.environ.get('OMP_NUM_THREADS')
        with worker.offline_runtime():
            self.assertEqual(os.environ['OMP_NUM_THREADS'], '2')
            self.assertEqual(os.environ['HF_HUB_OFFLINE'], '1')
            with self.assertRaisesRegex(worker.WorkerError, 'network_disabled'):
                socket.create_connection(('example.test', 443))
        self.assertEqual(os.environ.get('OMP_NUM_THREADS'), previous)

    def test_cli_executable_emits_one_json_object_without_optional_packages(self):
        completed = subprocess.run([sys.executable, '-B', str(WORKER), '--check'],
            capture_output=True, timeout=15, check=False)
        result = json.loads(completed.stdout)
        self.assertEqual(result['version'], 1)
        self.assertEqual(completed.returncode, worker.exit_code(result))
        self.assertEqual(completed.stderr, b'')

    def test_cli_stdout_contains_no_backend_prints(self):
        class Loud(FakeBackend):
            def __init__(self, *args):
                print('private contents must not enter protocol')
                super().__init__(*args)
        out = io.StringIO()
        noise = io.StringIO()
        with patch.object(worker, 'DoclingBackend', Loud), patch.object(worker, 'dependency_report', return_value=[]), patch('sys.stdout', noise):
            worker.main(['--input', str(self.path), '--pages', '1'], stdout=out)
        self.assertEqual(json.loads(out.getvalue())['pages'][0]['status'], 'ok')
        self.assertEqual(noise.getvalue(), '')

    def test_profile_changes_for_changed_models_but_not_selected_page_numbers(self):
        first = self.run_job(pages=(1,))
        self.assertEqual(first['profile'], self.run_job(pages=(3,))['profile'])
        path, manifest = self.make_manifest()
        a = self.run_job(pages=(1,), layout=True, model_manifest=path)
        target = Path(manifest['artifactsRoot']) / manifest['files'][0]['path']
        target.write_bytes(b'new artifact')
        manifest['files'][0]['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
        path.write_text(json.dumps(manifest), encoding='utf-8')
        b = self.run_job(pages=(1,), layout=True, model_manifest=path)
        self.assertNotEqual(first['profile'], a['profile'])
        self.assertNotEqual(a['profile'], b['profile'])

    def test_optional_table_manifest_needs_a_revision_pin(self):
        path, manifest = self.make_manifest()
        manifest['table'] = {}
        path.write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaisesRegex(worker.WorkerError, 'models_unavailable'):
            worker.validate_manifest(path)

    def test_enhanced_adapter_pins_v5_paths_cpu_threads_and_disables_generative_stages(self):
        path, _ = self.make_manifest(ocr=True)
        models = worker.validate_manifest(path, ocr=True)
        calls = []
        class Options:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)
        class Converter:
            def __init__(self, **kwargs):
                calls.append(kwargs)
            def convert(self, source, **kwargs):
                calls.append(kwargs)
                return SimpleNamespace(errors=[], document=object())
        modules = {}
        for name, attributes in {
            'docling.document_converter': {'DocumentConverter': Converter, 'PdfFormatOption': Options},
            'docling.datamodel.accelerator_options': {'AcceleratorOptions': Options, 'AcceleratorDevice': SimpleNamespace(CPU='cpu')},
            'docling.datamodel.backend_options': {'ThreadedDoclingParseBackendOptions': Options},
            'docling.datamodel.pipeline_options': {'PdfPipelineOptions': Options, 'RapidOcrOptions': Options},
            'rapidocr': {'OCRVersion': SimpleNamespace(PPOCRV5='PP-OCRv5', PPOCRV4='PP-OCRv4'), 'ModelType': SimpleNamespace(MOBILE='mobile')},
            'torch': {'set_num_threads': lambda n: None, 'set_num_interop_threads': lambda n: None},
            'onnxruntime': {'disable_telemetry_events': lambda: None},
        }.items():
            module = ModuleType(name)
            module.__dict__.update(attributes)
            modules[name] = module
        backend = object.__new__(worker.DoclingBackend)
        backend.raw, backend.models, backend._pdf = self.raw, models, 'pdf'
        backend.settings = {'layout': False, 'max_pages': 200}
        backend._enhanced, backend._stream = {}, Options
        page = {'chunks': [{'text': 'Korean', 'bbox': [0, 0, 1, 1], 'kind': 'text'}], 'gaps': [], 'hasImages': False}
        with patch.dict('sys.modules', modules), patch.object(worker, 'normalize_docling', return_value={7: page}):
            backend.enhanced_page(7, ocr=True, timeout=30)
        options = calls[0]['format_options']['pdf'].pipeline_options
        self.assertEqual(options.accelerator_options.device, 'cpu')
        self.assertEqual(options.accelerator_options.num_threads, 2)
        self.assertFalse(options.enable_remote_services)
        self.assertFalse(options.allow_external_plugins)
        self.assertFalse(options.do_picture_description)
        self.assertFalse(options.do_code_enrichment)
        self.assertFalse(options.do_formula_enrichment)
        self.assertFalse(options.do_table_structure)
        self.assertEqual(options.ocr_options.lang, ['korean'])
        self.assertEqual(options.ocr_options.rapidocr_params['Rec.ocr_version'], 'PP-OCRv5')
        self.assertEqual(options.ocr_options.rapidocr_params['Det.ocr_version'], 'PP-OCRv5')
        self.assertEqual(options.ocr_options.rapidocr_params['EngineConfig.onnxruntime.intra_op_num_threads'], 2)
        self.assertEqual(calls[1]['page_range'], (7, 7))

    def test_json_budget_also_bounds_diagnostics_and_preserves_source_hash(self):
        result = self.run_job(pages=(1,))
        sha = result['sourceSha256']
        result['metrics']['dependencies'] = ['diagnostic' * 1000]
        with patch.object(worker, 'MAX_OUTPUT_BYTES', 2048):
            encoded = worker.encode_result(result)
        self.assertLessEqual(len(encoded), 2048)
        decoded = json.loads(encoded)
        self.assertEqual(decoded['sourceSha256'], sha)
        self.assertEqual(worker.exit_code(decoded), 3)

    def test_zero_width_native_provenance_does_not_silently_drop_nonempty_text(self):
        bbox = SimpleNamespace(l=0, t=0, r=10, b=10, coord_origin=SimpleNamespace(value='TOPLEFT'))
        text = SimpleNamespace(text='unmapped', label=SimpleNamespace(value='text'),
            prov=[SimpleNamespace(page_no=1, charspan=(0, 0), bbox=bbox)])
        doc = SimpleNamespace(pages={1: SimpleNamespace(size=SimpleNamespace(height=100))},
                              iterate_items=lambda: iter([(text, 0)]))
        page = worker.assemble_page(1, worker.normalize_docling(doc)[1])
        self.assertIn('invalid_provenance', [g['code'] for g in page['gaps']])
        self.assertEqual(page['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
