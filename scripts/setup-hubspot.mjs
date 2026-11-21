// One-off setup for HubSpot: creates the "AI caller" contact property group, its properties,
// and the "Home loan leads" deal pipeline. Safe to re-run: anything that already exists is skipped.
//
// Run from the project root:
//   node --env-file=.env.local scripts/setup-hubspot.mjs
// Needs HUBSPOT_TOKEN in .env.local (private app access token).

const token = process.env.HUBSPOT_TOKEN;
if (!token) {
  console.error("HUBSPOT_TOKEN is missing. Add it to .env.local first.");
  process.exit(1);
}

const BASE = "https://api.hubapi.com";

async function hs(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

function report(label, r) {
  if (r.ok) console.log(`  created  ${label}`);
  else if (r.status === 409) console.log(`  exists   ${label}`);
  else console.log(`  FAILED   ${label} -> ${r.status} ${r.json.message ?? JSON.stringify(r.json)}`);
}

const GROUP = "ai_caller";

const options = (values) =>
  values.map((v, i) => ({ label: v, value: v, displayOrder: i, hidden: false }));

const text = (name, label, description) => ({
  name, label, description, type: "string", fieldType: "text", groupName: GROUP,
});
const longText = (name, label, description) => ({
  name, label, description, type: "string", fieldType: "textarea", groupName: GROUP,
});
const num = (name, label, description) => ({
  name, label, description, type: "number", fieldType: "number", groupName: GROUP,
});
const select = (name, label, description, values) => ({
  name, label, description, type: "enumeration", fieldType: "select", groupName: GROUP,
  options: options(values),
});

const properties = [
  select("ai_triage_decision", "AI triage decision", "What the AI decided to do with this inquiry", [
    "call_now", "call_later", "email_only", "human",
  ]),
  text("ai_triage_reason", "AI triage reason", "Short reason for the triage decision"),
  longText("ai_call_brief", "AI call brief", "Brief the AI caller and broker use for this lead"),
  num("ai_attempt_count", "AI attempt count", "Number of AI call attempts so far"),
  select("ai_call_outcome", "AI call outcome", "Result of the AI call", [
    "booked", "qualified_not_booked", "not_qualified", "callback_requested",
    "no_answer", "opted_out", "escalated",
  ]),
  text("loan_purpose", "Loan purpose", "Captured on the AI call"),
  num("loan_amount_aud", "Loan amount (AUD)", "Captured on the AI call"),
  text("property_status", "Property status", "Captured on the AI call"),
  text("purchase_timeline", "Purchase timeline", "Captured on the AI call"),
  text("employment_type", "Employment type", "Captured on the AI call"),
  longText("ai_call_summary", "AI call summary", "Three line summary of the call"),
  text("ai_run_id", "AI run ID", "trigger.dev run ID, for debugging"),
];

const stages = [
  { label: "New inquiry", probability: "0.1", closed: false },
  { label: "AI contacting", probability: "0.2", closed: false },
  { label: "Qualified", probability: "0.4", closed: false },
  { label: "Meeting booked", probability: "0.6", closed: false },
  { label: "Not qualified", probability: "0.0", closed: true },
  { label: "Unreachable", probability: "0.0", closed: true },
];

async function main() {
  console.log("Property group");
  report(
    "AI caller",
    await hs("POST", "/crm/v3/properties/contacts/groups", {
      name: GROUP, label: "AI caller", displayOrder: -1,
    })
  );

  console.log("Contact properties");
  for (const p of properties) {
    report(p.name, await hs("POST", "/crm/v3/properties/contacts", p));
  }

  console.log("Deal pipeline");
  const existing = await hs("GET", "/crm/v3/pipelines/deals");
  if (!existing.ok) {
    console.log(`  FAILED   could not list pipelines -> ${existing.status} ${existing.json.message ?? ""}`);
    return;
  }
  const found = existing.json.results?.find((p) => p.label === "Home loan leads");
  if (found) {
    console.log(`  exists   Home loan leads (id ${found.id})`);
  } else {
    const r = await hs("POST", "/crm/v3/pipelines/deals", {
      label: "Home loan leads",
      displayOrder: 1,
      stages: stages.map((s, i) => ({
        label: s.label,
        displayOrder: i,
        metadata: { probability: s.probability, isClosed: String(s.closed) },
      })),
    });
    if (r.ok) {
      console.log(`  created  Home loan leads (id ${r.json.id})`);
      for (const s of r.json.stages) console.log(`           stage ${s.label} = ${s.id}`);
    } else {
      console.log(`  FAILED   Home loan leads -> ${r.status} ${r.json.message ?? JSON.stringify(r.json)}`);
      console.log("  If this says you have reached the pipeline limit, your HubSpot plan only allows the default deal pipeline.");
      console.log("  Tell Claude and we will rename the default pipeline's stages instead.");
    }
  }
}

main();
