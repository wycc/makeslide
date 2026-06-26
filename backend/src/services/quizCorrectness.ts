/**
 * Whether a student's selected option set exactly matches a question's answer
 * key, ignoring order and duplicates. Single source of truth for "is this answer
 * correct" so quiz scoring (routes/pdfs/quizzes.ts) and the post-class report
 * (routes/pdfs/report.ts) can't drift apart. Mirrors the frontend
 * lib/quizScoring.ts isCorrectAnswer().
 */
export function isCorrectAnswer(answerIndices: number[], selected: number[]): boolean {
  const a = Array.from(new Set(answerIndices)).sort((x, y) => x - y);
  const b = Array.from(new Set(selected)).sort((x, y) => x - y);
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
