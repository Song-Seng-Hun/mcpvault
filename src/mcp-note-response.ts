import { guidanceError, guidanceText } from './guidance-runtime.js';
import { endpointIdForTool } from './endpoint-registry.js';
import { packNavigationPage } from './navigation-page.js';

// Callers test complete pages first: removing continuation fields can reduce their size.
function largestFittingPrefix(low: number, high: number, maxChars: number, serialize: (end: number) => string): number {
  let selected = low - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (serialize(middle).length <= maxChars) { selected = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return selected;
}

export function noteReadMaxChars(requestedMaxChars: unknown): number {
  const parsed = requestedMaxChars === undefined ? 12000 : Number(requestedMaxChars);
  if (!Number.isInteger(parsed) || parsed < 512 || parsed > 20000) throw guidanceError(new Error('maxChars must be an integer between 512 and 20000'), 'guid-cc408e854eb4b949');
  return parsed;
}

/** Page only the requested string, never a body/summary fallback. */
export function boundedPropertyReadResult(path: string, property: string, value: string, revision: string,
  offset: number, maxChars: number, prettyPrint: boolean) {
  if (offset > value.length) throw guidanceError(new Error('offset exceeds the Property length'), 'guid-802aed4017f00eae');
  const serialize = (end: number) => JSON.stringify({ path, property, revision, offset, value: value.slice(offset, end),
    totalChars: value.length, truncated: end < value.length,
    ...(end < value.length && { nextAction: { endpointId: 'notes.read', arguments: { path, property, offset: end, expectedRevision: revision, maxChars, prettyPrint } } }),
  }, null, prettyPrint ? 2 : undefined);
  // Full responses omit continuation overhead, so try them before prefix search.
  if (value.length - offset <= maxChars) {
    const full = serialize(value.length);
    if (full.length <= maxChars) return { content: [{ type: 'text' as const, text: full }] };
  }
  let end = largestFittingPrefix(offset + 1, Math.min(value.length - 1, offset + maxChars), maxChars, serialize);
  // Avoid splitting surrogate pairs while retaining the UTF-16 offset contract.
  if (end > offset && /[\uD800-\uDBFF]/.test(value[end - 1]!) && /[\uDC00-\uDFFF]/.test(value[end]!)) end--;
  if (end <= offset) return noteReadBudgetError(Math.min(20000, Math.max(maxChars + 512, serialize(Math.min(offset + 2, value.length)).length)), revision);
  return { content: [{ type: 'text' as const, text: serialize(end) }] };
}

export function boundedNoteReadResult(
  path: string,
  note: { frontmatter: Record<string, unknown>; content: string; originalContent: string; revision: string },
  requestedMaxChars: unknown,
  prettyPrint?: boolean,
) {
  const maxChars = noteReadMaxChars(requestedMaxChars);
  const route = { kind: 'exact_note', reason: 'caller_supplied_path_current_access_checked', skipped: ['search', 'outline'] };
  const full = { path, fm: note.frontmatter, content: note.content, revision: note.revision, route };
  const fullText = JSON.stringify(full, null, prettyPrint ? 2 : undefined);
  if (fullText.length <= maxChars) return { content: [{ type: 'text' as const, text: fullText }] };

  const nextAction = {
    endpointId: endpointIdForTool('get_note_outline'),
    arguments: { path, expectedRevision: note.revision },
  };
  let base: Record<string, unknown> = {
    path,
    fm: note.frontmatter,
    content: '',
    revision: note.revision,
    totalContentChars: note.content.length,
    returnedContentChars: 0,
    truncated: true,
    nextAction,
    route,
  };
  if (JSON.stringify(base).length > maxChars) {
    // Outline headings exclude YAML. Page the original source from line one
    // when its Properties cannot fit, including intra-line continuations.
    let totalLines = 1;
    for (let i = 0; i < note.originalContent.length; i++) if (note.originalContent.charCodeAt(i) === 10) totalLines++;
    base = { path, frontmatterOmitted: true, content: '', revision: note.revision, totalContentChars: note.content.length, returnedContentChars: 0, truncated: true,
      nextAction: { endpointId: endpointIdForTool('read_note_lines'), arguments: { path, startLine: 1, endLine: totalLines, expectedRevision: note.revision, maxChars: Math.min(8000, maxChars) } } };
  }
  if (JSON.stringify(base).length > maxChars) {
    return noteReadBudgetError(JSON.stringify(base).length + 64, note.revision);
  }

  const serialize = (end: number) => JSON.stringify({ ...base, content: note.content.slice(0, end), returnedContentChars: end });
  const end = largestFittingPrefix(0, note.content.length, maxChars, serialize);
  return { content: [{ type: 'text' as const, text: end < 0 ? JSON.stringify(base) : serialize(end) }] };
}

export function navigationPageArgs(args: Record<string, any>): { offset: number; limit: number; maxChars: number } {
  const offset = args.offset === undefined ? 0 : Number(args.offset);
  const limit = args.limit === undefined ? 100 : Number(args.limit);
  const maxChars = args.maxChars === undefined ? 6000 : Number(args.maxChars);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw guidanceError(new Error('offset must be an integer between 0 and 100000'), 'guid-4dfa06ea688a863e');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw guidanceError(new Error('limit must be an integer between 1 and 500'), 'guid-6bf09d17dbbaeb91');
  if (!Number.isInteger(maxChars) || maxChars < 1024 || maxChars > 12000) throw guidanceError(new Error('maxChars must be an integer between 1024 and 12000'), 'guid-7063eae9f1d1d723');
  return { offset, limit, maxChars };
}

export function boundedNavigationResult(
  key: 'backlinks' | 'outlinks' | 'unresolved' | 'orphans',
  endpointId: string,
  result: Record<string, any>,
  page: { offset: number; limit: number; maxChars: number },
  args: Record<string, any>,
  toPublicPath: (path: string) => string,
) {
  return { content: [{ type: 'text' as const, text: packNavigationPage(key, endpointId, result, page, args, toPublicPath) }] };
}

export function boundedDirectoryResult(path: string, directories: string[], files: string[], args: Record<string, any>) {
  const page = navigationPageArgs(args);
  const entries = [
    ...directories.map(name => ({ kind: 'directory' as const, name })),
    ...files.map(name => ({ kind: 'file' as const, name })),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
  const candidates = entries.slice(page.offset, page.offset + page.limit);
  const serialize = (count: number) => {
    const selected = candidates.slice(0, count);
    const nextOffset = page.offset + selected.length;
    const truncated = entries.length > nextOffset;
    const value: Record<string, unknown> = {
      path: path || '/',
      offset: page.offset,
      totalEntries: entries.length,
      returned: selected.length,
      dirs: selected.filter(entry => entry.kind === 'directory').map(entry => entry.name),
      files: selected.filter(entry => entry.kind === 'file').map(entry => entry.name),
      truncated,
    };
    if (truncated) value.nextAction = {
      endpointId: endpointIdForTool('list_directory'),
      arguments: { ...(path && { path }), offset: nextOffset, limit: page.limit, maxChars: page.maxChars },
    };
    return JSON.stringify(value, null, args.prettyPrint ? 2 : undefined);
  };
  let count = candidates.length;
  let text = serialize(count);
  while (text.length > page.maxChars && count > 0) text = serialize(--count);
  return { content: [{ type: 'text' as const, text }] };
}

/** Presentation-only fallback: retain the checked source identity and a usable
 * raw-range recovery rather than letting generic compaction erase provenance. */
export function boundedWikiProjectionResult(value: Record<string, any>, args: Record<string, any>) {
  const split = value.mode === 'preview';
  const maxChars = Math.min(split ? 16000 : 12000, Math.max(512, Number(args.maxChars) || (split ? 6000 : 4000)));
  const full = JSON.stringify(value, null, args.prettyPrint ? 2 : undefined);
  if (full.length <= maxChars) return { content: [{ type: 'text' as const, text: full }] };
  const minified = JSON.stringify(value);
  if (minified.length <= maxChars) return { content: [{ type: 'text' as const, text: minified }] };
  const path = split ? value.sourcePath : value.path;
  const revision = split ? value.sourceRevision : value.revision;
  const excerpt = !split && value.contentSource === 'body_excerpt' && value.excerptRange;
  const sourceRange = split ? value.range : value.section || excerpt;
  const range = sourceRange && { startLine: sourceRange.startLine, endLine: sourceRange.endLine };
  const dateIssues = Array.isArray(value.dateIssues) ? value.dateIssues : [];
  let compact: Record<string, any> = {
    ...(split ? { mode: 'preview', sourcePath: path, sourceRevision: revision, range } : { path, revision, view: value.view,
      ...(range && (excerpt ? { contentSource: 'body_excerpt', excerptRange: range } : { section: range })) }),
    ...(split && typeof value.targetPath === 'string' && {
      targetPath: value.targetPath, targetExists: value.targetExists,
      targetUsable: value.targetUsable, collision: value.collision,
    }),
    // Digest-match facts about stored projections are interpretation-critical,
    // not optional display metadata. Preserve false as well as true.
    ...(typeof value.summaryFresh === 'boolean' && { summaryFresh: value.summaryFresh }),
    ...(typeof value.summaryStale === 'boolean' && { summaryStale: value.summaryStale }),
    ...(value.synthesisBasis && { synthesisBasis: { state: value.synthesisBasis.state } }),
    ...(value.bodyComplete === false && { bodyComplete: false }),
    ...(dateIssues.length > 0 && { dateIssues }),
    content: '', truncated: true,
    // A body-only continuation cannot recover malformed Properties. Preserve
    // the same revision, but inspect metadata before interpreting these dates.
    nextAction: dateIssues.length > 0 ? {
      endpointId: 'notes.read', arguments: { path, expectedRevision: revision, maxChars: 8000 },
    } : value.view === 'progressive' && value.bodyComplete === false ? {
      endpointId: 'notes.read', arguments: { path, expectedRevision: revision, maxChars: 4000 },
    } : {
      endpointId: endpointIdForTool(range ? 'read_note_lines' : 'get_note_outline'),
      arguments: { path, ...(range || {}), expectedRevision: revision, maxChars: Math.min(12000, maxChars) },
    },
  };
  // This action re-reads the whole selected range, not a character continuation:
  // agents must replace the preview rather than append it or publish its prefix.
  let minimum = JSON.stringify(compact);
  if (minimum.length > maxChars && dateIssues.length > 0) {
    const { dateIssues: _issues, ...rest } = compact;
    compact = { ...rest, dateIssuesOmitted: true, dateIssuesCount: dateIssues.length };
    minimum = JSON.stringify(compact);
  }
  if (minimum.length > maxChars) return noteReadBudgetError(minimum.length + 64);
  const serialize = (end: number) => JSON.stringify({ ...compact, content: noteReadPrefix(String(value.content || ''), end) });
  const end = largestFittingPrefix(0, Math.min(String(value.content || '').length, maxChars), maxChars, serialize);
  const text = end < 0 ? minimum : serialize(end);
  return { content: [{ type: 'text' as const, text }] };
}

function noteReadPrefix(source: string, length: number) {
  const end = length > 0 && length < source.length && /[\uD800-\uDBFF]/.test(source[length - 1]!) && /[\uDC00-\uDFFF]/.test(source[length]!) ? length - 1 : length;
  return source.slice(0, end);
}

export function noteReadBudgetError(requiredMaxChars: number, revision?: string) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({
    error: 'response_budget_too_small',
    message: guidanceText('guid-e258953bfae18f1a', 'Repeat the same endpoint and arguments, merging retryArguments. No content was consumed.'),
    retryArguments: { maxChars: Math.min(12000, Math.max(512, requiredMaxChars)), ...(revision && { expectedRevision: revision }), prettyPrint: false },
    ...(requiredMaxChars > 12000 && { message: guidanceText('guid-d081d0088496d61d', 'Identifiers exceed the maximum read budget; use a shorter canonical note path.'), retryArguments: undefined }),
  }) }] };
}

// Called only after the current snapshot has passed visibility checks.
export function noteContinuationConflict(path: string, revision: string, args: Record<string, any>, property?: string) {
  if (args.expectedRevision === undefined) return undefined;
  if (typeof args.expectedRevision !== 'string' || !/^[a-fA-F0-9]{64}$/.test(args.expectedRevision)) {
    throw guidanceError(new Error('expectedRevision must be a 64-character SHA-256 hash'), 'guid-96c2f4cbf5c0d32d');
  }
  if (args.expectedRevision.toLowerCase() === revision) return undefined;
  const maxChars = args.maxChars === undefined ? 4000 : Number(args.maxChars);
  const text = JSON.stringify({
    error: 'revision_conflict', restartRequired: true,
    message: property ? 'Source changed. Discard previous pages and restart this Property at the fresh revision.' : 'Source changed. Discard previous pages and restart from this fresh outline.',
    nextAction: property
      ? { endpointId: 'notes.read', arguments: { path, property, offset: 0, expectedRevision: revision, maxChars: Math.min(12000, maxChars) } }
      : { endpointId: endpointIdForTool('get_note_outline'), arguments: { path, maxChars: Math.min(12000, maxChars) } },
  });
  // Preserve the conflict (and the caller's old guard) when its restart path
  // cannot fit; retrying with a larger budget must not silently read new text.
  if (text.length > maxChars) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({
    error: 'revision_conflict', restartRequired: true,
    message: guidanceText('guid-297903d67b150a95', 'Discard previous pages. Repeat the same request with retryArguments to obtain the restart action.'),
    retryArguments: { maxChars: Math.min(12000, text.length + 32), prettyPrint: false },
  }) }] };
  return { isError: true, content: [{ type: 'text' as const, text }] };
}

export function boundedOutlineResult(
  path: string,
  revision: string,
  headings: Array<{ level: number; text: string; line: number }>,
  args: Record<string, any>,
) {
  const afterLine = args.afterLine === undefined ? 0 : Number(args.afterLine);
  const limit = args.limit === undefined ? 100 : Number(args.limit);
  const maxChars = args.maxChars === undefined ? 4000 : Number(args.maxChars);
  if (!Number.isInteger(afterLine) || afterLine < 0) throw guidanceError(new Error('afterLine must be a non-negative integer'), 'guid-0aad9def9d6e5944');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw guidanceError(new Error('limit must be an integer between 1 and 500'), 'guid-6bf09d17dbbaeb91');
  if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 12000) throw guidanceError(new Error('maxChars must be an integer between 512 and 12000'), 'guid-35076f4c7545b431');

  const eligible = headings
    .filter(heading => heading.line > afterLine)
    .map(heading => ({
      ...heading,
      text: noteReadPrefix(heading.text, 240),
      ...(heading.text.length > 240 && { textTruncated: true }),
    }));
  let count = Math.min(limit, eligible.length);
  const serialize = (selectedCount: number, compact = false, pretty = args.prettyPrint, titleLimit = 240) => {
    const selected = eligible.slice(0, selectedCount);
    const remaining = eligible.length - selected.length;
    const value: Record<string, unknown> = {
      ...(!compact && { path, totalHeadings: headings.length, returnedHeadings: selected.length }),
      revision,
      headings: selected.map(heading => ({ ...heading, text: noteReadPrefix(heading.text, titleLimit), ...(heading.text.length > titleLimit && { textTruncated: true }) })),
      truncated: remaining > 0,
    };
    if (remaining > 0) {
      if (!compact) value.remainingHeadings = remaining;
      value.nextAction = {
        endpointId: endpointIdForTool('get_note_outline'),
        arguments: { path, afterLine: selected.at(-1)?.line ?? afterLine, limit, maxChars, expectedRevision: revision },
      };
    }
    return JSON.stringify(value, null, pretty ? 2 : undefined);
  };
  let text = serialize(count);
  while (text.length > maxChars && count > 0) text = serialize(--count);
  if (text.length <= maxChars && (count > 0 || eligible.length === 0)) return { content: [{ type: 'text' as const, text }] };
  for (const compact of [false, true]) {
    count = Math.min(limit, eligible.length);
    text = serialize(count, compact, false);
    while (text.length > maxChars && count > 1) text = serialize(--count, compact, false);
    if (text.length <= maxChars) return { content: [{ type: 'text' as const, text }] };
  }
  // At tiny budgets keep a real locator and an abbreviated title, not an
  // empty heading page that points to itself forever.
  text = serialize(Math.min(1, eligible.length), true, false, 32);
  if (text.length > maxChars) return noteReadBudgetError(text.length + 64, revision);
  return { content: [{ type: 'text' as const, text }] };
}

export function boundedLineWindowResult(
  path: string,
  revision: string,
  window: { content: string; startLine: number; endLine: number; totalLines: number },
  args: Record<string, any>,
) {
  const startColumn = args.startColumn === undefined ? 1 : Number(args.startColumn);
  const maxChars = args.maxChars === undefined ? 6000 : Number(args.maxChars);
  if (!Number.isInteger(startColumn) || startColumn < 1) throw guidanceError(new Error('startColumn must be a positive integer'), 'guid-0ad88fdd6dc1f966');
  if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 12000) throw guidanceError(new Error('maxChars must be an integer between 512 and 12000'), 'guid-35076f4c7545b431');

  const firstBreak = window.content.indexOf('\n');
  const firstLineLength = firstBreak === -1 ? window.content.length : firstBreak;
  const offset = Math.min(startColumn - 1, firstLineLength);
  const effectiveStartColumn = offset + 1;
  const source = window.content.slice(offset);
  const newlinePositions: number[] = [];
  for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1)) newlinePositions.push(index);
  const positionAfter = (consumed: number) => {
    let low = 0;
    let high = newlinePositions.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (newlinePositions[middle]! < consumed) low = middle + 1;
      else high = middle;
    }
    const completedLines = low;
    if (completedLines === 0) return { line: window.startLine, column: effectiveStartColumn + consumed };
    return { line: window.startLine + completedLines, column: consumed - newlinePositions[completedLines - 1]! };
  };
  const serialize = (consumed: number, compact = false, pretty = args.prettyPrint) => {
    const truncated = consumed < source.length;
    const next = truncated ? positionAfter(consumed) : undefined;
    const value: Record<string, unknown> = {
      ...(!compact && { path, requestedEndLine: window.endLine, totalLines: window.totalLines, returnedContentChars: consumed }),
      revision,
      startLine: window.startLine,
      startColumn: effectiveStartColumn,
      content: source.slice(0, consumed),
      truncated,
    };
    if (next) value.nextAction = {
      endpointId: endpointIdForTool('read_note_lines'),
      arguments: { path, startLine: next.line, endLine: window.endLine, startColumn: next.column, maxChars, expectedRevision: revision },
    };
    return JSON.stringify(value, null, pretty ? 2 : undefined);
  };
  const safeBoundary = (end: number) => end > 0 && end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1]!) && /[\uDC00-\uDFFF]/.test(source[end]!) ? end - 1 : end;
  for (const mode of [{ compact: false, pretty: args.prettyPrint }, { compact: false, pretty: false }, { compact: true, pretty: false }]) {
    // A final page has no continuation overhead: test it before the binary
    // search, whose truncated-page size is not monotone at this endpoint.
    if (source.length <= maxChars) {
      const whole = serialize(source.length, mode.compact, mode.pretty);
      if (whole.length <= maxChars) return { content: [{ type: 'text' as const, text: whole }] };
    }
    const end = largestFittingPrefix(0, Math.min(source.length - 1, maxChars), maxChars,
      value => serialize(safeBoundary(value), mode.compact, mode.pretty));
    const consumed = end < 0 ? 0 : safeBoundary(end);
    const selected = end < 0 ? '' : serialize(consumed, mode.compact, mode.pretty);
    if (consumed > 0 && (mode.compact || consumed >= Math.min(64, source.length))) return { content: [{ type: 'text' as const, text: selected }] };
  }
  return noteReadBudgetError(serialize(Math.min(64, source.length), true, false).length + 64, revision);
}
