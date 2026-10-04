function distance(a, b) {
  const row = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** Closest candidate within a typo-sized edit distance, or undefined. */
export function closest(input, candidates) {
  let best, bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(input.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return bestScore <= Math.max(1, Math.floor(input.length / 3)) ? best : undefined;
}

/** Suggest a full command for mistyped words, comparing the same number of words. */
export function suggestCommand(args, names) {
  const words = args.filter(a => !a.startsWith('-'));
  for (let size = 3; size >= 1; size--) {
    const typed = words.slice(0, size).join(' ');
    const match = closest(typed, names.filter(name => name.split(' ').length === size));
    if (match && match !== typed) return match;
  }
  const group = closest(words[0] || '', [...new Set(names.map(name => name.split(' ')[0]))]);
  return group && group !== words[0] ? group : undefined;
}
