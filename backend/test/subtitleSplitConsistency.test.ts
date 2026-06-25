import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitScriptIntoSentences as splitTextSentences } from '../src/services/textSentences';
import { splitScriptIntoSentences as splitSubtitleAlignment } from '../src/services/subtitleAlignment';

// splitScriptIntoSentences is duplicated in three places that are documented to
// mirror each other "exactly": frontend/src/lib/subtitles.ts (subtitle display +
// transcript-line animation triggers), backend/src/services/textSentences.ts, and
// backend/src/services/subtitleAlignment.ts (Whisper-aligned timeline). If they
// drift, the sentence indices a presentation's timeline was built from stop lining
// up with what the frontend re-derives, silently desyncing subtitles/animations.
// Each copy already has its own behavioural test, but nothing checks they agree, so
// this guard locks the three copies together.

// Representative scripts exercising CJK/ASCII terminators, semicolons, tone tags,
// newlines and trailing punctuation-less fragments.
const CASES: string[] = [
  '',
  '   \n\n  ',
  '今天天氣很好。我們出去走走吧！你覺得呢？',
  '[[興奮地]]今天是大日子！',
  '[[平靜地]]第一句。[[興奮地]]第二句！',
  '完結句子！trailing fragment without punctuation',
  'Mix中文123abc。另一句xyz456！',
  '第一行\n第二行\n\n第三行',
  '分號分隔；第二段；第三段',
  'No terminal punctuation at all',
  'Hello world. This is English! Is it? Yes;',
];

test('backend textSentences and subtitleAlignment split identically', () => {
  for (const script of CASES) {
    assert.deepEqual(
      splitTextSentences(script),
      splitSubtitleAlignment(script),
      `backend split copies disagree for: ${JSON.stringify(script)}`,
    );
  }
});

function extractRegexLiteral(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*(/.*?/[a-z]*)\\s*;`));
  assert.ok(m, `could not locate ${name} regex literal`);
  return m![1]!;
}

function regexesFromSource(relPath: string): { sentence: string; tone: string } {
  const src = fs.readFileSync(new URL(relPath, import.meta.url), 'utf8');
  return {
    sentence: extractRegexLiteral(src, 'SENTENCE_MATCH_RE'),
    tone: extractRegexLiteral(src, 'TONE_MARKER_RE'),
  };
}

test('the three splitScriptIntoSentences copies use identical splitting regexes', () => {
  const frontend = regexesFromSource('../../frontend/src/lib/subtitles.ts');
  const textSentences = regexesFromSource('../src/services/textSentences.ts');
  const subtitleAlignment = regexesFromSource('../src/services/subtitleAlignment.ts');

  assert.deepEqual(textSentences, frontend, 'backend textSentences regexes drifted from the frontend');
  assert.deepEqual(subtitleAlignment, frontend, 'backend subtitleAlignment regexes drifted from the frontend');
});
