"""On-demand host graph. No Vault, MCP, model provider, hook or watcher access."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import re
import subprocess
import tempfile
import time
from urllib.parse import unquote

SCHEMA = 1
VERSION = '0.9.58'
BLOCKED = {'.agents', '.mcpvault', '.git', '.codex', 'node_modules', 'dist',
           'credentials', 'secrets', 'host', '__pycache__'}
EXTENSIONS = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.md'}
MAX_FILE = 2 * 1024 * 1024
MAX_TOTAL = 32 * 1024 * 1024
MAX_FACTS = 10000


def digest(data):
    return hashlib.sha256(data).hexdigest()


def relative_path(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value:
        raise ValueError('Expected an explicit repository-relative source path')
    parts = value.split('/')
    if any(not part or part in {'.', '..'} or part.startswith('.') or part.endswith(('.', ' ')) or
           re.search(r'[\x00-\x1f<>"|?*]', part) or
           re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', part, re.I) or
           part.lower() in BLOCKED for part in parts):
        raise ValueError('Excluded source path')
    if PurePosixPath(value).suffix.lower() not in EXTENSIONS:
        raise ValueError('Unsupported source type')
    return value


def source_bytes(root, value):
    value = relative_path(value)
    root = local_storage(root)
    current = root
    for part in value.split('/'):
        current = current / part
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Source links and reparse points are excluded')
    resolved = current.resolve(strict=True)
    if not resolved.is_relative_to(root) or not current.is_file():
        raise ValueError('Source outside repository')
    relative_path(resolved.relative_to(root).as_posix())
    with current.open('rb') as source:
        data = source.read(MAX_FILE + 1)
    if len(data) > MAX_FILE or b'\x00' in data:
        raise ValueError('Source size/type limit exceeded')
    data.decode('utf-8-sig')
    return data


def snapshot(root, paths):
    if not isinstance(paths, list) or not 1 <= len(paths) <= 512:
        raise ValueError('Select 1..512 explicit source files')
    result = {}
    seen = set()
    total = 0
    for value in paths:
        relative_path(value)
        if value.casefold() in seen:
            raise ValueError('Duplicate source path')
        seen.add(value.casefold())
        data = source_bytes(root, value)
        total += len(data)
        if total > MAX_TOTAL:
            raise ValueError('Source corpus exceeds byte budget')
        result[value] = {'sha256': digest(data), 'bytes': len(data), 'data': data}
    return result


def worker(stage):
    """Dedicated child: pinned upstream API, no provider CLI or ambient credentials.

    Python audit checks are defense in depth, not an OS/native-code sandbox.
    Only copied source files and installed interpreter/package files may be read.
    """
    import copy
    import importlib.metadata
    stage = Path(stage).resolve(strict=True)
    runtime_roots = [Path(sys.prefix).resolve() / 'Lib',
                     Path(sys.base_prefix).resolve() / 'Lib',
                     Path(sys.base_prefix).resolve() / 'DLLs']
    denied = [0]

    def audit(event, args):
        if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system', 'os.startfile'}:
            raise PermissionError('Network and process execution are disabled')
        if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
            target = Path(os.fsdecode(args[0])).resolve()
            flags = args[2] if len(args) > 2 and isinstance(args[2], int) else 0
            writing = flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            allowed = target.is_relative_to(stage) or (not writing and
                      any(target.is_relative_to(root) for root in runtime_roots))
            if not allowed:
                denied[0] += 1
                raise PermissionError('File outside controlled analysis inputs')

    sys.addaudithook(audit)
    if importlib.metadata.version('graphifyy') != VERSION:
        raise ValueError('Graphify release mismatch; rebuild with the pinned environment')
    import graphify.extract as upstream
    request = json.loads((stage / 'request.json').read_text(encoding='utf-8'))
    captured = {}
    fact_count = 0
    original = upstream._safe_extract

    def capture(extractor, path):
        nonlocal fact_count
        result = original(extractor, path)
        fact_count += sum(len(result.get(key, [])) for key in ('nodes', 'edges', 'raw_calls'))
        if fact_count > MAX_FACTS:
            raise ValueError('Raw AST fact budget exceeded')
        captured[path.as_posix()] = copy.deepcopy(result)
        return result

    upstream._safe_extract = capture
    paths = [Path(value) for value in request if Path(value).suffix.lower() != '.md']
    graph = upstream.extract(paths, root=stage, cache_root=stage / 'cache', parallel=False, max_workers=1)
    if graph.get('failed_sources') or any(value.get('error') or value.get('parse_errors')
                                          for value in captured.values()):
        raise ValueError('AST extraction incomplete; cache not published')
    if set(captured) != {path.as_posix() for path in paths}:
        raise ValueError('Raw extraction capture incomplete')
    graph['raw'] = captured
    graph['blockedOutsideReads'] = denied[0]
    (stage / 'result.json').write_text(json.dumps(graph, ensure_ascii=True), encoding='utf-8')


def extract_snapshot(inputs):
    # Fresh independent directory: no actual repo metadata or cached prior run.
    with tempfile.TemporaryDirectory(prefix='corpus-', dir=staging_parent()) as directory:
        stage = Path(directory)
        for path, entry in inputs.items():
            target = stage / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(entry['data'])
        (stage / 'request.json').write_text(json.dumps(list(inputs)), encoding='utf-8')
        run_worker(stage)
        result_path = stage / 'result.json'
        if result_path.stat().st_size > MAX_TOTAL:
            raise ValueError('Extracted graph exceeds cache budget')
        result = json.loads(result_path.read_text(encoding='utf-8'))
        # Upstream can mint a stub for import('./unselected.js').Type. A stub is
        # an unresolved reference, not a read or evidence for that source file.
        result['unresolvedNodes'] = [node for node in result['nodes'] if node.get('source_file') not in inputs]
        result['nodes'] = [node for node in result['nodes'] if node.get('source_file') in inputs]
        if any(edge.get('source_file') not in inputs for edge in result['edges']):
            raise ValueError('Extraction returned a non-allowlisted edge author')
        return result


def run_worker(stage):
    stage = local_storage(stage)
    env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'TEMP', 'TMP') if key in os.environ}
    env.update({'GRAPHIFY_QUERY_LOG_DISABLE': '1', 'PYTHONIOENCODING': 'utf-8',
                'USERPROFILE': str(stage), 'HOME': str(stage), 'TEMP': str(stage), 'TMP': str(stage)})
    process = subprocess.run([sys.executable, '-I', '-B', str(Path(__file__).resolve()),
                              '_worker', str(stage)], cwd=stage, env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=180)
    if process.returncode:
        # No source text, host paths, credentials or document instructions in errors.
        raise ValueError('Isolated AST worker failed; no new cache published')


def document_edges(path, data, allowed, budget=MAX_FACTS):
    edges = []
    fence = None
    for number, line in enumerate(data.decode('utf-8-sig').splitlines(), 1):
        marker = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if marker:
            run, tail = marker.groups()
            if fence is None:
                fence = (run[0], len(run))
            elif run[0] == fence[0] and len(run) >= fence[1] and not tail.strip():
                fence = None
            continue
        if fence:
            continue
        # Only explicit Markdown destinations, wikilinks and code-formatted paths.
        occurrences = re.finditer(r'\]\(([^\s)]+)\)|\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|`([^`\n]+)`', line)
        for occurrence in occurrences:
            target = unquote(next(value for value in occurrence.groups() if value is not None)).split('#')[0]
            if not target or '\\' in target or ':' in target or target.startswith('/'):
                continue
            candidates = set()
            for candidate in [PurePosixPath(target), PurePosixPath(path).parent / target]:
                parts = []
                escaped = False
                for part in candidate.parts:
                    if part == '..':
                        if not parts:
                            escaped = True
                            break
                        parts.pop()
                    elif part != '.':
                        parts.append(part)
                normalized = '/'.join(parts)
                if not escaped and normalized in allowed:
                    candidates.add(normalized)
            if len(candidates) == 1:
                if len(edges) >= budget:
                    raise ValueError('Document graph budget exceeded')
                edges.append({'source': 'file:' + path, 'target': 'file:' + candidates.pop(),
                              'relation': 'document_reference', 'source_file': path,
                              'source_location': f'L{number}', 'column': occurrence.start() + 1,
                              'method': 'explicit_markdown_reference'})
    return edges


def build_graph(root, paths):
    start = time.perf_counter()
    inputs = snapshot(root, paths)
    extracted = extract_snapshot(inputs)
    files = {path: {key: value for key, value in entry.items() if key != 'data'}
             for path, entry in inputs.items()}
    nodes = [{'id': 'file:' + path, 'label': path, 'source_file': path,
              'type': 'file', 'source_location': 'L1'} for path in files]
    nodes.extend(extracted['nodes'])
    edges = []
    for node in extracted['nodes']:
        if node.get('source_file') in files:
            edges.append({'source': 'file:' + node['source_file'], 'target': node['id'],
                          'relation': 'declares', 'source_file': node['source_file'],
                          'source_location': node.get('source_location'), 'method': 'graphify_ast_membership'})
    edges.extend(dict(edge, method='graphify_ast_resolution') for edge in extracted['edges'])
    if len(nodes) + len(edges) > MAX_FACTS:
        raise ValueError('Resolved graph budget exceeded')
    for path, entry in inputs.items():
        if path.lower().endswith('.md'):
            edges.extend(document_edges(path, entry['data'], files, MAX_FACTS - len(nodes) - len(edges)))
    for index, edge in enumerate(edges):
        edge['occurrenceId'] = index
        edge['sourceHash'] = files.get(edge.get('source_file'), {}).get('sha256')
    projection = sorted({tuple(sorted((edge['source'], edge['target']))) for edge in edges
                         if edge['source'] != edge['target']})
    if any(digest(source_bytes(root, path)) != entry['sha256'] for path, entry in files.items()):
        raise ValueError('Sources changed during build; cache not published')
    return {'schemaVersion': SCHEMA, 'repositoryId': digest(str(Path(root).resolve()).casefold().encode()),
            'tool': {'name': 'graphifyy', 'version': VERSION, 'adapterVersion': 1},
            'files': files, 'nodes': nodes, 'edges': edges, 'raw': extracted['raw'],
            'projection': projection, 'unresolvedNodes': extracted['unresolvedNodes'],
            'blockedOutsideReads': extracted['blockedOutsideReads'],
            'buildSeconds': round(time.perf_counter() - start, 4), 'inferenceCalls': 0}


def query_graph(root, graph, query, *, impact=False, max_chars=7000, limit=24):
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 256:
        raise ValueError('Provide a file, symbol or bounded query')
    if type(max_chars) is not int or not 1000 <= max_chars <= 16000 or type(limit) is not int or not 1 <= limit <= 40:
        raise ValueError('Invalid output budget')
    if graph.get('schemaVersion') != SCHEMA or graph.get('tool', {}).get('version') != VERSION:
        raise ValueError('Cache version changed; build again')
    if graph.get('repositoryId') != digest(str(Path(root).resolve()).casefold().encode()):
        raise ValueError('Cache belongs to a different repository')
    try:
        current = snapshot(root, list(graph['files']))
        valid = all(current[path]['sha256'] == entry['sha256'] for path, entry in graph['files'].items())
    except (OSError, ValueError):
        valid = False
    if not valid:
        return {'status': 'stale', 'action': 'build', 'reason': 'An input changed, was deleted or became unavailable'}
    nodes = {node['id']: node for node in graph['nodes']}
    term = query.strip().casefold()
    exact = [node for node in nodes.values() if term in {node.get('label', '').casefold(),
             node.get('label', '').removesuffix('()').casefold(), node['id'].casefold()}]
    if query in graph['files']:
        seeds = ['file:' + query]
    elif impact:
        if len(exact) != 1:
            return {'status': 'ambiguous' if exact else 'not_found', 'action': 'Use an exact file path or symbol id'}
        seeds = [exact[0]['id']]
    else:
        found = exact or [node for node in nodes.values() if all(word in
                (node.get('label', '') + ' ' + node.get('source_file', '')).casefold() for word in term.split())]
        seeds = [node['id'] for node in found[:5]]
    response = {'status': 'current' if seeds else 'not_found', 'repositoryId': graph['repositoryId'],
                'tool': graph['tool'], 'scope': 'explicit allowlist only; structural candidates, not proof',
                'partial': True, 'testStatus': 'not_executed', 'nodes': [], 'edges': [], 'action': 'Read current source at the returned hash/location'}
    relations = [edge for edge in graph['edges'] if edge['source'] in nodes and edge['target'] in nodes]
    if impact:
        # A separate file view of authored AST relations, NOT a replacement for
        # the occurrence inventory. Preserve direction/kind/author locator.
        seeds = list(dict.fromkeys('file:' + nodes[seed]['source_file'] for seed in seeds))
        relations = [dict(edge, source='file:' + nodes[edge['source']]['source_file'],
                          target='file:' + nodes[edge['target']]['source_file']) for edge in relations
                     if nodes[edge['source']]['source_file'] != nodes[edge['target']]['source_file']]

    def rank(edge):
        paths = [nodes[edge['source']]['source_file'], nodes[edge['target']]['source_file']]
        priority = 0 if any('.test.' in path.lower() or '/tests/' in '/' + path.lower() for path in paths) else 1 if any(path.lower().endswith('.md') for path in paths) else 2
        return (priority, edge['source'], edge['target'], edge['occurrenceId'])

    def compact(node_id):
        node = nodes[node_id]
        path = node['source_file']
        return {'id': node_id, 'label': node.get('label'), 'source_file': path,
                'source_location': node.get('source_location'), 'sha256': graph['files'][path]['sha256']}

    selected = set()
    for seed in seeds[:limit]:
        response['nodes'].append(compact(seed))
        if len(json.dumps(response, ensure_ascii=True)) > max_chars:
            response['nodes'].pop()
            break
        selected.add(seed)
    used = set()
    deferred_details = []
    for depth in range(3):
        frontier = set(selected)
        candidates = sorted([edge for edge in relations if edge['source'] in frontier or edge['target'] in frontier], key=rank) if depth < 2 else []
        # First cover distinct neighbors, then preserve further same-pair facts
        # if budget remains. Degree never affects evidence confidence.
        pairs = set()
        first, rest = [], []
        for edge in candidates:
            pair = (edge['source'], edge['target'])
            (rest if pair in pairs else first).append(edge)
            pairs.add(pair)
        deferred_details.extend(rest)
        for edge in (first if depth < 2 else deferred_details):
            if edge['occurrenceId'] in used or len(response['edges']) >= 80:
                continue
            new = {edge['source'], edge['target']} - selected
            if len(selected) + len(new) > limit:
                continue
            before = len(response['nodes'])
            response['nodes'].extend(compact(node_id) for node_id in sorted(new))
            response['edges'].append({key: edge.get(key) for key in ('source', 'target', 'relation', 'source_file', 'source_location', 'method', 'occurrenceId', 'sourceHash')})
            if len(json.dumps(response, ensure_ascii=True)) > max_chars:
                del response['nodes'][before:]
                response['edges'].pop()
                continue
            selected.update(new)
            used.add(edge['occurrenceId'])
    # Revalidate after selection; never deliver old context after observed drift.
    try:
        if any(digest(source_bytes(root, path)) != entry['sha256'] for path, entry in graph['files'].items()):
            return {'status': 'stale', 'action': 'build'}
    except (OSError, ValueError):
        return {'status': 'stale', 'action': 'build'}
    return response


def local_storage(root):
    root = Path(root).absolute()
    if str(root).startswith(('\\\\', '//')):
        raise ValueError('Network storage is excluded')
    if os.name == 'nt':
        import ctypes
        if ctypes.windll.kernel32.GetDriveTypeW(str(root.anchor)) not in (3, 6):
            raise ValueError('Expected a local fixed or RAM drive')
    return root.resolve(strict=True)


def staging_parent():
    root = local_storage(Path(__file__).resolve().parent.parent)
    parent = cache_path(root).parent / 'staging'
    if not parent.exists():
        parent.mkdir()
    info = parent.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
        raise ValueError('Staging directory cannot be a link or reparse point')
    return local_storage(parent)


def cache_path(root):
    target = root
    for part in ('.mcpvault', 'graphify'):
        target = target / part
        if not target.exists():
            target.mkdir()
        info = target.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Cache directory cannot be a link or reparse point')
    cache = target / 'cache-v1.json'
    if cache.is_symlink() or (cache.exists() and getattr(cache.lstat(), 'st_file_attributes', 0) & 0x400):
        raise ValueError('Cache cannot be a link or reparse point')
    return cache


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Host-only Graphify: local AST and explicit document references; no model APIs')
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('build', help='Build a versioned disposable cache from an explicit allowlist')
    build.add_argument('--file', action='append', help='Repository-relative input; repeated values replace the default allowlist')
    for command in ['query', 'impact']:
        query = commands.add_parser(command, help='Read bounded current structural candidates, never a test-pass claim')
        query.add_argument('query')
        query.add_argument('--max-chars', type=int, default=7000)
        query.add_argument('--limit', type=int, default=24)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    cache = cache_path(root)
    if args.command == 'build':
        manifest = json.loads(Path(__file__).with_name('graphify-inputs.json').read_text(encoding='utf-8'))
        graph = build_graph(root, args.file or manifest['files'])
        payload = json.dumps(graph, ensure_ascii=True).encode()
        if len(payload) > MAX_TOTAL:
            raise ValueError('Graph exceeds cache byte budget')
        handle, temporary = tempfile.mkstemp(prefix='cache-v1-', suffix='.tmp', dir=cache.parent)
        try:
            with os.fdopen(handle, 'wb') as output:
                output.write(payload)
            os.replace(temporary, cache)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print(json.dumps({'status': 'built', 'tool': graph['tool'], 'files': len(graph['files']),
                          'nodes': len(graph['nodes']), 'edges': len(graph['edges']),
                          'buildSeconds': graph['buildSeconds'], 'inferenceCalls': 0}))
    else:
        with cache.open('rb') as source:
            data = source.read(MAX_TOTAL + 1)
        if len(data) > MAX_TOTAL:
            raise ValueError('Cache exceeds byte budget')
        graph = json.loads(data)
        print(json.dumps(query_graph(root, graph, args.query, impact=args.command == 'impact',
                                     max_chars=args.max_chars, limit=args.limit), ensure_ascii=True))


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '_worker':
        worker(sys.argv[2])
    else:
        try:
            main()
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            print(json.dumps({'status': 'error', 'action': 'Check explicit inputs and pinned environment; rebuild',
                              'errorType': type(error).__name__}))
            sys.exit(1)
