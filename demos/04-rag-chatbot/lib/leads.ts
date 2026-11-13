import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { HttpError } from "./http.js";
import { getSupabaseAdmin } from "./supabase.js";
import type { Lang } from "./types.js";

export interface Lead {
  name: string;
  email: string;
  phone?: string;
  question: string;
  lang: Lang;
  consent: true;
  pageUrl?: string;
  /** Last messages of the chat, so the clinic has context when calling back. */
  transcript?: string;
}

export interface LeadValidation {
  lead?: Lead;
  /** True when the honeypot field was filled (a bot): we pretend success and drop it. */
  isBot: boolean;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const PHONE_RE = /^[+()\d\s-]{6,20}$/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateLead(body: Record<string, unknown>): LeadValidation {
  if (str(body.website)) return { isBot: true };

  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const phone = str(body.phone);
  const question = str(body.question);
  const lang = body.lang === "en" ? "en" : "es";

  if (name.length < 2 || name.length > 100) throw new HttpError(400, "Name must be 2-100 characters", "invalid_name");
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "Please enter a valid email", "invalid_email");
  if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, "Please enter a valid phone number", "invalid_phone");
  if (question.length < 2 || question.length > 1000) {
    throw new HttpError(400, "Question must be 2-1000 characters", "invalid_question");
  }
  if (body.consent !== true) {
    throw new HttpError(400, "Consent to be contacted is required", "consent_required");
  }

  let pageUrl = str(body.pageUrl).slice(0, 300) || undefined;
  if (pageUrl && !/^https?:\/\//i.test(pageUrl)) pageUrl = undefined;
  const transcript = str(body.transcript).slice(0, 4000) || undefined;

  return {
    isBot: false,
    lead: { name, email, phone: phone || undefined, question, lang, consent: true, pageUrl, transcript },
  };
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}***@${domain}`;
}

export interface SaveLeadResult {
  id: string;
  stored: "demo-log" | "supabase";
  notified: boolean;
}

/**
 * Demo mode: the lead is only logged (with the email masked) and discarded.
 * Live mode: inserted into the `leads` table with the service role, then an
 * optional webhook (Slack, Make, Zapier, n8n...) is notified. A webhook failure
 * never loses the lead because the insert already happened.
 */
export async function saveLead(lead: Lead, config: AppConfig): Promise<SaveLeadResult> {
  if (config.mode === "demo" || !config.supabaseUrl || !config.supabaseServiceRoleKey) {
    const id = `demo-${randomUUID()}`;
    console.info("[lead:demo] received lead (not stored)", {
      id,
      name: lead.name,
      email: maskEmail(lead.email),
      lang: lead.lang,
      questionPreview: lead.question.slice(0, 80),
    });
    return { id, stored: "demo-log", notified: false };
  }

  const supabase = getSupabaseAdmin(config.supabaseUrl, config.supabaseServiceRoleKey);
  const { data, error } = await supabase
    .from("leads")
    .insert({
      name: lead.name,
      email: lead.email,
      phone: lead.phone ?? null,
      question: lead.question,
      lang: lead.lang,
      consent: lead.consent,
      page_url: lead.pageUrl ?? null,
      transcript: lead.transcript ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not store lead: ${error.message}`);

  let notified = false;
  if (config.leadWebhookUrl) {
    try {
      const res = await fetch(config.leadWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `New lead from the website chat: ${lead.name} <${lead.email}> - ${lead.question}`,
          lead: { ...lead, id: data.id },
        }),
        signal: AbortSignal.timeout(5000),
      });
      notified = res.ok;
    } catch (err) {
      console.warn("[lead] webhook notification failed", err);
    }
  }
  return { id: String(data.id), stored: "supabase", notified };
}
