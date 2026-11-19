// Formula AutoComplete: function suggestions while typing and the argument
// hint of the function the caret is in (like Excel's formula tooltips).

import { FUNCTIONS, FUNCTION_CATEGORIES, germanName } from "./formula";
import { tl } from "../../lib/i18n";

/** German argument lists of common functions ("…" = repeating). */
const SIGNATURES: Record<string, string> = {
  SUM: tl("Zahl1; [Zahl2]; …"), AVERAGE: tl("Zahl1; [Zahl2]; …"), MIN: tl("Zahl1; [Zahl2]; …"), MAX: tl("Zahl1; [Zahl2]; …"), COUNT: tl("Wert1; [Wert2]; …"), COUNTA: tl("Wert1; [Wert2]; …"),
  PRODUCT: tl("Zahl1; [Zahl2]; …"), MEDIAN: tl("Zahl1; [Zahl2]; …"), COUNTBLANK: tl("Bereich"), COUNTIF: tl("Bereich; Suchkriterien"), SUMIF: tl("Bereich; Suchkriterien; [Summe_Bereich]"),
  AVERAGEIF: tl("Bereich; Kriterien; [Mittelwert_Bereich]"), COUNTIFS: tl("Kriterienbereich1; Kriterien1; [Kriterienbereich2; Kriterien2]; …"),
  SUMIFS: tl("Summe_Bereich; Kriterien_Bereich1; Kriterien1; …"), AVERAGEIFS: tl("Mittelwert_Bereich; Kriterien_Bereich1; Kriterien1; …"), MAXIFS: tl("Max_Bereich; Kriterien_Bereich1; Kriterien1; …"),
  MINIFS: tl("Min_Bereich; Kriterien_Bereich1; Kriterien1; …"), SUMPRODUCT: tl("Array1; [Array2]; …"), ROUND: tl("Zahl; Anzahl_Stellen"), ROUNDUP: tl("Zahl; Anzahl_Stellen"), ROUNDDOWN: tl("Zahl; Anzahl_Stellen"),
  INT: tl("Zahl"), ABS: tl("Zahl"), MOD: tl("Zahl; Divisor"), POWER: tl("Zahl; Potenz"), SQRT: tl("Zahl"), MROUND: tl("Zahl; Vielfaches"), CEILING: tl("Zahl; Schritt"), FLOOR: tl("Zahl; Schritt"),
  "CEILING.MATH": tl("Zahl; [Schritt]; [Modus]"), "FLOOR.MATH": tl("Zahl; [Schritt]; [Modus]"), TRUNC: tl("Zahl; [Anzahl_Stellen]"), RANDBETWEEN: tl("Untere_Zahl; Obere_Zahl"),
  RANDARRAY: tl("[Zeilen]; [Spalten]; [Min]; [Max]; [Ganze_Zahl]"), SEQUENCE: tl("Zeilen; [Spalten]; [Anfang]; [Schritt]"), SUBTOTAL: tl("Funktion; Bezug1; [Bezug2]; …"),
  AGGREGATE: tl("Funktion; Optionen; Bezug1; …"), IF: tl("Prüfung; [Wert_wenn_wahr]; [Wert_wenn_falsch]"), IFS: tl("Prüfung1; Wert1; [Prüfung2; Wert2]; …"), IFERROR: tl("Wert; Wert_falls_Fehler"),
  IFNA: tl("Wert; Wert_bei_NV"), AND: tl("Wahrheitswert1; [Wahrheitswert2]; …"), OR: tl("Wahrheitswert1; [Wahrheitswert2]; …"), NOT: tl("Wahrheitswert"), XOR: tl("Wahrheitswert1; [Wahrheitswert2]; …"),
  SWITCH: tl("Ausdruck; Wert1; Ergebnis1; …; [Standard]"), LET: tl("Name1; Wert1; [Name2; Wert2]; …; Berechnung"), LAMBDA: tl("[Parameter1; …]; Berechnung"),
  MAP: tl("Array1; [Array2; …]; LAMBDA"), REDUCE: tl("[Anfangswert]; Array; LAMBDA(Akku; Wert)"), SCAN: tl("[Anfangswert]; Array; LAMBDA(Akku; Wert)"), BYROW: tl("Array; LAMBDA(Zeile)"),
  BYCOL: tl("Array; LAMBDA(Spalte)"), MAKEARRAY: tl("Zeilen; Spalten; LAMBDA(Zeile; Spalte)"),
  VLOOKUP: tl("Suchkriterium; Matrix; Spaltenindex; [Bereich_Verweis]"), HLOOKUP: tl("Suchkriterium; Matrix; Zeilenindex; [Bereich_Verweis]"),
  XLOOKUP: tl("Suchkriterium; Suchmatrix; Rückgabematrix; [Wenn_nicht_gefunden]; [Vergleichsmodus]; [Suchmodus]"), XMATCH: tl("Suchkriterium; Suchmatrix; [Vergleichsmodus]; [Suchmodus]"),
  INDEX: tl("Matrix; Zeile; [Spalte]"), MATCH: tl("Suchkriterium; Suchmatrix; [Vergleichstyp]"), LOOKUP: tl("Suchkriterium; Suchvektor; [Ergebnisvektor]"), CHOOSE: tl("Index; Wert1; [Wert2]; …"),
  OFFSET: tl("Bezug; Zeilen; Spalten; [Höhe]; [Breite]"), INDIRECT: tl("Bezug; [A1]"), ADDRESS: tl("Zeile; Spalte; [Abs]; [A1]; [Tabellenname]"), ROW: "[Bezug]", COLUMN: "[Bezug]",
  ROWS: tl("Matrix"), COLUMNS: tl("Matrix"), TRANSPOSE: tl("Matrix"), UNIQUE: tl("Matrix; [Nach_Spalte]; [Genau_einmal]"), SORT: tl("Matrix; [Sortierindex]; [Sortierreihenfolge]; [Nach_Spalte]"),
  SORTBY: tl("Matrix; Nach_Array1; [Sortierreihenfolge1]; …"), FILTER: tl("Array; Einschließen; [Wenn_leer]"), TAKE: tl("Array; Zeilen; [Spalten]"), DROP: tl("Array; Zeilen; [Spalten]"),
  CHOOSECOLS: tl("Array; Spaltennummer1; [Spaltennummer2]; …"), CHOOSEROWS: tl("Array; Zeilennummer1; [Zeilennummer2]; …"), VSTACK: tl("Array1; [Array2]; …"), HSTACK: tl("Array1; [Array2]; …"),
  TOCOL: tl("Array; [Ignorieren]; [Nach_Spalte]"), TOROW: tl("Array; [Ignorieren]; [Nach_Spalte]"), WRAPROWS: tl("Vektor; Umbruchanzahl; [Auffüllen_mit]"), WRAPCOLS: tl("Vektor; Umbruchanzahl; [Auffüllen_mit]"),
  EXPAND: tl("Array; Zeilen; [Spalten]; [Auffüllen_mit]"), GROUPBY: tl("Zeilenfelder; Werte; Funktion; [Kopfzeilen]; [Gesamtsummen]; [Sortierung]"),
  CONCAT: tl("Text1; [Text2]; …"), CONCATENATE: tl("Text1; [Text2]; …"), TEXTJOIN: tl("Trennzeichen; Leer_ignorieren; Text1; [Text2]; …"), LEFT: tl("Text; [Anzahl_Zeichen]"), RIGHT: tl("Text; [Anzahl_Zeichen]"),
  MID: tl("Text; Erstes_Zeichen; Anzahl_Zeichen"), LEN: tl("Text"), UPPER: tl("Text"), LOWER: tl("Text"), PROPER: tl("Text"), TRIM: tl("Text"), SUBSTITUTE: tl("Text; Alter_Text; Neuer_Text; [Ntes_Auftreten]"),
  REPLACE: tl("Alter_Text; Erstes_Zeichen; Anzahl_Zeichen; Neuer_Text"), FIND: tl("Suchtext; Text; [Erstes_Zeichen]"), SEARCH: tl("Suchtext; Text; [Erstes_Zeichen]"), TEXT: tl("Wert; Textformat"),
  VALUE: tl("Text"), REPT: tl("Text; Multiplikator"), TEXTBEFORE: tl("Text; Trennzeichen; [Instanznummer]; [Vergleichsmodus]; [Bis_Ende]; [Wenn_nicht_gefunden]"),
  TEXTAFTER: tl("Text; Trennzeichen; [Instanznummer]; [Vergleichsmodus]; [Bis_Ende]; [Wenn_nicht_gefunden]"), TEXTSPLIT: tl("Text; Spaltentrennzeichen; [Zeilentrennzeichen]; [Leere_ignorieren]; [Vergleichsmodus]; [Auffüllen_mit]"),
  REGEXTEST: tl("Text; Muster; [Groß/Klein ignorieren]"), REGEXEXTRACT: tl("Text; Muster; [Rückgabemodus]; [Groß/Klein ignorieren]"), REGEXREPLACE: tl("Text; Muster; Ersetzung; [Vorkommen]; [Groß/Klein ignorieren]"),
  TODAY: "", NOW: "", DATE: tl("Jahr; Monat; Tag"), TIME: tl("Stunde; Minute; Sekunde"), YEAR: tl("Zahl"), MONTH: tl("Zahl"), DAY: tl("Zahl"), WEEKDAY: tl("Zahl; [Typ]"), ISOWEEKNUM: tl("Datum"),
  WEEKNUM: tl("Fortlaufende_Zahl; [Zahl_Typ]"), EDATE: tl("Ausgangsdatum; Monate"), EOMONTH: tl("Ausgangsdatum; Monate"), DATEDIF: tl("Ausgangsdatum; Enddatum; Einheit"), DAYS: tl("Zieldatum; Ausgangsdatum"),
  NETWORKDAYS: tl("Ausgangsdatum; Enddatum; [Freie_Tage]"), WORKDAY: tl("Ausgangsdatum; Tage; [Freie_Tage]"), "NETWORKDAYS.INTL": tl("Ausgangsdatum; Enddatum; [Wochenende]; [Freie_Tage]"),
  "WORKDAY.INTL": tl("Ausgangsdatum; Tage; [Wochenende]; [Freie_Tage]"), DATEVALUE: tl("Datumstext"), TIMEVALUE: tl("Zeit"), YEARFRAC: tl("Ausgangsdatum; Enddatum; [Basis]"), DAYS360: tl("Ausgangsdatum; Enddatum; [Methode]"),
  PMT: tl("Zins; Zzr; Bw; [Zw]; [F]"), FV: tl("Zins; Zzr; Rmz; [Bw]; [F]"), PV: tl("Zins; Zzr; Rmz; [Zw]; [F]"), NPER: tl("Zins; Rmz; Bw; [Zw]; [F]"), RATE: tl("Zzr; Rmz; Bw; [Zw]; [F]; [Schätzwert]"),
  IPMT: tl("Zins; Zr; Zzr; Bw; [Zw]; [F]"), PPMT: tl("Zins; Zr; Zzr; Bw; [Zw]; [F]"), NPV: tl("Zins; Wert1; [Wert2]; …"), IRR: tl("Werte; [Schätzwert]"), XNPV: tl("Zins; Werte; Daten"), XIRR: tl("Werte; Daten; [Schätzwert]"),
  MIRR: tl("Werte; Investition; Reinvestition"), SLN: tl("Ansch_Wert; Restwert; Nutzungsdauer"), DB: tl("Ansch_Wert; Restwert; Nutzungsdauer; Periode; [Monate]"), DDB: tl("Ansch_Wert; Restwert; Nutzungsdauer; Periode; [Faktor]"),
  EFFECT: tl("Nominalzins; Perioden"), NOMINAL: tl("Effektiver_Zins; Perioden"),
  STDEV: tl("Zahl1; [Zahl2]; …"), "STDEV.S": tl("Zahl1; [Zahl2]; …"), "STDEV.P": tl("Zahl1; [Zahl2]; …"), "VAR.S": tl("Zahl1; [Zahl2]; …"), "VAR.P": tl("Zahl1; [Zahl2]; …"), LARGE: tl("Matrix; k"), SMALL: tl("Matrix; k"),
  RANK: tl("Zahl; Bezug; [Reihenfolge]"), "RANK.EQ": tl("Zahl; Bezug; [Reihenfolge]"), "RANK.AVG": tl("Zahl; Bezug; [Reihenfolge]"), "PERCENTILE.INC": tl("Matrix; k"), "QUARTILE.INC": tl("Matrix; Quartile"),
  CORREL: tl("Matrix1; Matrix2"), SLOPE: tl("Y_Werte; X_Werte"), INTERCEPT: tl("Y_Werte; X_Werte"), RSQ: tl("Y_Werte; X_Werte"), "FORECAST.LINEAR": tl("x; Y_Werte; X_Werte"), TREND: tl("Y_Werte; [X_Werte]; [Neue_x_Werte]; [Konstante]"),
  LINEST: tl("Y_Werte; [X_Werte]; [Konstante]; [Stats]"), FREQUENCY: tl("Daten; Klassen"), "NORM.DIST": tl("x; Mittelwert; Standabwn; Kumuliert"), "NORM.INV": tl("Wahrsch; Mittelwert; Standabwn"),
  "NORM.S.DIST": tl("z; Kumuliert"), "NORM.S.INV": tl("Wahrsch"), "T.DIST": tl("x; Freiheitsgrade; Kumuliert"), "T.INV": tl("Wahrsch; Freiheitsgrade"), "T.TEST": tl("Matrix1; Matrix2; Seiten; Typ"),
  "BINOM.DIST": tl("Zahl_Erfolge; Versuche; Erfolgswahrsch; Kumuliert"), "POISSON.DIST": tl("x; Mittelwert; Kumuliert"), "CHISQ.TEST": tl("Beob_Messwerte; Erwart_Werte"),
  "CONFIDENCE.NORM": tl("Alpha; Standabwn; Umfang_S"),
  ISBLANK: tl("Wert"), ISNUMBER: tl("Wert"), ISTEXT: tl("Wert"), ISERROR: tl("Wert"), ISNA: tl("Wert"), ISFORMULA: tl("Bezug"), FORMULATEXT: tl("Bezug"), TYPE: tl("Wert"),
  CONVERT: tl("Zahl; Von_Maßeinheit; In_Maßeinheit"), DEC2BIN: tl("Zahl; [Stellen]"), DEC2HEX: tl("Zahl; [Stellen]"), HEX2DEC: tl("Zahl"), BIN2DEC: tl("Zahl"),
  DSUM: tl("Datenbank; Datenbankfeld; Suchkriterien"), DAVERAGE: tl("Datenbank; Datenbankfeld; Suchkriterien"), DCOUNT: tl("Datenbank; Datenbankfeld; Suchkriterien"), DGET: tl("Datenbank; Datenbankfeld; Suchkriterien"),
  PRICE: tl("Abrechnung; Fälligkeit; Zins; Rendite; Rückzahlung; Häufigkeit; [Basis]"), YIELD: tl("Abrechnung; Fälligkeit; Zins; Kurs; Rückzahlung; Häufigkeit; [Basis]"),
  DURATION: tl("Abrechnung; Fälligkeit; Kupon; Rendite; Häufigkeit; [Basis]"), MDURATION: tl("Abrechnung; Fälligkeit; Kupon; Rendite; Häufigkeit; [Basis]"),
  ACCRINT: tl("Emission; Erster_Zinstermin; Abrechnung; Zins; Nennwert; Häufigkeit; [Basis]; [Berechnungsmethode]"), ACCRINTM: tl("Emission; Abrechnung; Zins; Nennwert; [Basis]"),
  COUPNUM: tl("Abrechnung; Fälligkeit; Häufigkeit; [Basis]"), COUPNCD: tl("Abrechnung; Fälligkeit; Häufigkeit; [Basis]"), COUPPCD: tl("Abrechnung; Fälligkeit; Häufigkeit; [Basis]"),
  DISC: tl("Abrechnung; Fälligkeit; Kurs; Rückzahlung; [Basis]"), INTRATE: tl("Abrechnung; Fälligkeit; Anlage; Rückzahlung; [Basis]"), TBILLPRICE: tl("Abrechnung; Fälligkeit; Abzinsung"),
  AMORLINC: tl("Ansch_Wert; Kaufdatum; Erster_Zinstermin; Restwert; Periode; Rate; [Basis]"), EUROCONVERT: tl("Zahl; Quelle; Ziel; [Genauigkeit]; [Triangulation]"),
  "FORECAST.ETS": tl("Ziel_Datum; Werte; Zeitachse; [Saisonalität]; [Datenvervollständigung]; [Aggregation]"), "FORECAST.ETS.SEASONALITY": tl("Werte; Zeitachse; [Datenvervollständigung]; [Aggregation]"),
  "FORECAST.ETS.CONFINT": tl("Ziel_Datum; Werte; Zeitachse; [Konfidenzniveau]; [Saisonalität]; [Datenvervollständigung]; [Aggregation]"), "F.TEST": tl("Matrix1; Matrix2"),
  COMPLEX: tl("Realteil; Imaginärteil; [Suffix]"), IMSUM: tl("Komplexe_Zahl1; [Komplexe_Zahl2]; …"), IMPRODUCT: tl("Komplexe_Zahl1; [Komplexe_Zahl2]; …"), IMDIV: tl("Komplexe_Zahl1; Komplexe_Zahl2"),
  IMPOWER: tl("Komplexe_Zahl; Potenz"), BESSELJ: tl("x; n"), BESSELY: tl("x; n"), BESSELI: tl("x; n"), BESSELK: tl("x; n"),
  PIVOTBY: tl("Zeilenfelder; Spaltenfelder; Werte; Funktion; [Feldkopfzeilen]; [Zeilensummentiefe]; [Zeilensortierung]; [Spaltensummentiefe]; [Spaltensortierung]"),
  TRIMRANGE: tl("Bereich; [Zeilen_kürzen]; [Spalten_kürzen]"),
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
