/** A category bucket: its name and the items belonging to it. */
export interface CategoryGroup<T> {
  category: string;
  items: T[];
}

/**
 * Group items by their `category` (blank/missing → `defaultCategory`), sort the
 * items within each group via `sortItemsInGroup`, and order the groups by
 * category name (locale-aware, numeric). Pure — does not mutate the input array.
 *
 * Extracted from HomePage's category-grouping useMemo so the find-or-create
 * bucketing and the within/between-group ordering are unit-testable.
 */
export function groupItemsByCategory<T extends { category?: string | null }>(
  items: readonly T[],
  defaultCategory: string,
  sortItemsInGroup: (list: T[]) => T[],
): CategoryGroup<T>[] {
  const groups = items.reduce<CategoryGroup<T>[]>((acc, item) => {
    const category = item.category?.trim() || defaultCategory;
    const group = acc.find((g) => g.category === category);
    if (group) {
      group.items.push(item);
    } else {
      acc.push({ category, items: [item] });
    }
    return acc;
  }, []);
  return groups
    .map((group) => ({ ...group, items: sortItemsInGroup(group.items) }))
    .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hant', { numeric: true, sensitivity: 'base' }));
}
