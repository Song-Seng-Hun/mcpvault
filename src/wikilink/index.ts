export { extractFragment } from './extractFragment.js';
export { parseFragment } from './parseFragment.js';
export { parseWikiLink, resolveWikiLink } from './resolveWikiLink.js';
export { scanBlockIds } from './scanBlockIds.js';
export { scanHeadings } from './scanHeadings.js';

export type {
  ObsidianLinkFragmentType,
  ParsedFragmentResult,
  HeadingInfo,
  BlockIdInfo,
  ExtractionSuccess,
  ExtractionError,
  ExtractionResult,
} from './types.js';

export type {
  ParsedWikiLink,
  WikiLinkResolution,
} from './resolveWikiLink.js';
