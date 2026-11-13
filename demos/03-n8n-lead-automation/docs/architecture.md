# Architecture

Four workflows, all exported from n8n 2.47.7 and stored in `workflows/`.

| File | Workflow name | Trigger | External services |
|---|---|---|---|
| `lead-capture-ai.json` | Lead Capture with AI Triage | Webhook `POST /webhook/lead` | OpenAI, Telegram, Google Sheets, Gmail |
| `error-notifier.json` | Error Notifier | Error Trigger (any workflow that selects it) | Telegram, Gmail |
| `daily-inbox-digest.json` | Daily Inbox Digest (AI) | Schedule, Mon-Fri 08:00 Europe/Madrid | Gmail, Anthropic, Telegram |
| `lead-capture-mock.json` | Lead Capture (Mock, no credentials) | Webhook `POST /webhook/lead-demo`, `GET /webhook/lead-demo/leads` | none |

## 1. Lead Capture with AI Triage

```mermaid
flowchart LR
    form([Website form / any HTTP client]) -->|POST JSON| hook[Lead Webhook<br/>POST /webhook/lead]
    hook --> cfg[Config<br/>Set node]
    cfg --> norm[Normalize & Validate<br/>Code node]
    norm --> valid{Is Valid?}
    valid -- no --> r400[Respond 400<br/>list of errors]
    valid -- yes --> ai[AI Classify Lead<br/>Basic LLM Chain]
    llm[(OpenAI Chat Model)] -. ai_languageModel .-> ai
    parser[(Structured Output Parser<br/>JSON schema)] -. ai_outputParser .-> ai
    ai --> merge[Merge Lead + AI<br/>Code node]
    merge --> urgent{Urgency High?}
    urgent -- yes --> tg[Telegram Alert]
    merge --> sheet[Append to Google Sheets]
    sheet --> mail[Send Follow-up Email<br/>Gmail, AI-drafted reply]
    mail --> r200[Respond 200<br/>classification JSON]

    classDef ext fill:#fff4e5,stroke:#b54708;
    class tg,sheet,mail,llm ext;
```

Design decisions:

- **Respond to Webhook at the end** so the form can show the AI result. Validation errors return a 400 immediately, before any paid API call.
- **Structured Output Parser** with a JSON schema (enums for `category` and `urgency`) makes the LLM output machine-readable. The chain retries up to 3 times.
- **Config node** holds every client-specific value (Telegram chat id, Sheet id, business name), so nothing is hard-coded in the other nodes.
- **Telegram and Gmail use "continue on error"**: a failed notification must not lose the lead. Google Sheets retries 3 times and, if it still fails, stops the run and the Error Notifier fires.
- **Settings > Error workflow** points to `Error Notifier`.

## 2. Error Notifier

```mermaid
flowchart LR
    et[Error Trigger] --> fmt[Format Error<br/>Code node]
    fmt --> cfg[Config]
    cfg --> tg[Telegram Alert]
    cfg --> mail[Email Alert<br/>Gmail]
```

Any workflow whose settings select "Error Notifier" as its error workflow sends the workflow name, failing node, error message and a direct link to the execution.

## 3. Daily Inbox Digest (AI)

```mermaid
flowchart LR
    cron[Schedule<br/>0 8 * * 1-5] --> cfg[Config]
    cfg --> get[Get Emails last 24h<br/>Gmail: INBOX, no promotions/social]
    get --> compact[Compact Emails<br/>Code: N items to 1]
    compact --> any{Any Emails?}
    any -- no --> noop[Nothing To Send]
    any -- yes --> ai[AI Prioritize & Summarize<br/>Basic LLM Chain]
    claude[(Anthropic Chat Model)] -. ai_languageModel .-> ai
    schema[(Digest Schema<br/>headline / high / medium / low)] -. ai_outputParser .-> ai
    ai --> render[Render Digest<br/>Code: HTML + text]
    render --> mail[Email Digest<br/>Gmail HTML]
    render --> tg[Telegram Digest]
```

Design decisions:

- Only sender, subject and Gmail's snippet go to the model, which keeps cost low and avoids sending full email bodies to a third party.
- All emails are compacted into **one** item, so there is one LLM call per day instead of one per email.
- `alwaysOutputData` on the Gmail node plus the `Any Emails?` check means an empty inbox ends cleanly instead of erroring.

## 4. Lead Capture (Mock)

```mermaid
flowchart LR
    hook[Lead Webhook<br/>POST /webhook/lead-demo] --> norm[Normalize & Validate]
    norm --> valid{Is Valid?}
    valid -- no --> r400[Respond 400]
    valid -- yes --> cls[Classify Lead<br/>rules, same JSON schema]
    cls --> urgent{Urgency High?}
    urgent -- yes --> notify[Notify Team<br/>mock message]
    cls --> store[Store Lead<br/>workflow static data]
    store --> draft[Draft Follow-up Email<br/>preview only]
    draft --> r200[Respond 200]

    list[List Leads Webhook<br/>GET /webhook/lead-demo/leads] --> read[Read Stored Leads] --> rl[Respond Leads]
```

Same contract as the AI workflow (same request body, same response shape), so the form and the test script work against either one. Swapping the mock for the real workflow is a URL change.
