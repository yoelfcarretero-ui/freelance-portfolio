import { STRINGS, type Strings, type UiLang } from "./i18n.js";
import { escapeHtml, renderAnswer } from "./render.js";
import { readSse } from "./sse.js";
import { STYLES } from "./styles.js";

export interface WidgetConfig {
  apiUrl: string;
  title: string;
  color: string;
  lang: UiLang;
  position: "right" | "left";
  open: boolean;
}

interface Source {
  n: number;
  title: string;
  section: string;
  snippet: string;
}

interface Meta {
  mode: "demo" | "live";
  lang: UiLang;
  sources: Source[];
  notice?: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const ICONS = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  tooth:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 5.5C10.3 4 8.6 3.5 7 3.8 4.4 4.3 3.4 7 4 9.8c.5 2.3 1.5 3.6 1.9 6 .4 2.5.8 5.2 2.3 5.2 1.6 0 1.6-3.4 2.2-5 .3-.8.8-1.2 1.6-1.2s1.3.4 1.6 1.2c.6 1.6.6 5 2.2 5 1.5 0 1.9-2.7 2.3-5.2.4-2.4 1.4-3.7 1.9-6 .6-2.8-.4-5.5-3-6-1.6-.3-3.3.2-5 1.7z"/></svg>',
};

const MAX_MESSAGE = 500;

export class ChatWidget {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly t: Strings;
  private history: Turn[] = [];
  private busy = false;

  private lastQuestion = "";

  private panel!: HTMLElement;
  private launcher!: HTMLButtonElement;
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private badge!: HTMLElement;

  constructor(private readonly config: WidgetConfig) {
    this.t = STRINGS[config.lang];
    this.host = document.createElement("div");
    this.host.setAttribute("data-clinic-chat", "");
    this.host.setAttribute("data-position", config.position);
    this.host.style.setProperty("--brand", config.color);
    this.root = this.host.attachShadow({ mode: "open" });
  }

  mount(): void {
    const style = document.createElement("style");
    style.textContent = STYLES;
    this.root.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <section class="panel" role="dialog" aria-label="${escapeHtml(this.config.title)}" hidden>
        <header class="header">
          <div class="avatar">${ICONS.tooth}</div>
          <div class="titles">
            <div class="title"><span>${escapeHtml(this.config.title)}</span><span class="badge" hidden title="${escapeHtml(this.t.demoTitle)}">${this.t.demoBadge}</span></div>
            <div class="subtitle">${escapeHtml(this.t.subtitle)}</div>
          </div>
          <button class="icon-btn close" type="button" aria-label="${escapeHtml(this.t.close)}">${ICONS.close}</button>
        </header>
        <div class="log" role="log" aria-live="polite" aria-relevant="additions"></div>
        <form class="composer">
          <div class="input-row">
            <textarea rows="1" maxlength="${MAX_MESSAGE}" placeholder="${escapeHtml(this.t.placeholder)}" aria-label="${escapeHtml(this.t.placeholder)}"></textarea>
            <button class="send" type="submit" aria-label="${escapeHtml(this.t.send)}" disabled>${ICONS.send}</button>
          </div>
          <div class="meta-row">
            <button class="link human" type="button">${escapeHtml(this.t.human)}</button>
            <span class="disclaimer">${escapeHtml(this.t.disclaimer)}</span>
          </div>
        </form>
      </section>
      <button class="launcher" type="button" aria-label="${escapeHtml(this.t.open)}" aria-expanded="false">${ICONS.chat}</button>
    `;
    this.root.append(...Array.from(wrapper.childNodes));

    this.panel = this.$(".panel");
    this.launcher = this.$(".launcher");
    this.log = this.$(".log");
    this.input = this.$("textarea");
    this.sendBtn = this.$(".send");
    this.badge = this.$(".badge");

    this.launcher.addEventListener("click", () => this.toggle());
    this.$(".close").addEventListener("click", () => this.toggle(false));
    this.$(".human").addEventListener("click", () => this.showLeadForm());
    this.$<HTMLFormElement>(".composer").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.ask(this.input.value);
    });
    this.input.addEventListener("input", () => this.syncComposer());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.ask(this.input.value);
      }
    });
    this.root.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") this.toggle(false);
    });

    this.addBotWelcome();
    document.body.appendChild(this.host);
    if (this.config.open) this.toggle(true);
    void this.fetchMode();
  }

  private $<T extends Element = HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`chat widget: missing ${selector}`);
    return el;
  }

  private toggle(force?: boolean) {
    const open = force ?? this.panel.hidden;
    this.panel.hidden = !open;
    this.launcher.setAttribute("aria-expanded", String(open));
    this.launcher.innerHTML = open ? ICONS.close : ICONS.chat;
    this.launcher.setAttribute("aria-label", open ? this.t.close : this.t.open);
    if (open) setTimeout(() => this.input.focus(), 50);
    else this.launcher.focus();
  }

  private syncComposer() {
    this.input.style.height = "auto";
    this.input.style.height = `${Math.min(this.input.scrollHeight, 120)}px`;
    this.sendBtn.disabled = this.busy || this.input.value.trim().length === 0;
  }

  private async fetchMode() {
    try {
      const res = await fetch(`${this.config.apiUrl}/health`);
      if (res.ok) this.setMode((await res.json()).mode);
    } catch {
      /* the badge is cosmetic; ignore */
    }
  }

  private setMode(mode: "demo" | "live" | undefined) {

    this.badge.hidden = mode !== "demo";
  }

  private scrollToEnd() {
    this.log.scrollTop = this.log.scrollHeight;
  }

  private addBotWelcome() {
    const msg = this.addMessage("bot", "");
    msg.innerHTML = `<p>${escapeHtml(this.t.welcome)}</p>`;
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const q of this.t.suggestions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = q;
      chip.addEventListener("click", () => {
        chips.remove();
        void this.ask(q);
      });
      chips.appendChild(chip);
    }
    this.log.appendChild(chips);
  }

  private addMessage(kind: "user" | "bot", text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `msg ${kind}`;
    if (kind === "user") el.textContent = text;
    this.log.appendChild(el);
    this.scrollToEnd();
    return el;
  }

  async ask(raw: string): Promise<void> {
    const message = raw.trim().slice(0, MAX_MESSAGE);
    if (!message || this.busy) return;
    this.busy = true;
    this.lastQuestion = message;
    this.input.value = "";
    this.syncComposer();
    this.root.querySelector(".chips")?.remove();

    this.addMessage("user", message);
    const bot = this.addMessage("bot", "");
    bot.innerHTML = `<span class="typing" aria-label="${escapeHtml(this.t.thinking)}"><span></span><span></span><span></span></span>`;
    const body = document.createElement("div");
    let text = "";
    let meta: Meta | undefined;
    let handoff = false;

    try {
      const res = await fetch(`${this.config.apiUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: this.history.slice(-6), lang: this.config.lang, stream: true }),
      });
      if (res.status === 429) throw new Error("rate_limited");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && res.body) {
        for await (const evt of readSse(res.body)) {
          const data = JSON.parse(evt.data);
          if (evt.event === "meta") {
            meta = data as Meta;
            this.setMode(meta.mode);
          } else if (evt.event === "delta") {
            if (!text) bot.replaceChildren(body);
            text += data.text as string;
            body.innerHTML = renderAnswer(text);
            this.scrollToEnd();
          } else if (evt.event === "done") {
            handoff = Boolean(data.handoff);
          } else if (evt.event === "error") {
            throw new Error(data.error);
          }
        }
      } else {
        // JSON fallback (e.g. a proxy that buffers streams)
        const data = await res.json();
        meta = data;
        this.setMode(data.mode);
        text = data.answer ?? "";
        handoff = Boolean(data.handoff);
        bot.replaceChildren(body);
        body.innerHTML = renderAnswer(text);
      }

      if (!text) throw new Error("empty answer");
      this.history.push({ role: "user", content: message }, { role: "assistant", content: text });
      this.decorate(bot, meta, handoff);
    } catch (err) {
      const rateLimited = err instanceof Error && err.message === "rate_limited";
      bot.innerHTML = `<p>${escapeHtml(rateLimited ? this.t.rateLimited : this.t.error)}</p>`;
      if (!rateLimited) this.decorate(bot, undefined, true);
    } finally {
      this.busy = false;
      this.syncComposer();
      this.scrollToEnd();
    }
  }

  /** Adds sources, the demo-mode notice and the "leave my details" button under an answer. */
  private decorate(bot: HTMLElement, meta: Meta | undefined, handoff: boolean) {
    // Labels follow the language of the answer (the user may write in English on a Spanish site).
    const t = meta?.lang && STRINGS[meta.lang] ? STRINGS[meta.lang] : this.t;
    if (meta?.sources?.length) {
      const details = document.createElement("details");
      details.className = "sources";
      details.innerHTML = `<summary>${escapeHtml(t.sources(meta.sources.length))}</summary><ol>${meta.sources
        .map(
          (s) =>
            `<li><div class="src-title"><span class="cite">${s.n}</span> ${escapeHtml(s.title)} &rsaquo; ${escapeHtml(s.section)}</div><div class="src-snippet">${escapeHtml(s.snippet)}</div></li>`,
        )
        .join("")}</ol>`;
      bot.appendChild(details);
    }
    if (meta?.notice) {
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.textContent = meta.notice;
      bot.appendChild(notice);
    }
    if (handoff) {
      const cta = document.createElement("button");
      cta.type = "button";
      cta.className = "cta";
      cta.textContent = t.leaveDetails;
      cta.addEventListener("click", () => {
        cta.remove();
        this.showLeadForm();
      });
      bot.appendChild(cta);
    }
  }

  private showLeadForm() {
    if (this.root.querySelector(".lead-form")) {
      this.root.querySelector<HTMLInputElement>(".lead-form input[name=name]")?.focus();
      return;
    }
    if (this.panel.hidden) this.toggle(true);
    const f = this.t.form;
    const card = document.createElement("form");
    card.className = "card lead-form";
    card.noValidate = true;
    card.innerHTML = `
      <h3>${escapeHtml(f.title)}</h3>
      <p class="intro">${escapeHtml(f.intro)}</p>
      <p class="form-error" hidden></p>
      <label class="field">${escapeHtml(f.name)}<input name="name" autocomplete="name" required maxlength="100"></label>
      <label class="field">${escapeHtml(f.email)}<input name="email" type="email" autocomplete="email" required maxlength="254"></label>
      <label class="field">${escapeHtml(f.phone)}<input name="phone" type="tel" autocomplete="tel" maxlength="20"></label>
      <label class="field">${escapeHtml(f.question)}<textarea name="question" required maxlength="1000"></textarea></label>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="consent"><input type="checkbox" name="consent" required><span>${escapeHtml(f.consent)}</span></label>
      <div class="row">
        <button class="btn btn-ghost" type="button" data-cancel>${escapeHtml(f.cancel)}</button>
        <button class="btn btn-primary" type="submit">${escapeHtml(f.submit)}</button>
      </div>`;
    const question = card.querySelector<HTMLTextAreaElement>("textarea[name=question]")!;
    question.value = this.lastQuestion;
    card.querySelector("[data-cancel]")!.addEventListener("click", () => card.remove());
    card.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.submitLead(card);
    });
    this.log.appendChild(card);
    this.scrollToEnd();
    card.querySelector<HTMLInputElement>("input[name=name]")!.focus();
  }

  private async submitLead(form: HTMLFormElement) {
    const f = this.t.form;
    const data = new FormData(form);
    const errorEl = form.querySelector<HTMLElement>(".form-error")!;
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const payload = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      phone: String(data.get("phone") ?? ""),
      question: String(data.get("question") ?? ""),
      consent: data.get("consent") === "on",
      website: String(data.get("website") ?? ""),
      lang: this.config.lang,
      pageUrl: location.href,
      transcript: this.history
        .slice(-6)
        .map((t) => `${t.role === "user" ? "Patient" : "Assistant"}: ${t.content}`)
        .join("\n"),
    };

    submit.disabled = true;
    submit.textContent = f.sending;
    errorEl.hidden = true;
    try {
      const res = await fetch(`${this.config.apiUrl}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || f.failed);
      form.innerHTML = `<p class="success">${escapeHtml(body.mode === "demo" ? f.successDemo : f.success)}</p>`;
    } catch (err) {
      errorEl.textContent = err instanceof Error && err.message ? err.message : f.failed;
      errorEl.hidden = false;
      submit.disabled = false;
      submit.textContent = f.submit;
    }
    this.scrollToEnd();
  }
}
