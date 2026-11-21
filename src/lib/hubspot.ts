// Small typed HubSpot client. Used by the Next.js routes and the trigger.dev tasks.
// Reads HUBSPOT_TOKEN, HUBSPOT_PIPELINE_ID and HUBSPOT_STAGE_* from the environment.

const BASE = "https://api.hubapi.com";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function hs<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env("HUBSPOT_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HubSpot ${method} ${path} failed: ${res.status} ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** HubSpot-defined association from the new object to an existing one. */
function assoc(id: string, typeId: number) {
  return {
    to: { id },
    types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }],
  };
}

export type ContactInput = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string; // E.164
  message?: string;
};

/** Create the contact, or update it if one with this email already exists. Returns the contact id. */
export async function upsertContact(c: ContactInput): Promise<string> {
  const res = await hs<{ results: { id: string }[] }>(
    "POST",
    "/crm/v3/objects/contacts/batch/upsert",
    {
      inputs: [
        {
          idProperty: "email",
          id: c.email,
          properties: {
            email: c.email,
            firstname: c.firstName,
            lastname: c.lastName,
            phone: c.phone,
            ...(c.message ? { message: c.message } : {}),
          },
        },
      ],
    }
  );
  return res.results[0].id;
}

export type DealInput = {
  contactId: string;
  name: string;
  description?: string;
};

/** Create a deal in the "New inquiry" stage and associate it with the contact. Returns the deal id. */
export async function createDeal(d: DealInput): Promise<string> {
  const res = await hs<{ id: string }>("POST", "/crm/v3/objects/deals", {
    properties: {
      dealname: d.name,
      pipeline: env("HUBSPOT_PIPELINE_ID"),
      dealstage: env("HUBSPOT_STAGE_NEW_INQUIRY"),
      ...(d.description ? { description: d.description } : {}),
    },
    // 3 = deal to contact
    associations: [assoc(d.contactId, 3)],
  });
  return res.id;
}

export async function updateContact(contactId: string, properties: Record<string, string | number>) {
  await hs("PATCH", `/crm/v3/objects/contacts/${contactId}`, { properties });
}

/**
 * True if this contact, or any contact with this phone number, was marked opted_out on an earlier AI call.
 * (post-call writes ai_call_outcome = "opted_out" when someone says "stop calling me".)
 */
export async function isOptedOut(phone: string, contactId: string): Promise<boolean> {
  const res = await hs<{ total: number }>("POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [
      { filters: [
        { propertyName: "phone", operator: "EQ", value: phone },
        { propertyName: "ai_call_outcome", operator: "EQ", value: "opted_out" },
      ] },
      { filters: [
        { propertyName: "hs_object_id", operator: "EQ", value: contactId },
        { propertyName: "ai_call_outcome", operator: "EQ", value: "opted_out" },
      ] },
    ],
    limit: 1,
  });
  return res.total > 0;
}

export async function moveDealToStage(dealId: string, stageEnvName: string) {
  await hs("PATCH", `/crm/v3/objects/deals/${dealId}`, {
    properties: { dealstage: env(stageEnvName) },
  });
}

/** A note on the contact and the deal. */
export async function createNote(n: { body: string; contactId: string; dealId: string }): Promise<string> {
  const res = await hs<{ id: string }>("POST", "/crm/v3/objects/notes", {
    properties: {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: n.body,
    },
    // 202 = note to contact, 214 = note to deal
    associations: [assoc(n.contactId, 202), assoc(n.dealId, 214)],
  });
  return res.id;
}

/** A to-do for the broker, linked to the contact and the deal. */
export async function createTask(t: {
  subject: string;
  body: string;
  dueAt: Date;
  priority: "HIGH" | "MEDIUM" | "LOW";
  contactId: string;
  dealId: string;
}): Promise<string> {
  const res = await hs<{ id: string }>("POST", "/crm/v3/objects/tasks", {
    properties: {
      hs_timestamp: t.dueAt.toISOString(),
      hs_task_subject: t.subject,
      hs_task_body: t.body,
      hs_task_status: "NOT_STARTED",
      hs_task_priority: t.priority,
      hs_task_type: "TODO",
    },
    // 204 = task to contact, 216 = task to deal
    associations: [assoc(t.contactId, 204), assoc(t.dealId, 216)],
  });
  return res.id;
}

/** A scheduled 30-minute meeting on the contact and the deal. */
export async function createMeeting(m: {
  title: string;
  body: string;
  startsAt: Date;
  minutes: number;
  contactId: string;
  dealId: string;
}): Promise<string> {
  const end = new Date(m.startsAt.getTime() + m.minutes * 60 * 1000);
  const res = await hs<{ id: string }>("POST", "/crm/v3/objects/meetings", {
    properties: {
      hs_timestamp: m.startsAt.toISOString(),
      hs_meeting_title: m.title,
      hs_meeting_body: m.body,
      hs_meeting_start_time: m.startsAt.toISOString(),
      hs_meeting_end_time: end.toISOString(),
      hs_meeting_outcome: "SCHEDULED",
    },
    // 200 = meeting to contact, 212 = meeting to deal
    associations: [assoc(m.contactId, 200), assoc(m.dealId, 212)],
  });
  return res.id;
}
