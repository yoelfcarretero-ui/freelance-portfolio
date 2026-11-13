export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Parses a Server-Sent Events stream from a fetch() response body.
 * EventSource only supports GET, and we need POST, so we read the stream by hand.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseBlock(raw);
        if (parsed) yield parsed;
      }
    }
    const last = parseBlock(buffer);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

export function parseBlock(raw: string): SseEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : undefined;
}
