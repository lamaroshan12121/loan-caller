import { task, wait, logger } from "@trigger.dev/sdk";

type CallSpikePayload = {
  first_name: string;
  phone: string; // E.164, e.g. +61400000000
  inquiry_phrase: string; // e.g. "buying your first home"
  dryRun?: boolean; // true = don't call Aircall, just wait for the token to be completed
};

type CallResult = Record<string, unknown>;

export const callSpike = task({
  id: "call-spike",
  maxDuration: 300, // compute-time cap in seconds; waiting does not count
  run: async (payload: CallSpikePayload) => {
    const phoneDigits = payload.phone.replace(/\D/g, "");

    // 1. Create a waitpoint token. Anything that POSTs JSON to token.url completes it.
    const token = await wait.createToken({
      timeout: "10m",
      tags: [`phone_${phoneDigits}`],
    });

    logger.info("Waitpoint token created", { id: token.id, url: token.url });

    // 2. Start the call (skipped in dry-run mode).
    if (payload.dryRun) {
      logger.info("Dry run: not calling Aircall. Complete the token yourself using the URL above.");
    } else {
      const agentId = process.env.AIRCALL_AGENT_ID;
      const apiToken = process.env.AIRCALL_API_TOKEN;
      if (!agentId || !apiToken) {
        throw new Error("Set AIRCALL_AGENT_ID and AIRCALL_API_TOKEN in the trigger.dev dashboard (Development).");
      }

      const res = await fetch(`https://api.aircall.io/v1/outbound-calls/agents/${agentId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contact_phone: payload.phone,
          idempotency_key: `call-spike-${phoneDigits}-${Date.now()}`,
          context: {
            first_name: payload.first_name,
            inquiry_phrase: payload.inquiry_phrase,
          },
        }),
      });

      const text = await res.text();
      logger.info("Aircall response", { status: res.status, body: text });

      if (!res.ok) {
        throw new Error(`Aircall returned ${res.status}: ${text}`);
      }
    }

    // 3. Pause (for free) until the token is completed or the 10 minute timeout hits.
    const result = await wait.forToken<CallResult>(token);

    if (!result.ok) {
      logger.warn("No result before timeout");
      return { status: "timeout" as const };
    }

    logger.info("Token completed", { output: result.output });
    return { status: "completed" as const, output: result.output };
  },
});
