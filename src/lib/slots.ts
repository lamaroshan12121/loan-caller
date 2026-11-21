// Meeting slots offered on the call, and matching what the borrower picked back to a real time.
// All times are Sydney time. Slots are 30 minutes, offered on business days only.

import { nextBusinessDay10am } from "./business-hours";

export type Slot = {
  startIso: string; // UTC ISO string of the start time
  label: string; // what the agent says, e.g. "Tuesday 24 November at 10 am"
};

export const SLOT_MINUTES = 30;

const TZ = "Australia/Sydney";

const labelFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "Tuesday 24 November at 10 am" or "Tuesday 24 November at 2:30 pm". */
export function slotLabel(date: Date): string {
  const p: Record<string, string> = {};
  for (const part of labelFormatter.formatToParts(date)) p[part.type] = part.value;
  const time = p.minute === "00" ? p.hour : `${p.hour}:${p.minute}`;
  const ampm = (p.dayPeriod ?? "").toLowerCase().replace(/\./g, "");
  return `${p.weekday} ${p.day} ${p.month} at ${time} ${ampm}`;
}

function toSlot(date: Date): Slot {
  return { startIso: date.toISOString(), label: slotLabel(date) };
}

const weekdayFormatter = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short" });

/** Next business day at 10 am that is Monday to Friday. Brokers do not meet on Saturdays. */
function nextWeekday10am(from: Date): Date {
  let d = nextBusinessDay10am(from);
  while (weekdayFormatter.format(d).toLowerCase().startsWith("sat")) {
    d = nextBusinessDay10am(d);
  }
  return d;
}

/**
 * Two slots for the agent to offer: 10 am on the next weekday, and 2 pm on the weekday after that.
 * Public holidays are skipped. (Real broker calendar availability is a later step. This keeps the demo honest and predictable.)
 */
export function proposeSlots(now: Date = new Date()): [Slot, Slot] {
  const first = nextWeekday10am(now);
  const secondDay10am = nextWeekday10am(first);
  const second = new Date(secondDay10am.getTime() + 4 * 60 * 60 * 1000); // 2 pm same day
  return [toSlot(first), toSlot(second)];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Work out which offered slot the borrower chose from the free text the agent captured.
 * Accepts the exact label, "slot_1"/"slot 2"/"1"/"first"/"second", or a mention of the weekday,
 * date or time. Returns undefined when it is not clear, so a person confirms the time instead of us guessing.
 */
export function matchSlot(chosen: string | undefined, slots: Slot[] | undefined): Slot | undefined {
  if (!chosen || !slots || slots.length === 0) return undefined;
  const c = norm(chosen);

  // Exact label.
  const exact = slots.find((s) => norm(s.label) === c);
  if (exact) return exact;

  // By position.
  if (/^(slot[_ ]?)?1$/.test(c) || /\b(first|1st|option 1|slot 1)\b/.test(c)) return slots[0];
  if (/^(slot[_ ]?)?2$/.test(c) || /\b(second|2nd|option 2|slot 2)\b/.test(c)) return slots[1];

  // By weekday, date and time mentions.
  const scores = slots.map((s) => {
    const label = norm(s.label);
    const [weekday, day, month, , time, ampm] = label.split(" ");
    let score = 0;
    if (c.includes(weekday.slice(0, 3))) score += 1; // "tue" matches "Tuesday" and "Tue"
    if (c.includes(`${day} ${month}`) || c.includes(`${month} ${day}`)) score += 1;
    const hour = time.split(":")[0];
    const timeRe = new RegExp(`\\b${hour}(:${time.split(":")[1] ?? "00"})?\\s?${ampm}\\b`);
    if (timeRe.test(c)) score += 1;
    return score;
  });
  const best = Math.max(...scores);
  if (best === 0) return undefined;
  const winners = scores.filter((s) => s === best).length;
  return winners === 1 ? slots[scores.indexOf(best)] : undefined;
}
