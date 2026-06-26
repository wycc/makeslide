/**
 * Cosine similarity between two equal-length embedding vectors, used to rank
 * semantic search / similar-page results. Returns 0 when either vector is all
 * zeros (no direction to compare). Pure (no DB/OpenAI deps) so it can be unit
 * tested in isolation; re-exported from services/embeddings.ts for callers.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
