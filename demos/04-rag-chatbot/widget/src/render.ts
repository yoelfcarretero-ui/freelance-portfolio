export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[(\d{1,2})\]/g, '<sup class="cite" aria-label="source $1">$1</sup>');
}

/**
 * Tiny, safe markdown subset for bot answers: paragraphs, "> " quotes, "- " lists,
 * **bold** and [n] citations. Everything is HTML-escaped first, so model output
 * can never inject markup into the page.
 */
export function renderAnswer(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];

  const flush = () => {
    if (list.length) html.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`);
    if (quote.length) html.push(`<blockquote>${quote.map((l) => `<p>${inline(l)}</p>`).join("")}</blockquote>`);
    list = [];
    quote = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^>\s?/.test(trimmed)) {
      if (list.length) flush();
      quote.push(trimmed.replace(/^>\s?/, ""));
    } else if (/^[-*]\s+/.test(trimmed)) {
      if (quote.length) flush();
      list.push(trimmed.replace(/^[-*]\s+/, ""));
    } else {
      flush();
      if (trimmed) html.push(`<p>${inline(trimmed)}</p>`);
    }
  }
  flush();
  return html.join("");
}
