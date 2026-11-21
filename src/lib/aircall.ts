// Starts an outbound AI call through the Aircall AI Voice Agent API.
// Needs AIRCALL_AGENT_ID and AIRCALL_API_TOKEN (set in .env.local, and in the trigger.dev dashboard for deploys).
// Aircall returns 202: the call is queued, not placed yet. The result arrives later by webhook.

export type StartCallInput = {
  phone: string; // E.164
  firstName: string;
  inquiryPhrase: string;
  idempotencyKey: string;
};

export async function startAircallCall(input: StartCallInput): Promise<void> {
  const agentId = process.env.AIRCALL_AGENT_ID;
  const apiToken = process.env.AIRCALL_API_TOKEN;
  if (!agentId || !apiToken) {
    throw new Error("Set AIRCALL_AGENT_ID and AIRCALL_API_TOKEN to place real calls.");
  }

  const res = await fetch(`https://api.aircall.io/v1/outbound-calls/agents/${agentId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contact_phone: input.phone,
      idempotency_key: input.idempotencyKey,
      // Every {{variable}} in the agent's first message needs a key here.
      context: {
        first_name: input.firstName,
        inquiry_phrase: input.inquiryPhrase,
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Aircall returned ${res.status}: ${text}`);
}
