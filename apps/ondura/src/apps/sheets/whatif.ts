// What-if analysis: goal seek and the solver (simplex for linear models
// with branch and bound for integers, Nelder–Mead for nonlinear ones).

import { type Scalar, isError } from "./formula";
import { type Book, type Overrides, evaluatorWith, key } from "./model";

export interface CellRef {
  sheet: number;
  r: number;
  c: number;
}

const ok = (v: Scalar): v is number => typeof v === "number" && Number.isFinite(v);

/** Value of `target` with the given cells set. */
function model(book: Book, target: CellRef, vars: CellRef[]) {
  return (x: number[], extra: CellRef[] = []): number[] => {
    const ov: Overrides = new Map(vars.map((v, i) => [`${v.sheet}:${key(v.r, v.c)}`, x[i]]));
    const ev = evaluatorWith(book, ov);
    return [target, ...extra].map((t) => {
      const v = ev(t.sheet, t.r, t.c);
      return ok(v) ? v : NaN;
    });
  };
}

// ------------------------------------------------------------ goal seek --

export interface GoalSeekResult {
  found: boolean;
  value: number;
  result: number;
  iterations: number;
}

/** Finds the value of `changing` for which `target` equals `goal` (secant, then bisection). */
export function goalSeek(book: Book, target: CellRef, goal: number, changing: CellRef, start: number): GoalSeekResult {
  const f = (x: number) => model(book, target, [changing])([x])[0] - goal;
  const tol = Math.max(1e-7, Math.abs(goal) * 1e-9);
  let x0 = start;
  let f0 = f(x0);
  let n = 0;
  if (Math.abs(f0) <= tol) return { found: true, value: x0, result: f0 + goal, iterations: 0 };
  let x1 = x0 === 0 ? 1 : x0 * 1.01;
  let f1 = f(x1);
  // Secant steps; remember a sign change for bisection.
  let bracket: [number, number, number, number] | null = null;
  for (; n < 100; n++) {
    if (Number.isFinite(f0) && Number.isFinite(f1) && Math.sign(f0) !== Math.sign(f1)) bracket = [x0, f0, x1, f1];
    if (Math.abs(f1) <= tol) return { found: true, value: x1, result: f1 + goal, iterations: n };
    const d = f1 - f0;
    let x2 = d !== 0 && Number.isFinite(d) ? x1 - (f1 * (x1 - x0)) / d : x1 * 2 + 1;
    if (!Number.isFinite(x2)) x2 = x1 + (x1 - x0) * 2;
    [x0, f0] = [x1, f1];
    x1 = x2;
    f1 = f(x1);
  }
  if (!bracket) {
    // Search outward for a sign change.
    for (let s = 1; s < 1e15 && !bracket; s *= 4) {
      for (const x of [start + s, start - s]) {
        const fx = f(x);
        if (Number.isFinite(fx) && Number.isFinite(f(start)) && Math.sign(fx) !== Math.sign(f(start))) bracket = [start, f(start), x, fx];
      }
    }
  }
  if (bracket) {
    let [a, fa, b] = bracket;
    for (let i = 0; i < 200; i++, n++) {
      const m = (a + b) / 2;
      const fm = f(m);
      if (Math.abs(fm) <= tol) return { found: true, value: m, result: fm + goal, iterations: n };
      if (Math.sign(fm) === Math.sign(fa)) [a, fa] = [m, fm];
      else b = m;
    }
  }
  return { found: false, value: x1, result: f1 + goal, iterations: n };
}

// --------------------------------------------------------------- solver --

export interface Constraint {
  cell: CellRef;
  op: "<=" | ">=" | "=" | "int" | "bin";
  /** Right side: a number or a cell. */
  rhs?: number | CellRef;
}

export interface SolverProblem {
  target: CellRef;
  goal: "max" | "min" | "value";
  value?: number;
  vars: CellRef[];
  constraints: Constraint[];
  nonNegative: boolean;
  method: "auto" | "simplex" | "nonlinear";
}

export interface SolverResult {
  ok: boolean;
  message: string;
  x: number[];
  objective: number;
  linear: boolean;
}

interface Lin {
  c0: number;
  c: number[];
}

/** Linear form of a function, or null if it is not linear (checked at random points). */
function linearize(fn: (x: number[]) => number, n: number, x0: number[]): Lin | null {
  const f0 = fn(x0);
  if (!Number.isFinite(f0)) return null;
  const c = x0.map((_, i) => {
    const x = [...x0];
    x[i] += 1;
    return fn(x) - f0;
  });
  if (c.some((v) => !Number.isFinite(v))) return null;
  const c0 = f0 - c.reduce((s, ci, i) => s + ci * x0[i], 0);
  for (let t = 0; t < 3; t++) {
    const x = x0.map((v) => v + (Math.random() - 0.5) * 20 * (1 + Math.abs(v)));
    const want = c0 + c.reduce((s, ci, i) => s + ci * x[i], 0);
    const got = fn(x);
    if (!(Math.abs(got - want) <= 1e-7 * (1 + Math.abs(want)))) return null;
  }
  void n;
  return { c0, c };
}

/** Maximizes c·x subject to A x (<=, >=, =) b, x >= 0 (two-phase simplex, Bland's rule). */
export function simplex(c: number[], A: number[][], ops: ("<=" | ">=" | "=")[], b: number[]): { status: "optimal" | "infeasible" | "unbounded"; x: number[]; value: number } {
  const n = c.length;
  const m = A.length;
  // Normalize to b >= 0.
  const rows = A.map((r, i) => (b[i] < 0 ? { a: r.map((v) => -v), b: -b[i], op: ops[i] === "<=" ? ">=" : ops[i] === ">=" ? "<=" : "=" } : { a: [...r], b: b[i], op: ops[i] }));
  const slack = rows.filter((r) => r.op !== "=").length;
  const art = rows.filter((r) => r.op !== "<=").length;
  const cols = n + slack + art;
  const T: number[][] = [];
  const basis: number[] = [];
  let si = n;
  let ai = n + slack;
  for (const r of rows) {
    const row = new Array(cols + 1).fill(0);
    r.a.forEach((v, j) => (row[j] = v));
    row[cols] = r.b;
    if (r.op === "<=") {
      row[si] = 1;
      basis.push(si++);
    } else if (r.op === ">=") {
      row[si++] = -1;
      row[ai] = 1;
      basis.push(ai++);
    } else {
      row[ai] = 1;
      basis.push(ai++);
    }
    T.push(row);
  }
  const pivot = (pr: number, pc: number) => {
    const p = T[pr][pc];
    for (let j = 0; j <= cols; j++) T[pr][j] /= p;
    for (let i = 0; i < m; i++) {
      if (i === pr || T[i][pc] === 0) continue;
      const f = T[i][pc];
      for (let j = 0; j <= cols; j++) T[i][j] -= f * T[pr][j];
    }
    basis[pr] = pc;
  };
  const run = (obj: number[], allowed: (j: number) => boolean): "optimal" | "unbounded" => {
    for (let iter = 0; iter < 5000; iter++) {
      // Reduced costs for maximizing obj.
      let enter = -1;
      for (let j = 0; j < cols; j++) {
        if (!allowed(j) || basis.includes(j)) continue;
        let rc = obj[j] ?? 0;
        for (let i = 0; i < m; i++) rc -= (obj[basis[i]] ?? 0) * T[i][j];
        if (rc > 1e-9) {
          enter = j;
          break;
        }
      }
      if (enter < 0) return "optimal";
      let leave = -1;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        if (T[i][enter] > 1e-12) {
          const ratio = T[i][cols] / T[i][enter];
          if (ratio < best - 1e-12 || (Math.abs(ratio - best) <= 1e-12 && basis[i] < basis[leave])) {
            best = ratio;
            leave = i;
          }
        }
      }
      if (leave < 0) return "unbounded";
      pivot(leave, enter);
    }
    return "optimal";
  };
  if (art) {
    const phase1 = new Array(cols).fill(0);
    for (let j = n + slack; j < cols; j++) phase1[j] = -1;
    run(phase1, () => true);
    const infeas = basis.reduce((s, bj, i) => s + (bj >= n + slack ? T[i][cols] : 0), 0);
    if (infeas > 1e-7) return { status: "infeasible", x: new Array(n).fill(0), value: 0 };
    // Drive remaining artificial variables out of the basis.
    for (let i = 0; i < m; i++) {
      if (basis[i] >= n + slack) {
        const j = T[i].findIndex((v, k) => k < n + slack && Math.abs(v) > 1e-9);
        if (j >= 0) pivot(i, j);
      }
    }
  }
  const status = run(c, (j) => j < n + slack);
  const x = new Array(n).fill(0);
  basis.forEach((bj, i) => bj < n && (x[bj] = T[i][cols]));
  return { status, x, value: c.reduce((s, ci, i) => s + ci * x[i], 0) };
}

/** Linear program with integer variables (branch and bound). */
function solveLinear(obj: Lin, maximize: boolean, cons: { lin: Lin; op: "<=" | ">=" | "="; rhs: number }[], ints: Set<number>, free: Set<number>, n: number) {
  // Free variables: x = x⁺ − x⁻.
  const map: [number, number][] = [];
  let k = 0;
  for (let i = 0; i < n; i++) map.push(free.has(i) ? [k++, k++] : [k++, -1]);
  const expand = (v: number[]) => {
    const out = new Array(k).fill(0);
    v.forEach((ci, i) => {
      out[map[i][0]] = ci;
      if (map[i][1] >= 0) out[map[i][1]] = -ci;
    });
    return out;
  };
  const collapse = (x: number[]) => map.map(([p, q]) => x[p] - (q >= 0 ? x[q] : 0));
  const sign = maximize ? 1 : -1;
  let best: { x: number[]; value: number } | null = null;
  let unbounded = false;
  const stack: { A: number[][]; ops: ("<=" | ">=" | "=")[]; b: number[] }[] = [{ A: cons.map((c) => expand(c.lin.c)), ops: cons.map((c) => c.op), b: cons.map((c) => c.rhs - c.lin.c0) }];
  let nodes = 0;
  while (stack.length && nodes++ < 2000) {
    const p = stack.pop()!;
    const r = simplex(expand(obj.c.map((v) => v * sign)), p.A, p.ops, p.b);
    if (r.status === "infeasible") continue;
    if (r.status === "unbounded") {
      unbounded = true;
      continue;
    }
    const x = collapse(r.x);
    const value = sign * r.value;
    if (best && sign * value <= sign * best.value + 1e-9) continue;
    const frac = [...ints].find((i) => Math.abs(x[i] - Math.round(x[i])) > 1e-6);
    if (frac === undefined) {
      best = { x: x.map((v, i) => (ints.has(i) ? Math.round(v) : v)), value };
      continue;
    }
    const row = expand(x.map((_, i) => (i === frac ? 1 : 0)));
    stack.push({ A: [...p.A, row], ops: [...p.ops, ">="], b: [...p.b, Math.ceil(x[frac])] });
    stack.push({ A: [...p.A, row], ops: [...p.ops, "<="], b: [...p.b, Math.floor(x[frac])] });
  }
  return { best: best ? { x: best.x, value: best.value + obj.c0 } : null, unbounded };
}

/** Nelder–Mead on a penalized objective (minimizes). */
function nelderMead(f: (x: number[]) => number, x0: number[], iters = 4000): number[] {
  const n = x0.length;
  let simplexPts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + (Math.abs(v) > 1e-3 ? v * 0.1 : 0.5) : v)))];
  let vals = simplexPts.map(f);
  for (let it = 0; it < iters; it++) {
    const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    simplexPts = order.map(([, i]) => simplexPts[i]);
    vals = order.map(([v]) => v);
    if (Math.abs(vals[n] - vals[0]) < 1e-12 * (1 + Math.abs(vals[0])) && it > 50) break;
    const centroid = x0.map((_, j) => simplexPts.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const at = (t: number) => centroid.map((c, j) => c + t * (simplexPts[n][j] - c));
    const xr = at(-1);
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = at(-2);
      const fe = f(xe);
      [simplexPts[n], vals[n]] = fe < fr ? [xe, fe] : [xr, fr];
    } else if (fr < vals[n - 1]) [simplexPts[n], vals[n]] = [xr, fr];
    else {
      const xc = fr < vals[n] ? at(-0.5) : at(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, vals[n])) [simplexPts[n], vals[n]] = [xc, fc];
      else {
        simplexPts = simplexPts.map((p, i) => (i === 0 ? p : p.map((v, j) => simplexPts[0][j] + 0.5 * (v - simplexPts[0][j]))));
        vals = simplexPts.map(f);
      }
    }
  }
  return simplexPts[vals.indexOf(Math.min(...vals))];
}

export function solve(book: Book, p: SolverProblem, start: number[]): SolverResult {
  const n = p.vars.length;
  const extra = p.constraints.filter((c) => c.op !== "int" && c.op !== "bin").map((c) => c.cell);
  const rhsCells = p.constraints.flatMap((c) => (typeof c.rhs === "object" ? [c.rhs] : []));
  const evalAll = model(book, p.target, p.vars);
  const allCells = [...extra, ...rhsCells];
  const at = (x: number[]) => evalAll(x, allCells);
  const objF = (x: number[]) => at(x)[0];
  const consList = p.constraints.filter((c) => c.op !== "int" && c.op !== "bin");
  const ints = new Set<number>();
  const bins = new Set<number>();
  for (const c of p.constraints) {
    const i = p.vars.findIndex((v) => v.sheet === c.cell.sheet && v.r === c.cell.r && v.c === c.cell.c);
    if (i < 0) continue;
    if (c.op === "int") ints.add(i);
    if (c.op === "bin") (ints.add(i), bins.add(i));
  }
  const rhsOf = (x: number[], c: Constraint) => {
    if (typeof c.rhs === "number") return c.rhs;
    if (!c.rhs) return 0;
    return at(x)[1 + extra.length + rhsCells.indexOf(c.rhs)];
  };
  const x0 = start.map((v) => (Number.isFinite(v) ? v : 0));
  const goalF = (x: number[]) => (p.goal === "value" ? Math.abs(objF(x) - (p.value ?? 0)) : objF(x));
  // Linear model?
  const lin = p.method !== "nonlinear" && p.goal !== "value" ? linearize(objF, n, x0) : null;
  const consLin = lin ? consList.map((c, i) => linearize((x) => at(x)[1 + i] - rhsOf(x, c), n, x0)) : [];
  const linear = !!lin && consLin.every((l) => l);
  if (p.method === "simplex" && !linear) return { ok: false, message: "Das Modell ist nicht linear. Wählen Sie „GRG Nichtlinear“ als Lösungsmethode.", x: x0, objective: objF(x0), linear: false };
  if (linear) {
    const cons = consLin.map((l, i) => ({ lin: l!, op: consList[i].op as "<=" | ">=" | "=", rhs: 0 }));
    for (const b of bins) cons.push({ lin: { c0: 0, c: p.vars.map((_, j) => (j === b ? 1 : 0)) }, op: "<=", rhs: 1 });
    const free = new Set(p.nonNegative ? [] : p.vars.map((_, i) => i));
    const r = solveLinear(lin!, p.goal === "max", cons, ints, free, n);
    if (!r.best) return { ok: false, message: r.unbounded ? "Die Zielzelle konvergiert nicht (das Modell ist unbeschränkt)." : "Solver konnte keine Lösung finden, die alle Nebenbedingungen erfüllt.", x: x0, objective: objF(x0), linear: true };
    const x = r.best.x.map((v) => (Math.abs(v) < 1e-10 ? 0 : v));
    return { ok: true, message: "Solver hat eine Lösung gefunden. Alle Nebenbedingungen und Optimalitätsbedingungen sind erfüllt.", x, objective: objF(x), linear: true };
  }
  // Nonlinear: penalties for violated constraints, several starts.
  const violation = (x: number[]) => {
    const vals = at(x);
    let v = 0;
    consList.forEach((c, i) => {
      const lhs = vals[1 + i];
      const rhs = rhsOf(x, c);
      const d = c.op === "<=" ? Math.max(0, lhs - rhs) : c.op === ">=" ? Math.max(0, rhs - lhs) : Math.abs(lhs - rhs);
      v += d * d;
    });
    if (p.nonNegative) x.forEach((xi) => (v += xi < 0 ? xi * xi : 0));
    ints.forEach((i) => {
      const d = x[i] - Math.round(x[i]);
      v += d * d;
    });
    bins.forEach((i) => (v += x[i] < 0 ? x[i] * x[i] : x[i] > 1 ? (x[i] - 1) ** 2 : 0));
    return v;
  };
  const sign = p.goal === "max" ? -1 : 1;
  let best = x0;
  let bestScore = Infinity;
  for (const mu of [1e2, 1e4, 1e6, 1e8]) {
    const pen = (x: number[]) => {
      const g = goalF(x);
      return Number.isFinite(g) ? sign * g + mu * violation(x) : 1e300;
    };
    const cand = nelderMead(pen, best);
    const score = pen(cand);
    if (score <= bestScore || violation(cand) < violation(best)) [best, bestScore] = [cand, score];
  }
  best = best.map((v, i) => (ints.has(i) ? Math.round(v) : Math.abs(v) < 1e-10 ? 0 : v));
  const feasible = violation(best) < 1e-6;
  const found = feasible && (p.goal !== "value" || Math.abs(objF(best) - (p.value ?? 0)) < 1e-6 * (1 + Math.abs(p.value ?? 0)));
  return {
    ok: found,
    message: found ? "Solver hat eine Lösung gefunden. Alle Nebenbedingungen sind erfüllt (lokales Optimum)." : "Solver konnte keine Lösung finden, die alle Nebenbedingungen erfüllt.",
    x: best,
    objective: objF(best),
    linear: false,
  };
}

export const isNum = (v: Scalar): v is number => typeof v === "number" && !isError(v);
