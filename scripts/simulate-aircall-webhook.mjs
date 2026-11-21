// Sends a fake "call ended" webhook to your local app, so you can test the webhook route without Aircall.
//
// Usage (PowerShell, from the project folder):
//   node scripts/simulate-aircall-webhook.mjs --phone 0412345680 --outcome booked --slot "Monday 23 November at 10 am"
//   node scripts/simulate-aircall-webhook.mjs --phone 0412345680 --outcome no_answer
//   node scripts/simulate-aircall-webhook.mjs --phone 0412345680 --outcome booked --slot "Monday 23 November at 10 am" --shape list
//
// Options:
//   --phone    the borrower's number, as typed on the form (required)
//   --outcome  booked | qualified_not_booked | not_qualified | callback_requested | opted_out | escalated | no_answer
//   --slot     the chosen_slot text (for booked)
//   --shape    nested (default) or list: two different layouts, to prove the parser does not depend on one
//   --url      default http://localhost:3000/api/aircall-webhook
//   --secret   default: AIRCALL_WEBHOOK_SECRET from .env.local

import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, [])
);

function envFromFile(name) {
  try {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

if (!args.phone) {
  console.error("Missing --phone. Example: --phone 0412345680");
  process.exit(1);
}
const secret = args.secret ?? envFromFile("AIRCALL_WEBHOOK_SECRET");
if (!secret) {
  console.error("No secret. Add AIRCALL_WEBHOOK_SECRET to .env.local or pass --secret.");
  process.exit(1);
}

const digits = args.phone.replace(/[^\d]/g, "");
const e164 = digits.startsWith("0") ? `+61${digits.slice(1)}` : digits.startsWith("61") ? `+${digits}` : args.phone;

const outcome = args.outcome ?? "booked";
const vars = {
  call_outcome: outcome,
  ...(outcome === "no_answer"
    ? {}
    : {
        loan_purpose: "purchase",
        loan_amount_aud: "650k",
        property_status: "found property",
        purchase_timeline: "within 3 months",
        employment_type: "PAYG",
        ...(args.slot ? { chosen_slot: args.slot } : {}),
      }),
};

const body =
  args.shape === "list"
    ? {
        event: "call.ended",
        data: {
          id: "sim-1",
          direction: "outbound",
          from: "+61485091644",
          to: e164,
          analysis: { variables: Object.entries(vars).map(([name, value]) => ({ name, value })) },
        },
      }
    : {
        event: "call.ended",
        data: {
          id: "sim-1",
          direction: "outbound",
          number: { digits: "+61485091644" },
          contact: { phone_number: e164 },
          extracted_data: vars,
        },
      };

const url = `${args.url ?? "http://localhost:3000/api/aircall-webhook"}?secret=${encodeURIComponent(secret)}`;
const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
console.log(res.status, await res.text());
