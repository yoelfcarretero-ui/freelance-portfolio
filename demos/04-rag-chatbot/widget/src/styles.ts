/** Styles live inside the Shadow DOM, so the host site's CSS cannot break the widget (and vice versa). */
export const STYLES = /* css */ `
:host {
  --brand: #0f766e;
  --brand-ink: #ffffff;
  --bg: #ffffff;
  --surface: #f4f6f8;
  --ink: #17202a;
  --muted: #5d6b79;
  --line: #e2e7ec;
  --radius: 18px;
  --shadow: 0 18px 50px rgba(16, 24, 40, 0.18), 0 4px 12px rgba(16, 24, 40, 0.08);
  all: initial;
  position: fixed;
  z-index: 2147483000;
  bottom: 20px;
  right: 20px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.45;
  color: var(--ink);
}
:host([data-position="left"]) { right: auto; left: 20px; }
* { box-sizing: border-box; }
button, input, textarea { font: inherit; color: inherit; }

.launcher {
  width: 60px; height: 60px; border-radius: 50%;
  border: 0; cursor: pointer;
  background: var(--brand); color: var(--brand-ink);
  box-shadow: var(--shadow);
  display: grid; place-items: center;
  transition: transform .18s ease, box-shadow .18s ease;
}
.launcher:hover { transform: translateY(-2px) scale(1.03); }
.launcher:focus-visible, button:focus-visible, textarea:focus-visible, input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--brand) 45%, white); outline-offset: 2px;
}
.launcher svg { width: 28px; height: 28px; }
.launcher .dot {
  position: absolute; top: 2px; right: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: #f97316; border: 2px solid #fff;
}

.panel {
  position: absolute; bottom: 76px; right: 0;
  width: min(390px, calc(100vw - 24px));
  height: min(640px, calc(100vh - 110px));
  background: var(--bg);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex; flex-direction: column; overflow: hidden;
  transform-origin: bottom right;
  animation: pop .18s ease-out;
}
:host([data-position="left"]) .panel { right: auto; left: 0; transform-origin: bottom left; }
.panel[hidden] { display: none; }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }

.header {
  background: var(--brand); color: var(--brand-ink);
  padding: 14px 14px 14px 16px; display: flex; align-items: center; gap: 12px;
}
.avatar {
  width: 38px; height: 38px; border-radius: 50%; flex: none;
  background: rgba(255,255,255,.18); display: grid; place-items: center;
}
.avatar svg { width: 22px; height: 22px; }
.titles { flex: 1; min-width: 0; }
.title { font-weight: 650; font-size: 15.5px; display: flex; align-items: center; gap: 8px; }
.subtitle { font-size: 12.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge {
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  background: #fde68a; color: #713f12; padding: 2px 7px; border-radius: 999px;
}
.icon-btn {
  border: 0; background: transparent; color: inherit; cursor: pointer;
  width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center;
}
.icon-btn:hover { background: rgba(255,255,255,.15); }
.icon-btn svg { width: 20px; height: 20px; }

.log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: var(--surface); scroll-behavior: smooth; }

.msg { max-width: 88%; padding: 10px 13px; border-radius: 16px; word-wrap: break-word; }
.msg p { margin: 0 0 6px; }
.msg p:last-child { margin-bottom: 0; }
.msg ul { margin: 4px 0 6px; padding-left: 18px; }
.msg blockquote {
  margin: 6px 0; padding: 6px 10px; border-left: 3px solid var(--brand);
  background: color-mix(in srgb, var(--brand) 6%, white); border-radius: 0 10px 10px 0;
}
.msg blockquote p { margin: 2px 0; }
.user { align-self: flex-end; background: var(--brand); color: var(--brand-ink); border-bottom-right-radius: 5px; }
.bot { align-self: flex-start; background: var(--bg); border: 1px solid var(--line); border-bottom-left-radius: 5px; }
.cite {
  display: inline-block; min-width: 17px; height: 17px; padding: 0 4px; margin-left: 2px;
  border-radius: 9px; background: color-mix(in srgb, var(--brand) 14%, white); color: var(--brand);
  font-size: 10.5px; font-weight: 700; line-height: 17px; text-align: center; vertical-align: 2px;
}
.typing { display: inline-flex; gap: 4px; align-items: center; color: var(--muted); font-size: 13px; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

.notice { margin-top: 8px; font-size: 11.5px; color: var(--muted); font-style: italic; }
.sources { margin-top: 8px; border-top: 1px dashed var(--line); padding-top: 6px; }
.sources summary { cursor: pointer; font-size: 12.5px; color: var(--brand); font-weight: 600; list-style: none; }
.sources summary::-webkit-details-marker { display: none; }
.sources summary::before { content: "\\25B8"; display: inline-block; margin-right: 5px; transition: transform .15s; }
.sources[open] summary::before { transform: rotate(90deg); }
.sources ol { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.sources li { font-size: 12.5px; background: var(--surface); border-radius: 10px; padding: 7px 9px; }
.sources .src-title { font-weight: 600; }
.sources .src-snippet { color: var(--muted); margin-top: 2px; }

.cta {
  margin-top: 10px; border: 1px solid var(--brand); color: var(--brand); background: transparent;
  padding: 7px 12px; border-radius: 999px; cursor: pointer; font-size: 13px; font-weight: 600;
}
.cta:hover { background: color-mix(in srgb, var(--brand) 8%, white); }

.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--line); background: var(--bg); padding: 7px 11px; border-radius: 999px;
  cursor: pointer; font-size: 13px; text-align: left;
}
.chip:hover { border-color: var(--brand); color: var(--brand); }

.card { align-self: stretch; background: var(--bg); border: 1px solid var(--line); border-radius: 16px; padding: 14px; }
.card h3 { margin: 0 0 4px; font-size: 15px; }
.card .intro { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
.field { display: grid; gap: 4px; margin-bottom: 9px; font-size: 12.5px; color: var(--muted); }
.field input, .field textarea {
  border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; font-size: 14px; color: var(--ink); background: #fff; width: 100%;
}
.field textarea { resize: vertical; min-height: 64px; }
.consent { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--muted); margin: 4px 0 12px; }
.consent input { margin-top: 2px; accent-color: var(--brand); }
.hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
.row { display: flex; gap: 8px; justify-content: flex-end; }
.btn { border: 0; border-radius: 10px; padding: 9px 14px; cursor: pointer; font-weight: 600; font-size: 14px; }
.btn-primary { background: var(--brand); color: var(--brand-ink); }
.btn-primary:disabled { opacity: .6; cursor: progress; }
.btn-ghost { background: transparent; color: var(--muted); }
.form-error { color: #b42318; font-size: 12.5px; margin: 0 0 8px; }
.success { color: #067647; font-weight: 600; }

.composer { border-top: 1px solid var(--line); padding: 10px 12px 8px; background: var(--bg); }
.input-row { display: flex; align-items: flex-end; gap: 8px; }
.input-row textarea {
  flex: 1; resize: none; border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px;
  max-height: 120px; min-height: 44px; font-size: 14.5px; line-height: 1.35; background: var(--surface);
}
.send {
  width: 44px; height: 44px; border-radius: 50%; border: 0; cursor: pointer; flex: none;
  background: var(--brand); color: var(--brand-ink); display: grid; place-items: center;
}
.send:disabled { opacity: .45; cursor: not-allowed; }
.send svg { width: 20px; height: 20px; }
.meta-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
.link { border: 0; background: none; color: var(--brand); cursor: pointer; font-size: 12.5px; font-weight: 600; padding: 2px 0; }
.disclaimer { font-size: 10.5px; color: var(--muted); text-align: right; }

@media (max-width: 480px) {
  :host { bottom: 14px; right: 14px; }
  .panel { position: fixed; inset: 0; width: 100vw; height: 100dvh; border-radius: 0; bottom: 0; }
  :host([data-position="left"]) .panel { left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .panel, .launcher, .typing span { animation: none; transition: none; }
}
`;
