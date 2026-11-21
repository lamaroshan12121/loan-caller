// Reads an Aircall AI Voice Agent webhook body and pulls out the two things we need:
//   1. which phone numbers are in it (to find the call-cadence run that is waiting), and
//   2. the extraction variables (call_outcome, chosen_slot, ...).
//
// ASSUMPTION: the real payload shape is not verified yet (no approved number, so no real call).
// So this does not rely on one fixed layout. It searches the whole body for the variable names
// and for anything that looks like an Australian phone number. Once a real payload has been
// captured with the logging spike, tighten this to the real field paths.

export const VARIABLE_NAMES = [
  "call_outcome",
  "loan_purpose",
  "loan_amount_aud",
  "property_status",
  "purchase_timeline",
  "employment_type",
  "chosen_slot",
] as const;

type Json = unknown;

/** Walk the whole body, calling visit for every key/value pair (and every array item of {name, value} pairs). */
function walk(node: Json, visit: (key: string, value: Json) => void, depth = 0): void {
  if (depth > 8 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) {
      // Variables are sometimes sent as [{ name: "call_outcome", value: "booked" }].
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, Json>;
        const name = o.name ?? o.key ?? o.variable;
        if (typeof name === "string" && "value" in o) visit(name, o.value);
      }
      walk(item, visit, depth + 1);
    }
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, Json>)) {
    visit(k, v);
    walk(v, visit, depth + 1);
  }
}

/** The extraction variables found anywhere in the body. Empty strings and nulls are ignored. */
export function extractVariables(body: Json): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  walk(body, (key, value) => {
    if ((VARIABLE_NAMES as readonly string[]).includes(key) && key in out === false) {
      if (value !== null && value !== undefined && value !== "") out[key] = value;
    }
  });
  return out;
}

/** Digits of an Australian number in the form we tag runs with (61412345678), or null. */
export function normaliseAuPhone(value: string): string | null {
  const digits = value.replace(/[^\d]/g, "");
  let intl: string;
  if (digits.startsWith("61")) intl = digits;
  else if (digits.startsWith("0")) intl = `61${digits.slice(1)}`;
  else return null;
  return /^61[2-478]\d{8}$/.test(intl) ? intl : null;
}

/** Every Australian phone number that appears as a string value anywhere in the body, without duplicates. */
export function findPhones(body: Json): string[] {
  const found = new Set<string>();
  walk(body, (_key, value) => {
    if (typeof value === "string" && value.length <= 20) {
      const n = normaliseAuPhone(value);
      if (n) found.add(n);
    }
  });
  return [...found];
}

export type ParsedWebhook = {
  phones: string[];
  output: Record<string, unknown>;
  hasOutcome: boolean;
};

export function parseAircallWebhook(body: Json): ParsedWebhook {
  const output = extractVariables(body);
  return { phones: findPhones(body), output, hasOutcome: typeof output.call_outcome === "string" };
}
