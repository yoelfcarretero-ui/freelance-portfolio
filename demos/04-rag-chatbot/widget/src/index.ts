import type { UiLang } from "./i18n.js";
import { ChatWidget, type WidgetConfig } from "./widget.js";

/**
 * Embed with one tag:
 *
 *   <script src="https://your-app.vercel.app/chat-widget.js"
 *           data-api-url="https://your-app.vercel.app/api"
 *           data-title="Clínica Dental Sonrisa"
 *           data-color="#0f766e"
 *           data-lang="auto"
 *           data-position="right" defer></script>
 */
function readConfig(script: HTMLScriptElement | null): WidgetConfig {
  const d = script?.dataset ?? {};
  const scriptOrigin = script?.src ? new URL(script.src, location.href).origin : location.origin;

  const requested = (d.lang ?? "auto").toLowerCase();
  const browser = (navigator.language || "es").toLowerCase().startsWith("es") ? "es" : "en";
  const lang: UiLang = requested === "es" || requested === "en" ? requested : browser;

  const color = d.color && /^#[0-9a-f]{3,8}$|^rgb|^hsl/i.test(d.color) ? d.color : "#0f766e";

  return {
    apiUrl: (d.apiUrl || `${scriptOrigin}/api`).replace(/\/$/, ""),
    title: d.title || (lang === "es" ? "Asistente de la clínica" : "Clinic assistant"),
    color,
    lang,
    position: d.position === "left" ? "left" : "right",
    open: d.open === "true" || location.hash === "#chat",
  };
}

declare global {
  interface Window {
    ClinicChatWidget?: ChatWidget;
  }
}

(function boot() {
  if (window.ClinicChatWidget) return; // already embedded
  const script = document.currentScript as HTMLScriptElement | null;
  const start = () => {
    const widget = new ChatWidget(readConfig(script));
    widget.mount();
    window.ClinicChatWidget = widget;
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
