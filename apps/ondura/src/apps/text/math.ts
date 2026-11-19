// Formulas: a LaTeX subset as input, MathML for display and Office Math
// (OMML) for .docx files – and OMML back to LaTeX for imported formulas.

type MNode =
  | { t: "row"; items: MNode[] }
  | { t: "id" | "num" | "op" | "text"; v: string }
  | { t: "frac"; n: MNode; d: MNode }
  | { t: "sqrt"; b: MNode; deg?: MNode }
  | { t: "script"; base: MNode; sub?: MNode; sup?: MNode }
  | { t: "nary"; op: string; sub?: MNode; sup?: MNode; body: MNode }
  | { t: "fenced"; open: string; close: string; body: MNode };

/** LaTeX command → character. */
export const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  pm: "±", mp: "∓", times: "×", cdot: "·", div: "÷", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡",
  infty: "∞", partial: "∂", nabla: "∇", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", in: "∈", notin: "∉",
  subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", forall: "∀", exists: "∃", cdots: "⋯", ldots: "…", degree: "°", circ: "∘", propto: "∝",
};
const NARY: Record<string, string> = { sum: "∑", prod: "∏", int: "∫", iint: "∬", oint: "∮", bigcup: "⋃", bigcap: "⋂" };
const FUNCS = ["sin", "cos", "tan", "log", "ln", "exp", "lim", "max", "min", "det"];

// ---------------------------------------------------------------- parse --

class Parser {
  private i = 0;
  constructor(private s: string) {}

  parse(): MNode {
    return this.row(null);
  }

  private peek() {
    return this.s[this.i];
  }

  private row(end: string | null): MNode {
    const items: MNode[] = [];
    while (this.i < this.s.length) {
      const c = this.peek();
      if (end && c === end) {
        this.i++;
        break;
      }
      if (c === "\\" && end === ")" && this.s.startsWith("\\right", this.i)) break;
      const atom = this.atom(items);
      if (atom) items.push(atom);
    }
    return items.length === 1 ? items[0] : { t: "row", items };
  }

  private group(): MNode {
    while (this.peek() === " ") this.i++;
    if (this.peek() === "{") {
      this.i++;
      return this.row("}");
    }
    const a = this.atom([]);
    return a ?? { t: "row", items: [] };
  }

  private command(): string {
    let name = "";
    this.i++; // backslash
    while (this.i < this.s.length && /[a-zA-Z]/.test(this.peek())) name += this.s[this.i++];
    if (!name && this.i < this.s.length) name = this.s[this.i++];
    return name;
  }

  private scripts(base: MNode): MNode {
    let sub: MNode | undefined;
    let sup: MNode | undefined;
    for (;;) {
      if (this.peek() === "_") {
        this.i++;
        sub = this.group();
      } else if (this.peek() === "^") {
        this.i++;
        sup = this.group();
      } else break;
    }
    return sub || sup ? { t: "script", base, sub, sup } : base;
  }

  private atom(_before: MNode[]): MNode | null {
    const c = this.peek();
    if (c === " ") {
      this.i++;
      return null;
    }
    if (c === "{") {
      this.i++;
      return this.scripts(this.row("}"));
    }
    if (c === "^" || c === "_") return this.scripts({ t: "row", items: [] });
    if (c === "\\") {
      const name = this.command();
      if (name === "frac") return this.scripts({ t: "frac", n: this.group(), d: this.group() });
      if (name === "sqrt") {
        let deg: MNode | undefined;
        if (this.peek() === "[") {
          this.i++;
          deg = this.row("]");
        }
        return this.scripts({ t: "sqrt", b: this.group(), deg });
      }
      if (name === "text" || name === "mathrm") {
        const g = this.group();
        return { t: "text", v: flatText(g) };
      }
      if (name === "left") {
        const open = this.peek() === "\\" ? this.command() : this.s[this.i++];
        const body = this.row(")");
        let close = ")";
        if (this.s.startsWith("\\right", this.i)) {
          this.i += 6;
          close = this.peek() === "\\" ? this.command() : this.s[this.i++];
        }
        return this.scripts({ t: "fenced", open: open === "." ? "" : open, close: close === "." ? "" : close, body });
      }
      if (NARY[name]) {
        let sub: MNode | undefined;
        let sup: MNode | undefined;
        for (;;) {
          if (this.peek() === "_") (this.i++, (sub = this.group()));
          else if (this.peek() === "^") (this.i++, (sup = this.group()));
          else break;
        }
        while (this.peek() === " ") this.i++;
        const body = this.i < this.s.length && this.peek() !== "}" ? this.group() : { t: "row" as const, items: [] };
        return { t: "nary", op: NARY[name], sub, sup, body };
      }
      if (FUNCS.includes(name)) return this.scripts({ t: "text", v: name });
      if (name === "," || name === ";" || name === "quad") return { t: "op", v: name === "quad" ? " " : " " };
      if (SYMBOLS[name]) {
        const v = SYMBOLS[name];
        return this.scripts(/[α-ωΑ-Ω]/.test(v) ? { t: "id", v } : { t: "op", v });
      }
      return this.scripts({ t: "id", v: name });
    }
    this.i++;
    if (/[0-9.,]/.test(c)) {
      let v = c;
      while (this.i < this.s.length && /[0-9.]/.test(this.peek())) v += this.s[this.i++];
      return this.scripts({ t: "num", v });
    }
    if (/[a-zA-ZÀ-ÿ]/.test(c)) return this.scripts({ t: "id", v: c });
    if (c === "(" || c === "[") {
      const close = c === "(" ? ")" : "]";
      const start = this.i;
      const body = this.row(close);
      // Unbalanced: keep the characters.
      if (this.s[this.i - 1] !== close && this.i >= this.s.length && start === this.i) return { t: "op", v: c };
      return this.scripts({ t: "fenced", open: c, close, body });
    }
    return this.scripts({ t: "op", v: c === "*" ? "·" : c === "-" ? "−" : c });
  }
}

function flatText(n: MNode): string {
  switch (n.t) {
    case "row":
      return n.items.map(flatText).join("");
    case "id":
    case "num":
    case "op":
    case "text":
      return n.v;
    default:
      return "";
  }
}

export function parseLatex(s: string): MNode {
  return new Parser(s).parse();
}

// --------------------------------------------------------------- MathML --

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toMathml(n: MNode, display: boolean): string {
  const m = (x: MNode) => toMathml(x, display);
  switch (n.t) {
    case "row":
      return `<mrow>${n.items.map(m).join("")}</mrow>`;
    case "id":
      return `<mi>${xmlEsc(n.v)}</mi>`;
    case "num":
      return `<mn>${xmlEsc(n.v)}</mn>`;
    case "op":
      return `<mo>${xmlEsc(n.v)}</mo>`;
    case "text":
      return `<mi mathvariant="normal">${xmlEsc(n.v)}</mi>`;
    case "frac":
      return `<mfrac>${m(n.n)}${m(n.d)}</mfrac>`;
    case "sqrt":
      return n.deg ? `<mroot>${m(n.b)}${m(n.deg)}</mroot>` : `<msqrt>${m(n.b)}</msqrt>`;
    case "script":
      if (n.sub && n.sup) return `<msubsup>${m(n.base)}${m(n.sub)}${m(n.sup)}</msubsup>`;
      if (n.sub) return `<msub>${m(n.base)}${m(n.sub)}</msub>`;
      return `<msup>${m(n.base)}${m(n.sup!)}</msup>`;
    case "nary": {
      const op = `<mo largeop="true">${n.op}</mo>`;
      const under = display && n.op !== "∫" && n.op !== "∮" && n.op !== "∬";
      const tag = n.sub && n.sup ? (under ? "munderover" : "msubsup") : n.sub ? (under ? "munder" : "msub") : n.sup ? (under ? "mover" : "msup") : "";
      const head = tag ? `<${tag}>${op}${n.sub ? m(n.sub) : ""}${n.sup ? m(n.sup) : ""}</${tag}>` : op;
      return `<mrow>${head}${m(n.body)}</mrow>`;
    }
    case "fenced":
      return `<mrow><mo>${xmlEsc(n.open)}</mo>${m(n.body)}<mo>${xmlEsc(n.close)}</mo></mrow>`;
  }
}

export function latexToMathml(latex: string, display = false): string {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ""}>${toMathml(parseLatex(latex), display)}</math>`;
}

// ----------------------------------------------------------------- OMML --

function run(v: string, plain = false): string {
  return `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ""}<m:t xml:space="preserve">${xmlEsc(v)}</m:t></m:r>`;
}

function toOmml(n: MNode): string {
  const e = (x: MNode | undefined) => (x ? toOmml(x) : "");
  switch (n.t) {
    case "row":
      return n.items.map(toOmml).join("");
    case "id":
    case "num":
    case "op":
      return run(n.v, n.t !== "id");
    case "text":
      return run(n.v, true);
    case "frac":
      return `<m:f><m:num>${e(n.n)}</m:num><m:den>${e(n.d)}</m:den></m:f>`;
    case "sqrt":
      return n.deg
        ? `<m:rad><m:deg>${e(n.deg)}</m:deg><m:e>${e(n.b)}</m:e></m:rad>`
        : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${e(n.b)}</m:e></m:rad>`;
    case "script":
      if (n.sub && n.sup) return `<m:sSubSup><m:e>${e(n.base)}</m:e><m:sub>${e(n.sub)}</m:sub><m:sup>${e(n.sup)}</m:sup></m:sSubSup>`;
      if (n.sub) return `<m:sSub><m:e>${e(n.base)}</m:e><m:sub>${e(n.sub)}</m:sub></m:sSub>`;
      return `<m:sSup><m:e>${e(n.base)}</m:e><m:sup>${e(n.sup)}</m:sup></m:sSup>`;
    case "nary": {
      const pr = `<m:naryPr><m:chr m:val="${n.op}"/>${n.op === "∫" || n.op === "∮" || n.op === "∬" ? "" : '<m:limLoc m:val="undOvr"/>'}${n.sub ? "" : '<m:subHide m:val="1"/>'}${n.sup ? "" : '<m:supHide m:val="1"/>'}</m:naryPr>`;
      return `<m:nary>${pr}<m:sub>${e(n.sub)}</m:sub><m:sup>${e(n.sup)}</m:sup><m:e>${e(n.body)}</m:e></m:nary>`;
    }
    case "fenced":
      return `<m:d><m:dPr><m:begChr m:val="${xmlEsc(n.open)}"/><m:endChr m:val="${xmlEsc(n.close)}"/></m:dPr><m:e>${e(n.body)}</m:e></m:d>`;
  }
}

/** `m:oMath` element for a LaTeX formula. */
export function latexToOmml(latex: string): string {
  return `<m:oMath>${toOmml(parseLatex(latex))}</m:oMath>`;
}

const REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries({ ...SYMBOLS, ...NARY }).map(([k, v]) => [v, `\\${k}`]),
);
REVERSE["·"] = "\\cdot";
REVERSE["−"] = "-";

const brace = (s: string) => (s.length === 1 ? s : `{${s}}`);

interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: (XNode | string)[];
}

const unesc = (t: string) =>
  t.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );

/** Small XML reader for OMML fragments (no DOM needed). */
function parseXml(src: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      if (stack.length > 1) stack.pop();
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unesc(a[2] ?? a[3] ?? "");
      const el: XNode = { name: m[2].replace(/^[^:]+:/, ""), attrs, children: [] };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[5]) top.children.push(unesc(m[5]));
  }
  return root;
}

/** LaTeX for an imported OMML formula (unknown parts keep their text). */
export function ommlToLatex(omml: string): string {
  const root = parseXml(omml);
  const kids = (el: XNode) => el.children.filter((c): c is XNode => typeof c !== "string");
  const child = (el: XNode, name: string) => kids(el).find((c) => c.name === name);
  const val = (el: XNode | undefined) => (el ? el.attrs["m:val"] ?? el.attrs["val"] ?? null : null);
  const text = (el: XNode): string => el.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
  const seq = (el: XNode | undefined): string => (el ? kids(el).map(walk).join("") : "");
  function walk(el: XNode): string {
    switch (el.name) {
      case "r": {
        const t = kids(el).filter((c) => c.name === "t").map(text).join("");
        return [...t].map((ch) => (REVERSE[ch] ? `${REVERSE[ch]} ` : ch)).join("").replace(/ $/, "").replace(/ (?=[^a-zA-Z])/g, "");
      }
      case "f":
        return `\\frac{${seq(child(el, "num"))}}{${seq(child(el, "den"))}}`;
      case "rad": {
        const deg = seq(child(el, "deg"));
        return deg ? `\\sqrt[${deg}]{${seq(child(el, "e"))}}` : `\\sqrt{${seq(child(el, "e"))}}`;
      }
      case "sSup":
        return `${brace(seq(child(el, "e")))}^${brace(seq(child(el, "sup")))}`;
      case "sSub":
        return `${brace(seq(child(el, "e")))}_${brace(seq(child(el, "sub")))}`;
      case "sSubSup":
        return `${brace(seq(child(el, "e")))}_${brace(seq(child(el, "sub")))}^${brace(seq(child(el, "sup")))}`;
      case "nary": {
        const pr = child(el, "naryPr");
        const chr = (pr && val(child(pr, "chr"))) || "∫";
        const sub = seq(child(el, "sub"));
        const sup = seq(child(el, "sup"));
        return `${REVERSE[chr] ?? chr}${sub ? `_${brace(sub)}` : ""}${sup ? `^${brace(sup)}` : ""} ${brace(seq(child(el, "e")))}`;
      }
      case "d": {
        const pr = child(el, "dPr");
        const open = (pr && val(child(pr, "begChr"))) ?? "(";
        const close = (pr && val(child(pr, "endChr"))) ?? ")";
        return `\\left${open || "."}${kids(el).filter((c) => c.name === "e").map(seq).join(",")}\\right${close || "."}`;
      }
      case "func":
        return `${seq(child(el, "fName"))} ${seq(child(el, "e"))}`;
      case "rPr":
      case "ctrlPr":
      case "fPr":
      case "radPr":
      case "sSupPr":
      case "sSubPr":
      case "sSubSupPr":
      case "naryPr":
      case "dPr":
      case "funcPr":
        return "";
      default:
        return seq(el);
    }
  }
  return kids(root).map(walk).join("").trim();
}
