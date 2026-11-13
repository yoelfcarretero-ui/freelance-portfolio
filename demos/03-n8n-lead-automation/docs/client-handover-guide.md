# Client Handover Guide - [Client name]

> Template. Replace everything in [brackets] before sending it to the client.

| | |
|---|---|
| Project | Lead capture with AI triage + daily inbox digest |
| n8n instance | [https://n8n.client-domain.com or n8n Cloud workspace URL] |
| Delivered on | [date] |
| Built by | Yoel Carretero - yoelf.carretero@gmail.com |
| Support window | [e.g. 14 days of bug fixes included] |

## 1. What was delivered

| Workflow | What it does | Runs when |
|---|---|---|
| Lead Capture with AI Triage | Validates each form submission, classifies it with AI (category, urgency, budget, summary), alerts you on Telegram if it is urgent, saves it to Google Sheets and emails the lead a personalised first reply. | Every time the website form is submitted |
| Daily Inbox Digest (AI) | Reads the last 24 hours of your inbox and sends you a digest grouped by priority. | Monday to Friday at 08:00 ([timezone]) |
| Error Notifier | Tells you on Telegram and by email when any of the above fails, with a link to the failed run. | Only on errors |

Webhook URL for the website form: `[https://.../webhook/lead]`

## 2. Logging in

1. Open [instance URL] and sign in with [the owner account created during handover].
2. Change the password on first login and enable two-factor authentication (Settings > Personal).
3. Do not share the owner account. Invite colleagues from Settings > Users.

## 3. Credentials (connect once)

Credentials are stored encrypted inside n8n. The workflows only reference them by name, so you can reconnect an account without editing any workflow.

| Credential name (must match) | Used by | How to create it |
|---|---|---|
| `OpenAI account` | Lead triage | platform.openai.com > API keys > Create key. Paste it in n8n: Credentials > Add > OpenAI. Set a monthly usage limit in the OpenAI dashboard. |
| `Anthropic account` | Inbox digest | console.anthropic.com > API keys. n8n: Credentials > Add > Anthropic. Set a spend limit. |
| `Telegram account` | Alerts | Talk to @BotFather in Telegram, `/newbot`, copy the token. n8n: Credentials > Add > Telegram API. Then send any message to your bot and get your chat id (for example with @userinfobot), and put it in the Config nodes. |
| `Google Sheets account` | Lead log | n8n: Credentials > Add > Google Sheets OAuth2 and click "Sign in with Google" (n8n Cloud). Self-hosted: follow the Google OAuth guide in the n8n docs. |
| `Gmail account` | Follow-up email, digest, error alerts | Same as above with Gmail OAuth2. |

After creating a credential, open each workflow, click every node with a warning triangle and select the credential from the dropdown, then **Publish**.

## 4. Settings you can change yourself

Every client-specific value lives in the **Config** node at the start of each workflow. Double-click it, edit the value, then click **Publish**.

| Workflow | Field | Meaning |
|---|---|---|
| Lead Capture | `config.business_name` | Used in the AI prompt and email subject |
| Lead Capture | `config.telegram_chat_id` | Where urgent-lead alerts go |
| Lead Capture | `config.google_sheet_id` | The part of the Sheet URL between `/d/` and `/edit` |
| Lead Capture | `config.sheet_tab` | Tab name, default `Leads`. First row must contain the column headers: Lead ID, Received At, Name, Email, Company, Phone, Source, Category, Urgency, Budget Estimate, Summary, Message |
| Lead Capture | `config.reply_from_name` | Signature of the automatic reply |
| Inbox Digest | `digest_to`, `telegram_chat_id`, `max_emails` | Recipient, chat, and how many emails to read |
| Error Notifier | `telegram_chat_id`, `alert_email` | Who gets error alerts |

To change the digest time: open the **Weekdays 08:00** node and edit the cron expression (`0 8 * * 1-5` = 08:00 Monday-Friday).

## 5. Changing the AI behaviour (the prompt)

1. Open **Lead Capture with AI Triage** and double-click **AI Classify Lead**.
2. The **System message** (under Options / Messages) explains the rules: categories, what counts as "high" urgency, tone and length of the reply. Edit the text in plain language. Examples:
   - "Always reply in Spanish."
   - "Treat anything mentioning 'Shopify' as ecommerce."
   - "Offer a free 30-minute audit instead of a 20-minute call."
3. If you add a new category, also add it to the `enum` list in the **Structured Output Parser** node, otherwise the parser rejects it.
4. Test before publishing: click **Execute workflow**, submit the form once, and check the output of each node.
5. Click **Publish**.

To use a different model, open **OpenAI Chat Model** (or **Anthropic Chat Model**) and pick another model from the list. Cheaper models are fine for classification; check the result on 5-10 real leads after changing.

## 6. Where to see what happened (executions)

- **Overview > Executions** (or the Executions tab inside a workflow) lists every run with status, time and duration.
- Click a run to see the exact data that entered and left each node. This is the first place to look when someone says "I filled the form and nothing happened".
- Failed runs can be retried from the same screen after fixing the cause.
- Execution history is kept for [7] days ([EXECUTIONS_DATA_MAX_AGE] setting).

## 7. How errors are reported

- Each production workflow has **Settings > Error workflow = Error Notifier**.
- On failure you get a Telegram message and an email with: workflow name, the node that failed, the error message and a link to the execution.
- Telegram alerts and the follow-up email are set to "continue on error": if Telegram is down, the lead is still saved and answered.
- Common causes and fixes:

| Message contains | Likely cause | Fix |
|---|---|---|
| `401` / `invalid api key` | Expired or revoked API key / OAuth token | Reconnect the credential (section 3) |
| `429` / `rate limit` / `insufficient_quota` | Provider limit or no credit left | Add credit or raise the limit at the provider |
| `Could not parse` / `output parser` | The model returned malformed JSON 3 times | Usually transient; retry the execution. If repeated, simplify the prompt or use a stronger model |
| `Requested entity was not found` (Sheets) | Wrong Sheet id or tab name | Fix `config.google_sheet_id` / `config.sheet_tab` |

## 8. Costs

| Item | Approximate cost |
|---|---|
| n8n | [n8n Cloud plan / VPS price] per month |
| OpenAI (lead triage) | Fractions of a cent per lead with a small model |
| Anthropic (digest) | [estimate] per month for one digest per weekday |
| Telegram, Gmail, Google Sheets | Free within normal limits |

## 9. Backups and updates

- Export workflows regularly: select all on the Overview page > Download, or `n8n export:workflow --all --separate --output=/backups` on self-hosted instances.
- Self-hosted: keep the `N8N_ENCRYPTION_KEY` in a password manager. Without it, saved credentials cannot be decrypted after a restore.
- Update n8n by changing the pinned image tag, reading the release notes first, and testing on a copy.

## 10. Support

[Support terms, response time, how to request changes, hourly rate for new work.]
