import type { Template } from './api/templates';

export type TemplateSortMode = 'newest' | 'popular';

export interface TemplateFilter {
  /** Selected category, or 'all' for no category filter. */
  category: string;
  /** Free-text search; matched case-insensitively against name/description/prompt. */
  query: string;
  sortMode: TemplateSortMode;
}

/**
 * Category chips for the template gallery: `'all'` followed by the distinct
 * categories present in `templates`, sorted alphabetically. Pure.
 */
export function templateCategories(templates: readonly Template[]): string[] {
  const cats = new Set(templates.map((t) => t.category));
  return ['all', ...Array.from(cats).sort()];
}

/**
 * Filter templates by category and search query, then order them by `sortMode`.
 * `'newest'` preserves the incoming order (the API returns created_at DESC);
 * `'popular'` sorts by apply_count descending, relying on a stable sort so
 * recency stays the tiebreaker. Search matches name, description, or the skill
 * prompt, case-insensitively. Pure — does not mutate the input array.
 */
export function filterAndSortTemplates(
  templates: readonly Template[],
  { category, query, sortMode }: TemplateFilter,
): Template[] {
  const q = query.trim().toLowerCase();
  const matched = templates.filter((tmpl) => {
    if (category !== 'all' && tmpl.category !== category) return false;
    if (!q) return true;
    return (
      tmpl.name.toLowerCase().includes(q) ||
      tmpl.description.toLowerCase().includes(q) ||
      tmpl.skill_data.prompt.toLowerCase().includes(q)
    );
  });
  if (sortMode === 'popular') {
    return [...matched].sort((a, b) => b.apply_count - a.apply_count);
  }
  return matched;
}
