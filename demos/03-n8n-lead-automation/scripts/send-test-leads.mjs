#!/usr/bin/env node
// Posts sample leads to the n8n webhook and prints the classification.
//   node scripts/send-test-leads.mjs                       -> mock workflow (no credentials)
//   node scripts/send-test-leads.mjs http://localhost:5678/webhook/lead   -> AI workflow
//   WEBHOOK_URL=... node scripts/send-test-leads.mjs
// Node 18+ (uses the built-in fetch).

const url = process.argv[2] ?? process.env.WEBHOOK_URL ?? 'http://localhost:5678/webhook/lead-demo';

const leads = [
  {
    name: 'Laura Martinez',
    email: 'laura@example.com',
    company: 'Floristeria Martinez',
    phone: '+34 600 111 222',
    message:
      'Hola, nuestra tienda online en WooCommerce no funciona desde esta mañana y estamos perdiendo ventas. Necesito ayuda urgente, tenemos unos 800 € de presupuesto.',
  },
  {
    name: 'James Carter',
    email: 'james.carter@example.com',
    company: 'Carter Logistics',
    message:
      'We want to automate our quote requests: emails come in, someone copies them into our CRM and replies by hand. Looking for an n8n workflow with AI. Planning this for next quarter, no rush.',
  },
  {
    name: 'Sofia Rossi',
    email: 'sofia@example.com',
    company: '',
    message:
      'I need a new landing page for my yoga studio with a booking form. Budget around $1,500. Would like to launch next month.',
  },
];

const invalid = { name: 'X', email: 'not-an-email', message: 'hi' };

async function post(body) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ms: Date.now() - started, json };
}

console.log(`POST ${url}\n`);
let failures = 0;

for (const lead of leads) {
  try {
    const { status, ms, json } = await post(lead);
    const c = json?.classification ?? {};
    console.log(`[${status}] ${lead.name} (${ms} ms)`);
    console.log(`  lead_id:   ${json?.lead_id}`);
    console.log(`  category:  ${c.category}`);
    console.log(`  urgency:   ${c.urgency}`);
    console.log(`  budget:    ${c.budget_estimate}`);
    console.log(`  summary:   ${c.summary}`);
    console.log(`  reply:     ${(c.suggested_reply ?? '').slice(0, 160)}${(c.suggested_reply ?? '').length > 160 ? '...' : ''}\n`);
    if (status !== 200 || !json?.ok) failures++;
  } catch (e) {
    failures++;
    console.log(`[ERR] ${lead.name}: ${e.cause?.code ?? e.message}`);
    console.log('  Is n8n running and the workflow active? See README "Run locally".\n');
  }
}

try {
  const { status, json } = await post(invalid);
  console.log(`[${status}] invalid payload -> ${JSON.stringify(json)}`);
  if (status !== 400) failures++;
} catch (e) {
  failures++;
  console.log(`[ERR] invalid payload: ${e.cause?.code ?? e.message}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
