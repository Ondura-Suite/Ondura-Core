// Formula AutoComplete: function suggestions while typing and the argument
// hint of the function the caret is in (like Excel's formula tooltips).

import { FUNCTIONS, FUNCTION_CATEGORIES, germanName } from "./formula";

/** German argument lists of common functions ("…" = repeating). */
const SIGNATURES: Record<string, string> = {
  SUM: "Zahl1; [Zahl2]; …", AVERAGE: "Zahl1; [Zahl2]; …", MIN: "Zahl1; [Zahl2]; …", MAX: "Zahl1; [Zahl2]; …", COUNT: "Wert1; [Wert2]; …", COUNTA: "Wert1; [Wert2]; …",
  PRODUCT: "Zahl1; [Zahl2]; …", MEDIAN: "Zahl1; [Zahl2]; …", COUNTBLANK: "Bereich", COUNTIF: "Bereich; Suchkriterien", SUMIF: "Bereich; Suchkriterien; [Summe_Bereich]",
  AVERAGEIF: "Bereich; Kriterien; [Mittelwert_Bereich]", COUNTIFS: "Kriterienbereich1; Kriterien1; [Kriterienbereich2; Kriterien2]; …",
  SUMIFS: "Summe_Bereich; Kriterien_Bereich1; Kriterien1; …", AVERAGEIFS: "Mittelwert_Bereich; Kriterien_Bereich1; Kriterien1; …", MAXIFS: "Max_Bereich; Kriterien_Bereich1; Kriterien1; …",
  MINIFS: "Min_Bereich; Kriterien_Bereich1; Kriterien1; …", SUMPRODUCT: "Array1; [Array2]; …", ROUND: "Zahl; Anzahl_Stellen", ROUNDUP: "Zahl; Anzahl_Stellen", ROUNDDOWN: "Zahl; Anzahl_Stellen",
  INT: "Zahl", ABS: "Zahl", MOD: "Zahl; Divisor", POWER: "Zahl; Potenz", SQRT: "Zahl", MROUND: "Zahl; Vielfaches", CEILING: "Zahl; Schritt", FLOOR: "Zahl; Schritt",
  "CEILING.MATH": "Zahl; [Schritt]; [Modus]", "FLOOR.MATH": "Zahl; [Schritt]; [Modus]", TRUNC: "Zahl; [Anzahl_Stellen]", RANDBETWEEN: "Untere_Zahl; Obere_Zahl",
  RANDARRAY: "[Zeilen]; [Spalten]; [Min]; [Max]; [Ganze_Zahl]", SEQUENCE: "Zeilen; [Spalten]; [Anfang]; [Schritt]", SUBTOTAL: "Funktion; Bezug1; [Bezug2]; …",
  AGGREGATE: "Funktion; Optionen; Bezug1; …", IF: "Prüfung; [Wert_wenn_wahr]; [Wert_wenn_falsch]", IFS: "Prüfung1; Wert1; [Prüfung2; Wert2]; …", IFERROR: "Wert; Wert_falls_Fehler",
  IFNA: "Wert; Wert_bei_NV", AND: "Wahrheitswert1; [Wahrheitswert2]; …", OR: "Wahrheitswert1; [Wahrheitswert2]; …", NOT: "Wahrheitswert", XOR: "Wahrheitswert1; [Wahrheitswert2]; …",
  SWITCH: "Ausdruck; Wert1; Ergebnis1; …; [Standard]", LET: "Name1; Wert1; [Name2; Wert2]; …; Berechnung", LAMBDA: "[Parameter1; …]; Berechnung",
  MAP: "Array1; [Array2; …]; LAMBDA", REDUCE: "[Anfangswert]; Array; LAMBDA(Akku; Wert)", SCAN: "[Anfangswert]; Array; LAMBDA(Akku; Wert)", BYROW: "Array; LAMBDA(Zeile)",
  BYCOL: "Array; LAMBDA(Spalte)", MAKEARRAY: "Zeilen; Spalten; LAMBDA(Zeile; Spalte)",
  VLOOKUP: "Suchkriterium; Matrix; Spaltenindex; [Bereich_Verweis]", HLOOKUP: "Suchkriterium; Matrix; Zeilenindex; [Bereich_Verweis]",
  XLOOKUP: "Suchkriterium; Suchmatrix; Rückgabematrix; [Wenn_nicht_gefunden]; [Vergleichsmodus]; [Suchmodus]", XMATCH: "Suchkriterium; Suchmatrix; [Vergleichsmodus]; [Suchmodus]",
  INDEX: "Matrix; Zeile; [Spalte]", MATCH: "Suchkriterium; Suchmatrix; [Vergleichstyp]", LOOKUP: "Suchkriterium; Suchvektor; [Ergebnisvektor]", CHOOSE: "Index; Wert1; [Wert2]; …",
  OFFSET: "Bezug; Zeilen; Spalten; [Höhe]; [Breite]", INDIRECT: "Bezug; [A1]", ADDRESS: "Zeile; Spalte; [Abs]; [A1]; [Tabellenname]", ROW: "[Bezug]", COLUMN: "[Bezug]",
  ROWS: "Matrix", COLUMNS: "Matrix", TRANSPOSE: "Matrix", UNIQUE: "Matrix; [Nach_Spalte]; [Genau_einmal]", SORT: "Matrix; [Sortierindex]; [Sortierreihenfolge]; [Nach_Spalte]",
  SORTBY: "Matrix; Nach_Array1; [Sortierreihenfolge1]; …", FILTER: "Array; Einschließen; [Wenn_leer]", TAKE: "Array; Zeilen; [Spalten]", DROP: "Array; Zeilen; [Spalten]",
  CHOOSECOLS: "Array; Spaltennummer1; [Spaltennummer2]; …", CHOOSEROWS: "Array; Zeilennummer1; [Zeilennummer2]; …", VSTACK: "Array1; [Array2]; …", HSTACK: "Array1; [Array2]; …",
  TOCOL: "Array; [Ignorieren]; [Nach_Spalte]", TOROW: "Array; [Ignorieren]; [Nach_Spalte]", WRAPROWS: "Vektor; Umbruchanzahl; [Auffüllen_mit]", WRAPCOLS: "Vektor; Umbruchanzahl; [Auffüllen_mit]",
  EXPAND: "Array; Zeilen; [Spalten]; [Auffüllen_mit]", GROUPBY: "Zeilenfelder; Werte; Funktion; [Kopfzeilen]; [Gesamtsummen]; [Sortierung]",
  CONCAT: "Text1; [Text2]; …", CONCATENATE: "Text1; [Text2]; …", TEXTJOIN: "Trennzeichen; Leer_ignorieren; Text1; [Text2]; …", LEFT: "Text; [Anzahl_Zeichen]", RIGHT: "Text; [Anzahl_Zeichen]",
  MID: "Text; Erstes_Zeichen; Anzahl_Zeichen", LEN: "Text", UPPER: "Text", LOWER: "Text", PROPER: "Text", TRIM: "Text", SUBSTITUTE: "Text; Alter_Text; Neuer_Text; [Ntes_Auftreten]",
  REPLACE: "Alter_Text; Erstes_Zeichen; Anzahl_Zeichen; Neuer_Text", FIND: "Suchtext; Text; [Erstes_Zeichen]", SEARCH: "Suchtext; Text; [Erstes_Zeichen]", TEXT: "Wert; Textformat",
  VALUE: "Text", REPT: "Text; Multiplikator", TEXTBEFORE: "Text; Trennzeichen; [Instanznummer]; [Vergleichsmodus]; [Bis_Ende]; [Wenn_nicht_gefunden]",
  TEXTAFTER: "Text; Trennzeichen; [Instanznummer]; [Vergleichsmodus]; [Bis_Ende]; [Wenn_nicht_gefunden]", TEXTSPLIT: "Text; Spaltentrennzeichen; [Zeilentrennzeichen]; [Leere_ignorieren]; [Vergleichsmodus]; [Auffüllen_mit]",
  REGEXTEST: "Text; Muster; [Groß/Klein ignorieren]", REGEXEXTRACT: "Text; Muster; [Rückgabemodus]; [Groß/Klein ignorieren]", REGEXREPLACE: "Text; Muster; Ersetzung; [Vorkommen]; [Groß/Klein ignorieren]",
  TODAY: "", NOW: "", DATE: "Jahr; Monat; Tag", TIME: "Stunde; Minute; Sekunde", YEAR: "Zahl", MONTH: "Zahl", DAY: "Zahl", WEEKDAY: "Zahl; [Typ]", ISOWEEKNUM: "Datum",
  WEEKNUM: "Fortlaufende_Zahl; [Zahl_Typ]", EDATE: "Ausgangsdatum; Monate", EOMONTH: "Ausgangsdatum; Monate", DATEDIF: "Ausgangsdatum; Enddatum; Einheit", DAYS: "Zieldatum; Ausgangsdatum",
  NETWORKDAYS: "Ausgangsdatum; Enddatum; [Freie_Tage]", WORKDAY: "Ausgangsdatum; Tage; [Freie_Tage]", "NETWORKDAYS.INTL": "Ausgangsdatum; Enddatum; [Wochenende]; [Freie_Tage]",
  "WORKDAY.INTL": "Ausgangsdatum; Tage; [Wochenende]; [Freie_Tage]", DATEVALUE: "Datumstext", TIMEVALUE: "Zeit", YEARFRAC: "Ausgangsdatum; Enddatum; [Basis]", DAYS360: "Ausgangsdatum; Enddatum; [Methode]",
  PMT: "Zins; Zzr; Bw; [Zw]; [F]", FV: "Zins; Zzr; Rmz; [Bw]; [F]", PV: "Zins; Zzr; Rmz; [Zw]; [F]", NPER: "Zins; Rmz; Bw; [Zw]; [F]", RATE: "Zzr; Rmz; Bw; [Zw]; [F]; [Schätzwert]",
  IPMT: "Zins; Zr; Zzr; Bw; [Zw]; [F]", PPMT: "Zins; Zr; Zzr; Bw; [Zw]; [F]", NPV: "Zins; Wert1; [Wert2]; …", IRR: "Werte; [Schätzwert]", XNPV: "Zins; Werte; Daten", XIRR: "Werte; Daten; [Schätzwert]",
  MIRR: "Werte; Investition; Reinvestition", SLN: "Ansch_Wert; Restwert; Nutzungsdauer", DB: "Ansch_Wert; Restwert; Nutzungsdauer; Periode; [Monate]", DDB: "Ansch_Wert; Restwert; Nutzungsdauer; Periode; [Faktor]",
  EFFECT: "Nominalzins; Perioden", NOMINAL: "Effektiver_Zins; Perioden",
  STDEV: "Zahl1; [Zahl2]; …", "STDEV.S": "Zahl1; [Zahl2]; …", "STDEV.P": "Zahl1; [Zahl2]; …", "VAR.S": "Zahl1; [Zahl2]; …", "VAR.P": "Zahl1; [Zahl2]; …", LARGE: "Matrix; k", SMALL: "Matrix; k",
  RANK: "Zahl; Bezug; [Reihenfolge]", "RANK.EQ": "Zahl; Bezug; [Reihenfolge]", "RANK.AVG": "Zahl; Bezug; [Reihenfolge]", "PERCENTILE.INC": "Matrix; k", "QUARTILE.INC": "Matrix; Quartile",
  CORREL: "Matrix1; Matrix2", SLOPE: "Y_Werte; X_Werte", INTERCEPT: "Y_Werte; X_Werte", RSQ: "Y_Werte; X_Werte", "FORECAST.LINEAR": "x; Y_Werte; X_Werte", TREND: "Y_Werte; [X_Werte]; [Neue_x_Werte]; [Konstante]",
  LINEST: "Y_Werte; [X_Werte]; [Konstante]; [Stats]", FREQUENCY: "Daten; Klassen", "NORM.DIST": "x; Mittelwert; Standabwn; Kumuliert", "NORM.INV": "Wahrsch; Mittelwert; Standabwn",
  "NORM.S.DIST": "z; Kumuliert", "NORM.S.INV": "Wahrsch", "T.DIST": "x; Freiheitsgrade; Kumuliert", "T.INV": "Wahrsch; Freiheitsgrade", "T.TEST": "Matrix1; Matrix2; Seiten; Typ",
  "BINOM.DIST": "Zahl_Erfolge; Versuche; Erfolgswahrsch; Kumuliert", "POISSON.DIST": "x; Mittelwert; Kumuliert", "CHISQ.TEST": "Beob_Messwerte; Erwart_Werte",
  "CONFIDENCE.NORM": "Alpha; Standabwn; Umfang_S",
  ISBLANK: "Wert", ISNUMBER: "Wert", ISTEXT: "Wert", ISERROR: "Wert", ISNA: "Wert", ISFORMULA: "Bezug", FORMULATEXT: "Bezug", TYPE: "Wert",
  CONVERT: "Zahl; Von_Maßeinheit; In_Maßeinheit", DEC2BIN: "Zahl; [Stellen]", DEC2HEX: "Zahl; [Stellen]", HEX2DEC: "Zahl", BIN2DEC: "Zahl",
  DSUM: "Datenbank; Datenbankfeld; Suchkriterien", DAVERAGE: "Datenbank; Datenbankfeld; Suchkriterien", DCOUNT: "Datenbank; Datenbankfeld; Suchkriterien", DGET: "Datenbank; Datenbankfeld; Suchkriterien",
};

const NAME_CHARS = /[A-Za-zÄÖÜäöüß0-9._]/;

export interface FormulaContext {
  /** Partial function name before the caret. */
  prefix: { start: number; text: string } | null;
  /** Innermost function call around the caret and the argument index. */
  call: { name: string; arg: number } | null;
}

/** Where the caret is in a formula (German display form, ";" separates). */
export function formulaContext(text: string, caret: number): FormulaContext {
  const before = text.slice(0, caret);
  let inString = false;
  const stack: { name: string; arg: number }[] = [];
  let word = "";
  let wordStart = 0;
  for (let i = 1; i < before.length; i++) {
    const ch = before[i];
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      word = "";
      continue;
    }
    if (NAME_CHARS.test(ch)) {
      if (!word) wordStart = i;
      word += ch;
      continue;
    }
    if (ch === "(") stack.push({ name: word, arg: 0 });
    else if (ch === ")") stack.pop();
    else if (ch === ";" && stack.length) stack[stack.length - 1].arg++;
    word = "";
  }
  const call = [...stack].reverse().find((c) => c.name) ?? null;
  const prefix = !inString && /^[A-Za-zÄÖÜäöüß]/.test(word) && !/^[A-Za-z]{1,3}\d+$/.test(word) ? { start: wordStart, text: word } : null;
  return { prefix, call };
}

const byGerman = new Map<string, string>();
const ensureNames = () => {
  if (byGerman.size) return;
  for (const en of Object.keys(FUNCTIONS)) byGerman.set(germanName(en), en);
};

/** Functions whose German name starts with the prefix (most used first). */
export function suggestFunctions(prefix: string, limit = 10): { en: string; de: string; category?: string }[] {
  ensureNames();
  const p = prefix.toUpperCase();
  const common = new Set(FUNCTION_CATEGORIES.flatMap((c) => c.fns));
  const out = [...byGerman].filter(([de]) => de.startsWith(p)).map(([de, en]) => ({ de, en, category: FUNCTION_CATEGORIES.find((c) => c.fns.includes(en))?.name }));
  out.sort((a, b) => Number(common.has(b.en)) - Number(common.has(a.en)) || a.de.length - b.de.length || a.de.localeCompare(b.de));
  return out.slice(0, limit);
}

/** English name of a German or English function name. */
export function functionOf(name: string): string | null {
  ensureNames();
  const up = name.toUpperCase();
  if (byGerman.has(up)) return byGerman.get(up)!;
  return FUNCTIONS[up] ? up : null;
}

export function FormulaAssist({ text, caret, index, onPick, style }: { text: string; caret: number; index: number; onPick: (en: string) => void; style?: React.CSSProperties }) {
  const ctx = formulaContext(text, caret);
  const list = ctx.prefix ? suggestFunctions(ctx.prefix.text) : [];
  const exact = list.length === 1 && list[0].de === ctx.prefix?.text.toUpperCase();
  const fn = ctx.call ? functionOf(ctx.call.name) : null;
  if ((!list.length || exact) && !fn) return null;
  const sig = fn ? SIGNATURES[fn] : undefined;
  const args = sig !== undefined ? sig.split("; ").filter(Boolean) : null;
  // The repeating part ("…") keeps the last named argument highlighted.
  const cur = args && ctx.call ? Math.min(ctx.call.arg, args.length - 1 - (args[args.length - 1] === "…" ? 1 : 0)) : -1;
  return (
    <div className="nx-assist" style={style} onMouseDown={(e) => e.preventDefault()}>
      {fn && !(list.length && !exact) && (
        <div className="nx-assist-hint">
          <b>{germanName(fn)}</b>(
          {args
            ? args.map((a, i) => (
                <span key={i}>
                  {i > 0 && "; "}
                  {i === cur ? <b>{a}</b> : a}
                </span>
              ))
            : "…"}
          )
        </div>
      )}
      {list.length > 0 && !exact && (
        <div className="nx-assist-list" role="listbox">
          {list.map((f, i) => (
            <div key={f.en} role="option" aria-selected={i === index} className={i === index ? "on" : undefined} onClick={() => onPick(f.en)}>
              <span>{f.de}</span>
              {f.category && <small>{f.category}</small>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Suggestion count, for keyboard navigation. */
export function assistCount(text: string, caret: number) {
  const ctx = formulaContext(text, caret);
  if (!ctx.prefix) return 0;
  const list = suggestFunctions(ctx.prefix.text);
  return list.length === 1 && list[0].de === ctx.prefix.text.toUpperCase() ? 0 : list.length;
}

/** Text after accepting a suggestion: the name and "(" replace the prefix. */
export function acceptSuggestion(text: string, caret: number, en: string): { text: string; caret: number } {
  const ctx = formulaContext(text, caret);
  const start = ctx.prefix?.start ?? caret;
  const name = germanName(en);
  const hasParen = text[caret] === "(";
  const insert = name + (hasParen ? "" : "(");
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length + (hasParen ? 1 : 0) };
}

export function pickIndex(text: string, caret: number, index: number) {
  const ctx = formulaContext(text, caret);
  return ctx.prefix ? suggestFunctions(ctx.prefix.text)[index]?.en ?? null : null;
}
