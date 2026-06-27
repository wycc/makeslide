import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHomeStats } from './homeStats';

type Item = Parameters<typeof summarizeHomeStats>[0][number];

const item = (o: Partial<Item>): Item => ({
  page_count: o.page_count ?? null,
  play_count: o.play_count,
  total_audio_duration_seconds: o.total_audio_duration_seconds,
});

test('空清單回傳全 0', () => {
  assert.deepEqual(summarizeHomeStats([]), {
    totalPdfs: 0,
    totalPages: 0,
    totalPlays: 0,
    totalAudioMin: 0,
  });
});

test('正常彙總頁數、播放數與音訊分鐘數（四捨五入）', () => {
  const stats = summarizeHomeStats([
    item({ page_count: 10, play_count: 3, total_audio_duration_seconds: 90 }),
    item({ page_count: 5, play_count: 2, total_audio_duration_seconds: 120 }),
  ]);
  assert.equal(stats.totalPdfs, 2);
  assert.equal(stats.totalPages, 15);
  assert.equal(stats.totalPlays, 5);
  // (90 + 120) / 60 = 3.5 → 四捨五入 4
  assert.equal(stats.totalAudioMin, 4);
});

test('缺值欄位（null/undefined）以 0 計入', () => {
  const stats = summarizeHomeStats([
    item({ page_count: null, play_count: undefined, total_audio_duration_seconds: undefined }),
    item({ page_count: 7, total_audio_duration_seconds: null }),
  ]);
  assert.equal(stats.totalPdfs, 2);
  assert.equal(stats.totalPages, 7);
  assert.equal(stats.totalPlays, 0);
  assert.equal(stats.totalAudioMin, 0);
});

test('與舊內聯 reduce 寫法輸出一致', () => {
  const items = [
    item({ page_count: 3, play_count: 1, total_audio_duration_seconds: 45 }),
    item({ page_count: null, play_count: 4, total_audio_duration_seconds: 200 }),
    item({ page_count: 12, total_audio_duration_seconds: null }),
  ];
  const expected = {
    totalPdfs: items.length,
    totalPages: items.reduce((s, p) => s + (p.page_count ?? 0), 0),
    totalPlays: items.reduce((s, p) => s + (p.play_count ?? 0), 0),
    totalAudioMin: Math.round(
      items.reduce((s, p) => s + (p.total_audio_duration_seconds ?? 0), 0) / 60,
    ),
  };
  assert.deepEqual(summarizeHomeStats(items), expected);
});
