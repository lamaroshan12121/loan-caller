// Turns the result of an AI call (the Aircall "extraction variables") into clean values,
// a short summary, and the HubSpot actions for each outcome.

export const OUTCOMES = [
  "booked",
  "qualified_not_booked",
  "not_qualified",
  "callback_requested",
  "opted_out",
  "escalated",
  "no_answer",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Unknown or missing outcomes go to a person, never silently dropped. */
export function normaliseOutcome(raw: unknown): Outcome {
  const v = String(raw ?? "").trim().toLowerCase();
  return (OUTCOMES as readonly string[]).includes(v) ? (v as Outcome) : "escalated";
}

const EMPTY = new Set(["", "unknown", "n/a", "na", "not provided", "not sure", "null", "undefined"]);

export function clean(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  return EMPTY.has(s.toLowerCase()) ? undefined : s;
}

/** "650000", "$650,000", "650k", "1.2m" -> number. Anything else -> undefined. */
export function parseAmount(raw: unknown): number | undefined {
  const s = clean(raw);
  if (!s) return undefined;
  const m = s.toLowerCase().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return undefined;
  const n = Number(m[1]) * (m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1);
  return Math.round(n);
}

export type CallFields = {
  loan_purpose?: string;
  loan_amount_aud?: number;
  property_status?: string;
  purchase_timeline?: string;
  employment_type?: string;
  chosen_slot?: string;
};

export function extractFields(output: Record<string, unknown> | undefined): CallFields {
  const o = output ?? {};
  const fields: CallFields = {
    loan_purpose: clean(o.loan_purpose),
    loan_amount_aud: parseAmount(o.loan_amount_aud),
    property_status: clean(o.property_status),
    purchase_timeline: clean(o.purchase_timeline),
    employment_type: clean(o.employment_type),
    chosen_slot: clean(o.chosen_slot),
  };
  // Drop undefined keys so we never overwrite HubSpot values with blanks.
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as CallFields;
}

/** Three plain lines for the ai_call_summary property. No AI needed. */
export function buildSummary(outcome: Outcome, f: CallFields, attempts: number): string {
  const line1 =
    outcome === "no_answer"
      ? `Outcome: no answer after ${attempts} call attempts`
      : `Outcome: ${outcome.replace(/_/g, " ")}${f.chosen_slot ? ` (${f.chosen_slot})` : ""}`;
  const wants = [
    f.loan_purpose,
    f.loan_amount_aud ? `$${f.loan_amount_aud.toLocaleString("en-AU")}` : undefined,
    f.property_status,
  ].filter(Boolean);
  const line2 = `Wants: ${wants.length ? wants.join(", ") : "not captured"}`;
  const rest = [
    f.purchase_timeline ? `timeline ${f.purchase_timeline}` : undefined,
    f.employment_type ? `employment ${f.employment_type}` : undefined,
  ].filter(Boolean);
  const line3 = `Other: ${rest.length ? rest.join(", ") : "not captured"}`;
  return [line1, line2, line3].join("\n");
}

// Which HubSpot deal stage each outcome moves to (env var name), or null = leave the stage alone.
export const STAGE_FOR_OUTCOME: Record<Outcome, string | null> = {
  booked: "HUBSPOT_STAGE_MEETING_BOOKED",
  qualified_not_booked: "HUBSPOT_STAGE_QUALIFIED",
  not_qualified: "HUBSPOT_STAGE_NOT_QUALIFIED",
  callback_requested: null,
  opted_out: "HUBSPOT_STAGE_UNREACHABLE",
  escalated: null,
  no_answer: "HUBSPOT_STAGE_UNREACHABLE",
};

export type TaskPlan = {
  subject: (name: string, f: CallFields) => string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  due: "now" | "next_business_day";
};

// The follow-up task for the broker, or null = no task needed.
export const TASK_FOR_OUTCOME: Record<Outcome, TaskPlan | null> = {
  booked: {
    subject: (n, f) => `Confirm booked meeting with ${n}${f.chosen_slot ? ` (${f.chosen_slot})` : ""}`,
    priority: "MEDIUM",
    due: "next_business_day",
  },
  qualified_not_booked: { subject: (n) => `Call ${n} to book a meeting`, priority: "HIGH", due: "now" },
  not_qualified: null,
  callback_requested: { subject: (n) => `Call ${n} back (asked for a callback)`, priority: "HIGH", due: "now" },
  opted_out: { subject: (n) => `Do not phone ${n}: opted out on the AI call. Email only`, priority: "LOW", due: "next_business_day" },
  escalated: { subject: (n) => `Urgent: ${n} asked for a person or the call needs a human`, priority: "HIGH", due: "now" },
  no_answer: { subject: (n) => `Follow up ${n}: no answer after 3 AI call attempts`, priority: "MEDIUM", due: "next_business_day" },
};
