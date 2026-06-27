import test from 'node:test';
import assert from 'node:assert/strict';
import { safeDownloadBaseName, buildContentDisposition, csvDownloadFilename } from '../src/routes/pdfs/downloadFilename';

test('safeDownloadBaseName keeps plain titles and hyphens', () => {
  assert.equal(safeDownloadBaseName('My Talk-01', 'fallback'), 'My Talk-01');
});

test('safeDownloadBaseName replaces filesystem-illegal characters with spaces', () => {
  assert.equal(safeDownloadBaseName('a/b:c*?"<>|d', 'x'), 'a b c d');
});

test('safeDownloadBaseName collapses whitespace and trims', () => {
  assert.equal(safeDownloadBaseName('  hello   world  ', 'x'), 'hello world');
});

test('safeDownloadBaseName falls back when empty or whitespace-only', () => {
  assert.equal(safeDownloadBaseName('', 'subtitles'), 'subtitles');
  assert.equal(safeDownloadBaseName('   ', 'subtitles'), 'subtitles');
  assert.equal(safeDownloadBaseName(null, 'transcript'), 'transcript');
  assert.equal(safeDownloadBaseName(undefined, 'transcript'), 'transcript');
});

test('safeDownloadBaseName preserves unicode (CJK) and caps length at 80', () => {
  assert.equal(safeDownloadBaseName('中文標題', 'x'), '中文標題');
  const long = 'a'.repeat(100);
  assert.equal(safeDownloadBaseName(long, 'x').length, 80);
});

test('buildContentDisposition emits an ASCII fallback and an RFC 5987 filename*', () => {
  assert.equal(
    buildContentDisposition('a b.srt'),
    "attachment; filename=\"a b.srt\"; filename*=UTF-8''a%20b.srt",
  );
});

test('buildContentDisposition replaces non-ASCII in the fallback but keeps it in filename*', () => {
  const out = buildContentDisposition('中文.txt');
  assert.equal(out, `attachment; filename="__.txt"; filename*=UTF-8''${encodeURIComponent('中文.txt')}`);
});

test('csvDownloadFilename uses the title-based name when the title is usable', () => {
  assert.equal(
    csvDownloadFilename('My Talk', 'abc123', { titleSuffix: 'quiz-results', fallbackPrefix: 'quiz-results' }),
    'My Talk-quiz-results.csv',
  );
  // CJK titles are preserved (safeDownloadBaseName keeps unicode)
  assert.equal(
    csvDownloadFilename('中文標題', 'abc123', { titleSuffix: 'pages', fallbackPrefix: 'report-pages' }),
    '中文標題-pages.csv',
  );
});

test('csvDownloadFilename falls back to the id-based name when the title is empty', () => {
  assert.equal(
    csvDownloadFilename('', 'abc123', { titleSuffix: 'students', fallbackPrefix: 'report' }),
    'report-abc123.csv',
  );
  assert.equal(
    csvDownloadFilename('   ', 'abc123', { titleSuffix: 'comments', fallbackPrefix: 'comments' }),
    'comments-abc123.csv',
  );
  assert.equal(
    csvDownloadFilename(null, 'xyz', { titleSuffix: 'poll-results', fallbackPrefix: 'poll-results' }),
    'poll-results-xyz.csv',
  );
});

test('csvDownloadFilename matches the previous inline title-or-id pattern', () => {
  // mirrors report.ts questions export: titleSuffix 'questions', fallbackPrefix 'report-questions'
  assert.equal(
    csvDownloadFilename('Week 1', 'p1', { titleSuffix: 'questions', fallbackPrefix: 'report-questions' }),
    'Week 1-questions.csv',
  );
  assert.equal(
    csvDownloadFilename(undefined, 'p1', { titleSuffix: 'questions', fallbackPrefix: 'report-questions' }),
    'report-questions-p1.csv',
  );
});
