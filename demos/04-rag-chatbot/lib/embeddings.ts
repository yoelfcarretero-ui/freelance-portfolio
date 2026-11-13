import OpenAI from "openai";

export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * OpenAI text-embedding-3-small: 1536 dimensions, very cheap
 * (see README for the cost estimate). Must match the vector(1536) column in SQL.
 */
export class OpenAIEmbedder implements Embedder {
  readonly dimensions = 1536;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model = "text-embedding-3-small",
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 3, timeout: 20_000 });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.client.embeddings.create({ model: this.model, input: texts });
    // The API returns items with an `index`; sort to be safe.
    return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
