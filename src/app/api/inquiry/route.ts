import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";
import { createDeal, upsertContact } from "@/lib/hubspot";
import type { inquiryReceived } from "@/trigger/inquiry-received";

const INQUIRY_TYPES = [
  "Buy my first home",
  "Buy my next home",
  "Refinance",
  "Investment property",
  "Other",
] as const;

/** Accepts 0412 345 678, 04xxxxxxxx, +61412345678, 61412345678, 02 9xxx xxxx. Returns E.164 or null. */
function toE164AU(input: string): string | null {
  const digits = input.replace(/[\s()-]/g, "");
  let e164: string;
  if (digits.startsWith("+61")) e164 = digits;
  else if (digits.startsWith("61")) e164 = `+${digits}`;
  else if (digits.startsWith("0")) e164 = `+61${digits.slice(1)}`;
  else return null;
  return /^\+61[2-478]\d{8}$/.test(e164) ? e164 : null;
}

const Body = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().email(),
  phone: z.string().trim().min(8),
  inquiryType: z.enum(INQUIRY_TYPES),
  message: z.string().trim().max(2000).optional(),
  consent: z.literal(true),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Please check the form and try again.", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const b = parsed.data;

  const phone = toE164AU(b.phone);
  if (!phone) {
    return Response.json(
      { error: "Please enter an Australian phone number, like 0412 345 678." },
      { status: 400 }
    );
  }

  try {
    const contactId = await upsertContact({
      email: b.email,
      firstName: b.firstName,
      lastName: b.lastName,
      phone,
      message: b.message,
    });

    const dealId = await createDeal({
      contactId,
      name: `${b.firstName} ${b.lastName} - ${b.inquiryType}`,
      description: `Inquiry type: ${b.inquiryType}\nConsented to AI call: yes\n\n${b.message ?? ""}`.trim(),
    });

    const handle = await tasks.trigger<typeof inquiryReceived>("inquiry-received", {
      contactId,
      dealId,
      firstName: b.firstName,
      phone,
      inquiryType: b.inquiryType,
      message: b.message ?? "",
    });

    return Response.json({ ok: true, runId: handle.id });
  } catch (err) {
    console.error("inquiry failed", err);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
