/**
 * Line diff between two journal snapshots, so each save in the history panel can show what
 * actually changed rather than repeating the whole day's text.
 */

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

export type DiffStat = {
  added: number;
  removed: number;
  /** First added line — the headline of what this save contributed. */
  firstAdded: string | null;
};

/** Guard against the O(n*m) table blowing up on a pathologically long entry. */
const MAX_LINES = 1500;

function split(md: string): string[] {
  return md.replace(/\r\n/g, '\n').split('\n');
}

/**
 * Classic LCS line diff. `prev` is the older snapshot; lines only in `next` are additions.
 * Falls back to a whole-block replace when either side is longer than MAX_LINES.
 */
export function diffLines(prev: string, next: string): DiffLine[] {
  const a = split(prev);
  const b = split(next);

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text): DiffLine => ({ type: 'del', text })),
      ...b.map((text): DiffLine => ({ type: 'add', text })),
    ];
  }

  const at = (arr: string[], i: number): string => arr[i] ?? '';

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  const cell = (i: number, j: number): number => lcs[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lcs[i];
    if (!row) continue;
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] = at(a, i) === at(b, j) ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (at(a, i) === at(b, j)) {
      out.push({ type: 'same', text: at(a, i) });
      i++;
      j++;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      out.push({ type: 'del', text: at(a, i) });
      i++;
    } else {
      out.push({ type: 'add', text: at(b, j) });
      j++;
    }
  }
  while (i < a.length) out.push({ type: 'del', text: at(a, i++) });
  while (j < b.length) out.push({ type: 'add', text: at(b, j++) });

  return out;
}

/** Blank lines are noise in the +/- counts — the trader cares about real lines. */
function isMeaningful(line: DiffLine): boolean {
  return line.text.trim().length > 0;
}

export function diffStat(prev: string, next: string): DiffStat {
  const lines = diffLines(prev, next).filter(isMeaningful);
  const added = lines.filter((l) => l.type === 'add');
  const firstAdded = added[0]?.text.replace(/[#>*`_-]/g, '').trim() ?? null;
  return {
    added: added.length,
    removed: lines.filter((l) => l.type === 'del').length,
    firstAdded: firstAdded && firstAdded.length > 0 ? firstAdded : null,
  };
}
