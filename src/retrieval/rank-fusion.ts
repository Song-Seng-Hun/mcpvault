/** Discovery rank only; no truth, authority or independence claim. */
export function reciprocalRanks(channels: readonly (readonly string[])[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const channel of channels) {
    const seen = new Set<string>();
    for (const id of channel.slice(0, 20)) { if (seen.has(id)) continue; seen.add(id); scores.set(id, (scores.get(id) || 0) + 1 / (60 + seen.size)); }
  }
  return scores;
}
