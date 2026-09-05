import { buildMarkdownLiteralMask } from './backlinks.js';

/** Body tags only; callers handle Properties and case/count policy separately. */
export function extractInlineTags(content: string): string[] {
  const mask = buildMarkdownLiteralMask(content);
  // Exclude word/URL fragments and repeated heading hashes. Unicode letters,
  // combining marks and emoji retain Korean, decomposed accents and pictographs.
  // Do not include the whole Symbol category: Markdown backticks belong to it.
  const pattern = /(?<![\p{L}\p{M}\p{N}_/#])#([\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}_/\-\u200d]+)/gu;
  const tags: string[] = [];
  for (const match of content.matchAll(pattern)) {
    if (mask[match.index!]) continue;
    let backslashes = 0;
    for (let index = match.index! - 1; index >= 0 && content[index] === '\\'; index -= 1) backslashes += 1;
    if (backslashes % 2 === 1) continue;
    const tag = match[1]!;
    if (/^\p{N}+$/u.test(tag)) continue;
    tags.push(tag);
  }
  return tags;
}
