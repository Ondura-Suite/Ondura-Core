// Myers' O((N+M)·D) difference algorithm over arbitrary tokens, plus the
// grouping of its result into change hunks for "PDF vergleichen".

export type Op = { kind: "equal" | "delete" | "insert"; a: number; b: number };

/**
 * Edit script turning `a` into `b`, or `null` when more than `maxD` edits
 * are needed (very different inputs: the caller falls back to a coarser
 * comparison instead of spending quadratic time).
 */
export function myers<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y, maxD = 4000): Op[] | null {
  // Common prefix and suffix are cheap and keep D small.
  let start = 0;
  while (start < a.length && start < b.length && eq(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) endA--, endB--;
  const n = endA - start;
  const m = endB - start;
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: "equal", a: i, b: i });
  const max = Math.min(n + m, maxD);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(a[start + x], b[start + y])) x++, y++;
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;
  // Backtrack through the saved frontiers.
  const middle: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) middle.push({ kind: "equal", a: start + --x, b: start + --y });
    if (d === 0) break;
    if (x === prevX) middle.push({ kind: "insert", a: start + x, b: start + --y });
    else middle.push({ kind: "delete", a: start + --x, b: start + y });
  }
  while (x > 0 && y > 0) middle.push({ kind: "equal", a: start + --x, b: start + --y });
  while (x > 0) middle.push({ kind: "delete", a: start + --x, b: start + y });
  while (y > 0) middle.push({ kind: "insert", a: start + x, b: start + --y });
  ops.push(...middle.reverse());
  for (let i = 0; i < a.length - endA; i++) ops.push({ kind: "equal", a: endA + i, b: endB + i });
  return ops;
}

export interface Hunk {
  /** Token indices removed from `a` and added in `b`. */
  deleted: number[];
  inserted: number[];
}

/** Consecutive non-equal operations as hunks. */
export function hunks(ops: Op[]): Hunk[] {
  const out: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const op of ops) {
    if (op.kind === "equal") {
      cur = null;
      continue;
    }
    if (!cur) out.push((cur = { deleted: [], inserted: [] }));
    if (op.kind === "delete") cur.deleted.push(op.a);
    else cur.inserted.push(op.b);
  }
  return out;
}
