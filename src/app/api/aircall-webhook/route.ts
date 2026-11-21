// Spike version: just capture whatever Aircall sends so we can see the real payload shape.
// Aircall expects a fast response (5 second timeout), so we log and return 200 straight away.

export async function POST(req: Request) {
  const raw = await req.text();

  console.log("=== AIRCALL WEBHOOK ===");
  console.log("headers:", Object.fromEntries(req.headers));
  console.log("body:", raw);

  return Response.json({ received: true });
}
