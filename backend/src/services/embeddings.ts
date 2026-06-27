import crypto from 'node:crypto';
import { getOpenAIClient } from './openai';
import { db } from '../db';
import { logger } from '../logger';
import { cosineSimilarity } from './cosineSimilarity';

// Re-exported so existing importers (routes/pdfs/search.ts, similar-pages.ts) keep working.
export { cosineSimilarity };

/**
 * Safely parse a stored embedding (a JSON-stringified `number[]`) back into a
 * vector. Returns `null` when the value is missing, not valid JSON, not an
 * array, or contains any non-finite entry — so a single corrupt row can't 500
 * a route that ranks across many embeddings (the caller skips/ignores it).
 */
export function parseEmbedding(raw: string | null | undefined): number[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return parsed as number[];
  } catch {
    return null;
  }
}

function contentHash(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}

interface EmbeddingRow {
  id: string;
  content_hash: string;
  embedding: string;
}

export interface EmbeddingEntry {
  id: string;
  pdf_id: string;
  page_uid: string;
  text: string;
}

const BATCH_SIZE = 100;
const MAX_TEXT_CHARS = 8000;

export async function getOrCreateEmbeddings(
  entries: EmbeddingEntry[],
  accountId: string,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const toGenerate: Array<EmbeddingEntry & { hash: string }> = [];

  for (const entry of entries) {
    const hash = contentHash(entry.text);
    const row = db
      .prepare('SELECT id, content_hash, embedding FROM page_embeddings WHERE id = ?')
      .get(entry.id) as EmbeddingRow | undefined;
    if (row && row.content_hash === hash) {
      result.set(entry.id, JSON.parse(row.embedding) as number[]);
    } else {
      toGenerate.push({ ...entry, hash });
    }
  }

  if (toGenerate.length === 0) return result;

  logger.info({ count: toGenerate.length }, 'Generating page embeddings');

  const client = getOpenAIClient(accountId);

  for (let i = 0; i < toGenerate.length; i += BATCH_SIZE) {
    const batch = toGenerate.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch.map((e) => e.text.slice(0, MAX_TEXT_CHARS)),
    });

    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO page_embeddings (id, pdf_id, page_uid, content_hash, embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j]!;
      const embedding = response.data[j]?.embedding ?? [];
      insert.run(entry.id, entry.pdf_id, entry.page_uid, entry.hash, JSON.stringify(embedding), now);
      result.set(entry.id, embedding);
    }
  }

  return result;
}

export async function embedQuery(query: string, accountId: string): Promise<number[]> {
  const client = getOpenAIClient(accountId);
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: query.slice(0, MAX_TEXT_CHARS),
  });
  return response.data[0]?.embedding ?? [];
}
