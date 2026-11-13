import { describe, expect, it } from "vitest";
import { renderAnswer } from "../widget/src/render.js";
import { parseBlock } from "../widget/src/sse.js";

describe("widget renderer", () => {
  it("escapes HTML so answers cannot inject markup", () => {
    const html = renderAnswer('<img src=x onerror="alert(1)"> hola');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders quotes, lists and citations", () => {
    const html = renderAnswer("Intro\n\n> Abrimos los sábados [1]\n\n- Uno\n- Dos [2]");
    expect(html).toContain("<blockquote><p>Abrimos los sábados <sup");
    expect(html).toContain("<ul><li>Uno</li><li>Dos <sup");
  });
});

describe("SSE parser", () => {
  it("parses event and data lines", () => {
    expect(parseBlock('event: delta\ndata: {"text":"hi"}')).toEqual({ event: "delta", data: '{"text":"hi"}' });
    expect(parseBlock("")).toBeUndefined();
  });
});
