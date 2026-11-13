import { createLeadHandler } from "../lib/handlers.js";

/**
 * POST /api/lead
 * Body: { name, email, phone?, question, consent: true, lang?, pageUrl?, transcript?, website? (honeypot) }
 * Demo mode logs the lead (email masked); live mode stores it in Supabase and notifies a webhook.
 */
export default createLeadHandler();
