// Public holidays per country (and German state), computed locally so the
// calendar can show them without a server. Names are in the country's own
// language, like the holiday calendars of other mail apps.

export interface Holiday {
  /** yyyy-mm-dd */
  date: string;
  name: string;
}

export const HOLIDAY_COUNTRIES: { code: string; name: string }[] = [
  { code: "DE", name: "Deutschland" },
  { code: "AT", name: "Österreich" },
  { code: "CH", name: "Schweiz" },
  { code: "FR", name: "France" },
  { code: "BE", name: "Belgique / België" },
  { code: "NL", name: "Nederland" },
  { code: "IT", name: "Italia" },
  { code: "ES", name: "España" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

/** German states (for regional holidays). */
export const DE_STATES: { code: string; name: string }[] = [
  { code: "BW", name: "Baden-Württemberg" },
  { code: "BY", name: "Bayern" },
  { code: "BE", name: "Berlin" },
  { code: "BB", name: "Brandenburg" },
  { code: "HB", name: "Bremen" },
  { code: "HH", name: "Hamburg" },
  { code: "HE", name: "Hessen" },
  { code: "MV", name: "Mecklenburg-Vorpommern" },
  { code: "NI", name: "Niedersachsen" },
  { code: "NW", name: "Nordrhein-Westfalen" },
  { code: "RP", name: "Rheinland-Pfalz" },
  { code: "SL", name: "Saarland" },
  { code: "SN", name: "Sachsen" },
  { code: "ST", name: "Sachsen-Anhalt" },
  { code: "SH", name: "Schleswig-Holstein" },
  { code: "TH", name: "Thüringen" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const plus = (d: Date, days: number) => new Date(d.getTime() + days * 86400_000);

/** Easter Sunday (anonymous Gregorian algorithm). */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return at(year, month, day);
}

/** n-th weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = at(year, month, 1);
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return plus(first, offset + (n - 1) * 7);
  }
  const last = at(year, month + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return plus(last, -offset);
}

/** Weekend holiday moved to the next working day (UK "substitute day"). */
function substitute(d: Date, taken: Set<string> = new Set()): Date {
  let x = d;
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6 || taken.has(iso(x))) x = plus(x, 1);
  return x;
}

export function holidays(year: number, country: string, region = ""): Holiday[] {
  const E = easter(year);
  const list: [Date, string][] = [];
  const add = (d: Date, name: string, ...regions: string[]) => {
    if (!regions.length || regions.includes(region)) list.push([d, name]);
  };
  switch (country) {
    case "DE":
      add(at(year, 1, 1), "Neujahr");
      add(at(year, 1, 6), "Heilige Drei Könige", "BW", "BY", "ST");
      if (year >= 2019) add(at(year, 3, 8), "Internationaler Frauentag", "BE", ...(year >= 2023 ? ["MV"] : []));
      add(plus(E, -2), "Karfreitag");
      add(E, "Ostersonntag", "BB");
      add(plus(E, 1), "Ostermontag");
      add(at(year, 5, 1), "Tag der Arbeit");
      add(plus(E, 39), "Christi Himmelfahrt");
      add(plus(E, 49), "Pfingstsonntag", "BB");
      add(plus(E, 50), "Pfingstmontag");
      add(plus(E, 60), "Fronleichnam", "BW", "BY", "HE", "NW", "RP", "SL");
      add(at(year, 8, 15), "Mariä Himmelfahrt", "SL");
      if (year >= 2019) add(at(year, 9, 20), "Weltkindertag", "TH");
      add(at(year, 10, 3), "Tag der Deutschen Einheit");
      add(at(year, 10, 31), "Reformationstag", "BB", "MV", "SN", "ST", "TH", "HB", "HH", "NI", "SH");
      add(at(year, 11, 1), "Allerheiligen", "BW", "BY", "NW", "RP", "SL");
      // Wednesday before 23 November.
      add(plus(at(year, 11, 23), -((at(year, 11, 23).getUTCDay() + 4) % 7 || 7)), "Buß- und Bettag", "SN");
      add(at(year, 12, 25), "1. Weihnachtstag");
      add(at(year, 12, 26), "2. Weihnachtstag");
      break;
    case "AT":
      add(at(year, 1, 1), "Neujahr");
      add(at(year, 1, 6), "Heilige Drei Könige");
      add(plus(E, 1), "Ostermontag");
      add(at(year, 5, 1), "Staatsfeiertag");
      add(plus(E, 39), "Christi Himmelfahrt");
      add(plus(E, 50), "Pfingstmontag");
      add(plus(E, 60), "Fronleichnam");
      add(at(year, 8, 15), "Mariä Himmelfahrt");
      add(at(year, 10, 26), "Nationalfeiertag");
      add(at(year, 11, 1), "Allerheiligen");
      add(at(year, 12, 8), "Mariä Empfängnis");
      add(at(year, 12, 25), "Christtag");
      add(at(year, 12, 26), "Stefanitag");
      break;
    case "CH":
      add(at(year, 1, 1), "Neujahr");
      add(at(year, 1, 2), "Berchtoldstag");
      add(plus(E, -2), "Karfreitag");
      add(plus(E, 1), "Ostermontag");
      add(plus(E, 39), "Auffahrt");
      add(plus(E, 50), "Pfingstmontag");
      add(at(year, 8, 1), "Bundesfeiertag");
      add(at(year, 12, 25), "Weihnachten");
      add(at(year, 12, 26), "Stephanstag");
      break;
    case "FR":
      add(at(year, 1, 1), "Jour de l'an");
      add(plus(E, 1), "Lundi de Pâques");
      add(at(year, 5, 1), "Fête du Travail");
      add(at(year, 5, 8), "Victoire 1945");
      add(plus(E, 39), "Ascension");
      add(plus(E, 50), "Lundi de Pentecôte");
      add(at(year, 7, 14), "Fête nationale");
      add(at(year, 8, 15), "Assomption");
      add(at(year, 11, 1), "Toussaint");
      add(at(year, 11, 11), "Armistice 1918");
      add(at(year, 12, 25), "Noël");
      break;
    case "BE":
      add(at(year, 1, 1), "Nouvel An / Nieuwjaar");
      add(plus(E, 1), "Lundi de Pâques / Paasmaandag");
      add(at(year, 5, 1), "Fête du Travail / Dag van de Arbeid");
      add(plus(E, 39), "Ascension / O.L.H. Hemelvaart");
      add(plus(E, 50), "Lundi de Pentecôte / Pinkstermaandag");
      add(at(year, 7, 21), "Fête nationale / Nationale feestdag");
      add(at(year, 8, 15), "Assomption / O.L.V. Hemelvaart");
      add(at(year, 11, 1), "Toussaint / Allerheiligen");
      add(at(year, 11, 11), "Armistice / Wapenstilstand");
      add(at(year, 12, 25), "Noël / Kerstmis");
      break;
    case "NL": {
      add(at(year, 1, 1), "Nieuwjaarsdag");
      add(E, "Eerste Paasdag");
      add(plus(E, 1), "Tweede Paasdag");
      const kings = at(year, 4, 27);
      add(kings.getUTCDay() === 0 ? at(year, 4, 26) : kings, "Koningsdag");
      add(at(year, 5, 5), "Bevrijdingsdag");
      add(plus(E, 39), "Hemelvaartsdag");
      add(plus(E, 49), "Eerste Pinksterdag");
      add(plus(E, 50), "Tweede Pinksterdag");
      add(at(year, 12, 25), "Eerste Kerstdag");
      add(at(year, 12, 26), "Tweede Kerstdag");
      break;
    }
    case "IT":
      add(at(year, 1, 1), "Capodanno");
      add(at(year, 1, 6), "Epifania");
      add(plus(E, 1), "Lunedì dell'Angelo");
      add(at(year, 4, 25), "Festa della Liberazione");
      add(at(year, 5, 1), "Festa del Lavoro");
      add(at(year, 6, 2), "Festa della Repubblica");
      add(at(year, 8, 15), "Ferragosto");
      add(at(year, 11, 1), "Ognissanti");
      add(at(year, 12, 8), "Immacolata Concezione");
      add(at(year, 12, 25), "Natale");
      add(at(year, 12, 26), "Santo Stefano");
      break;
    case "ES":
      add(at(year, 1, 1), "Año Nuevo");
      add(at(year, 1, 6), "Epifanía del Señor");
      add(plus(E, -2), "Viernes Santo");
      add(at(year, 5, 1), "Fiesta del Trabajo");
      add(at(year, 8, 15), "Asunción de la Virgen");
      add(at(year, 10, 12), "Fiesta Nacional de España");
      add(at(year, 11, 1), "Todos los Santos");
      add(at(year, 12, 6), "Día de la Constitución");
      add(at(year, 12, 8), "Inmaculada Concepción");
      add(at(year, 12, 25), "Navidad");
      break;
    case "GB": {
      add(substitute(at(year, 1, 1)), "New Year's Day");
      add(plus(E, -2), "Good Friday");
      add(plus(E, 1), "Easter Monday");
      add(nthWeekday(year, 5, 1, 1), "Early May bank holiday");
      add(nthWeekday(year, 5, 1, -1), "Spring bank holiday");
      add(nthWeekday(year, 8, 1, -1), "Summer bank holiday");
      const xmas = substitute(at(year, 12, 25));
      add(xmas, "Christmas Day");
      add(substitute(at(year, 12, 26), new Set([iso(xmas)])), "Boxing Day");
      break;
    }
    case "US":
      add(at(year, 1, 1), "New Year's Day");
      add(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
      add(nthWeekday(year, 2, 1, 3), "Presidents' Day");
      add(nthWeekday(year, 5, 1, -1), "Memorial Day");
      if (year >= 2021) add(at(year, 6, 19), "Juneteenth");
      add(at(year, 7, 4), "Independence Day");
      add(nthWeekday(year, 9, 1, 1), "Labor Day");
      add(nthWeekday(year, 10, 1, 2), "Columbus Day");
      add(at(year, 11, 11), "Veterans Day");
      add(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
      add(at(year, 12, 25), "Christmas Day");
      break;
  }
  return list.map(([d, name]) => ({ date: iso(d), name })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Holidays touching the range [from, to) (local dates). */
export function holidaysBetween(from: Date, to: Date, country: string, region = ""): Holiday[] {
  const out: Holiday[] = [];
  const a = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
  const b = `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`;
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) out.push(...holidays(y, country, region).filter((h) => h.date >= a && h.date < b));
  return out;
}
