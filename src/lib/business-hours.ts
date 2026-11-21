// Business hours for AI calls, in Sydney time.
// Mon-Fri 9:00-19:00, Sat 10:00-16:00. No Sundays, no NSW public holidays.

const TZ = "Australia/Sydney";

// [open hour, close hour] by day of week (0 = Sunday). null = closed.
const HOURS: Record<number, [number, number] | null> = {
  0: null,
  1: [9, 19],
  2: [9, 19],
  3: [9, 19],
  4: [9, 19],
  5: [9, 19],
  6: [10, 16],
};

// NSW public holidays that fall on Mon-Sat (Sundays are always closed anyway).
// Source: nsw.gov.au/about-nsw/public-holidays. Check it again each year and add the next year's dates.
const NSW_HOLIDAYS = new Set([
  // 2026
  "2026-12-25", "2026-12-26", "2026-12-28",
  // 2027
  "2027-01-01", "2027-01-26", "2027-03-26", "2027-03-27", "2027-03-29",
  "2027-04-26", "2027-06-14", "2027-10-04", "2027-12-25", "2027-12-27", "2027-12-28",
]);

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function sydneyParts(date: Date): Parts {
  const p: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

function offsetMs(date: Date): number {
  const p = sydneyParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The moment (as a Date) when Sydney's clock reads y-m-d h:00. Handles daylight saving. */
function sydneyToDate(y: number, m: number, d: number, h: number, min = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, min, 0);
  let t = guess - offsetMs(new Date(guess));
  const second = guess - offsetMs(new Date(t));
  if (second !== t) t = second;
  return new Date(t);
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendar day `offset` days after the given Sydney calendar day. */
function addDays(y: number, m: number, d: number, offset: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + offset));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

function hoursFor(y: number, m: number, d: number, dow: number): [number, number] | null {
  if (NSW_HOLIDAYS.has(iso(y, m, d))) return null;
  return HOURS[dow];
}

/** True if we are allowed to phone at this moment. */
export function isOpen(now: Date = new Date()): boolean {
  if (process.env.IGNORE_BUSINESS_HOURS === "true") return true; // TEST ONLY
  const p = sydneyParts(now);
  const { dow } = addDays(p.year, p.month, p.day, 0);
  const h = hoursFor(p.year, p.month, p.day, dow);
  if (!h) return false;
  return now >= sydneyToDate(p.year, p.month, p.day, h[0]) && now < sydneyToDate(p.year, p.month, p.day, h[1]);
}

/** `now` if we are open, otherwise the next opening time. */
export function nextOpenSlot(now: Date = new Date()): Date {
  if (process.env.IGNORE_BUSINESS_HOURS === "true") return now; // TEST ONLY: calls any time
  const p = sydneyParts(now);
  for (let i = 0; i < 21; i++) {
    const { y, m, d, dow } = addDays(p.year, p.month, p.day, i);
    const h = hoursFor(y, m, d, dow);
    if (!h) continue;
    const openAt = sydneyToDate(y, m, d, h[0]);
    const closeAt = sydneyToDate(y, m, d, h[1]);
    if (now < openAt) return openAt;
    if (now < closeAt) return now;
  }
  throw new Error("No opening found in the next 21 days. Check the holiday list.");
}

/** 10:00 Sydney time on the next business day after today. */
export function nextBusinessDay10am(now: Date = new Date()): Date {
  const p = sydneyParts(now);
  for (let i = 1; i < 21; i++) {
    const { y, m, d, dow } = addDays(p.year, p.month, p.day, i);
    if (hoursFor(y, m, d, dow)) return sydneyToDate(y, m, d, 10);
  }
  throw new Error("No business day found in the next 21 days. Check the holiday list.");
}

/** Turns "2026-11-26T17:00" (Sydney clock time) into a Date. Returns null if the text is not that shape or not a real time. */
export function sydneyLocalToDate(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null; // e.g. 31 November
  return sydneyToDate(y, mo, d, h, mi);
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A short calendar for the model: today and the next 20 days in Sydney, with weekday names, plus the current time. */
export function sydneyCalendarText(now: Date = new Date()): string {
  const p = sydneyParts(now);
  const lines: string[] = [];
  for (let i = 0; i < 21; i++) {
    const { y, m, d, dow } = addDays(p.year, p.month, p.day, i);
    lines.push(`${DAY_NAMES[dow]} ${iso(y, m, d)}${i === 0 ? " (today)" : ""}`);
  }
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `Current Sydney time: ${DAY_NAMES[addDays(p.year, p.month, p.day, 0).dow]} ${iso(p.year, p.month, p.day)} ${hh}:${mm}\nCalendar:\n${lines.join("\n")}`;
}
