import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateCategories, filterAndSortTemplates } from './templateFilter';
import type { Template } from './api/templates';

const tmpl = (over: Partial<Template>): Template => ({
  id: over.id ?? 'id',
  name: over.name ?? 'name',
  description: over.description ?? '',
  category: over.category ?? 'general',
  skill_data: over.skill_data ?? { prompt: '', applyTo: 'script' },
  is_public: over.is_public ?? true,
  author: over.author ?? 'a',
  created_at: over.created_at ?? '2026-01-01',
  apply_count: over.apply_count ?? 0,
});

test('templateCategories prepends "all" and sorts the distinct categories', () => {
  const list = [tmpl({ category: 'teaching' }), tmpl({ category: 'art' }), tmpl({ category: 'teaching' })];
  assert.deepEqual(templateCategories(list), ['all', 'art', 'teaching']);
  assert.deepEqual(templateCategories([]), ['all']);
});

test('filterAndSortTemplates filters by category', () => {
  const list = [tmpl({ id: 'a', category: 'art' }), tmpl({ id: 'b', category: 'teaching' })];
  const out = filterAndSortTemplates(list, { category: 'art', query: '', sortMode: 'newest' });
  assert.deepEqual(out.map((t) => t.id), ['a']);
  // 'all' keeps everything
  assert.equal(filterAndSortTemplates(list, { category: 'all', query: '', sortMode: 'newest' }).length, 2);
});

test('filterAndSortTemplates searches name, description, and prompt case-insensitively', () => {
  const list = [
    tmpl({ id: 'byName', name: 'Friendly Tutor' }),
    tmpl({ id: 'byDesc', description: 'A WARM teaching style' }),
    tmpl({ id: 'byPrompt', skill_data: { prompt: '請以親切語氣', applyTo: 'script' } }),
    tmpl({ id: 'none', name: 'x', description: 'y' }),
  ];
  assert.deepEqual(filterAndSortTemplates(list, { category: 'all', query: 'friendly', sortMode: 'newest' }).map((t) => t.id), ['byName']);
  assert.deepEqual(filterAndSortTemplates(list, { category: 'all', query: 'warm', sortMode: 'newest' }).map((t) => t.id), ['byDesc']);
  assert.deepEqual(filterAndSortTemplates(list, { category: 'all', query: '親切', sortMode: 'newest' }).map((t) => t.id), ['byPrompt']);
});

test('filterAndSortTemplates "newest" preserves input order; "popular" sorts by apply_count desc', () => {
  const list = [
    tmpl({ id: 'a', apply_count: 1 }),
    tmpl({ id: 'b', apply_count: 9 }),
    tmpl({ id: 'c', apply_count: 5 }),
  ];
  assert.deepEqual(filterAndSortTemplates(list, { category: 'all', query: '', sortMode: 'newest' }).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(filterAndSortTemplates(list, { category: 'all', query: '', sortMode: 'popular' }).map((t) => t.id), ['b', 'c', 'a']);
});

test('filterAndSortTemplates does not mutate the input array', () => {
  const list = [tmpl({ id: 'a', apply_count: 1 }), tmpl({ id: 'b', apply_count: 9 })];
  filterAndSortTemplates(list, { category: 'all', query: '', sortMode: 'popular' });
  assert.deepEqual(list.map((t) => t.id), ['a', 'b']); // original order intact
});
