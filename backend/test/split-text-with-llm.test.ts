import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateSourcePageCount,
  slideCountRangeForSourcePages,
  splitTextWithLlm,
} from '../src/worker/steps/splitTextWithLlm';
import { setOpenAIClientForTest } from '../src/services/openai';
import { buildTextWithPdfPageMarkers, containsPdfPageMarkers } from '../src/services/pdfPageMarkers';

/** Repeats `text` until it reaches at least `minLength` characters. */
function pad(text: string, minLength: number): string {
  let out = text;
  while (out.length < minLength) out += text;
  return out;
}

test('splitTextWithLlm outline-first path reports sourcePdfPages from [[PDF_PAGE_N]] markers', async () => {
  const pages = [
    pad('第一頁說明背景與動機，介紹專案的起源與目標。', 300),
    pad('第二頁說明方法與機制，描述系統如何運作。', 300),
    pad('第三頁說明結果與結論，總結成效與未來方向。', 300),
  ];
  const rawText = buildTextWithPdfPageMarkers(pages);
  assert.ok(rawText.length >= 800, 'fixture text should be long enough to trigger outline-first strategy');
  assert.ok(containsPdfPageMarkers(rawText));

  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (body: { messages: Array<{ role: string; content: string }> }) => {
          calls.push({ messages: body.messages });
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    slides: [
                      { title: '背景與動機', bullets: ['介紹專案起源', '說明專案目標'], source_pages: [1] },
                      { title: '方法與機制', bullets: ['描述系統架構', '說明運作流程'], source_pages: [2] },
                      { title: '結果與結論', bullets: ['總結成效', '展望未來方向'], source_pages: [3, 3] },
                    ],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  } as never);

  try {
    const result = await splitTextWithLlm(rawText);

    assert.equal(calls.length, 1);
    assert.match(calls[0]!.messages[0]?.content ?? '', /source_pages/);

    assert.equal(result.pages.length, 3);
    assert.deepEqual(result.pages.map((p) => p.sourcePdfPages), [[1], [2], [3]]);

    for (const page of result.pages) {
      assert.equal(containsPdfPageMarkers(page.content), false);
    }
    assert.match(result.pages[0]!.content, /背景與動機/);
    assert.match(result.pages[1]!.content, /方法與機制/);
    assert.match(result.pages[2]!.content, /結果與結論/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('splitTextWithLlm forwards userPrompt content into the outline LLM call', async () => {
  const text = pad('一般文字內容，沒有任何頁碼標記，純粹是長篇敘述。', 900);

  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (body: { messages: Array<{ role: string; content: string }> }) => {
          calls.push({ messages: body.messages });
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    slides: [
                      { title: '第一段', bullets: ['重點一', '重點二'] },
                      { title: '第二段', bullets: ['重點一', '重點二'] },
                      { title: '第三段', bullets: ['重點一', '重點二'] },
                    ],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  } as never);

  try {
    await splitTextWithLlm(text, '請特別強調給高中生看的舉例方式');
    assert.equal(calls.length, 1);
    const userMessage = calls[0]!.messages.find((m) => m.role === 'user')?.content ?? '';
    assert.match(userMessage, /請特別強調給高中生看的舉例方式/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('splitTextWithLlm relaxes outline bullet count to 1~2 when Takahashi-style userPrompt is detected', async () => {
  const text = pad('一般文字內容，沒有任何頁碼標記，純粹是長篇敘述。', 900);

  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (body: { messages: Array<{ role: string; content: string }> }) => {
          calls.push({ messages: body.messages });
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    slides: [
                      { title: '第一段', bullets: ['唯一重點'] },
                      { title: '第二段', bullets: ['唯一重點'] },
                      { title: '第三段', bullets: ['唯一重點'] },
                    ],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  } as never);

  try {
    const result = await splitTextWithLlm(text, '請用高橋流風格製作這份簡報');
    assert.equal(calls.length, 1);
    const systemMessage = calls[0]!.messages.find((m) => m.role === 'system')?.content ?? '';
    assert.match(systemMessage, /高橋流/);
    assert.equal(result.pages.length, 3);
    // A single-bullet slide must pass schema validation (min relaxed from 2 to 1).
    assert.match(result.pages[0]!.content, /唯一重點/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('splitTextWithLlm outline-first path is not confused by a bullet containing an embedded "Slide N:"-looking line', async () => {
  // Regression test: `buildOutlineFromFullText()` used to render its
  // structured `slides` result into a flat `Slide N: title\n- bullet...`
  // text blob and then hand it back to `splitBySlideMarkers()` to re-parse
  // into pages. That re-parse is unsafe: zod's bullet schema only requires
  // a non-empty string, so a bullet can legitimately contain an embedded
  // newline whose first line happens to match the `Slide N:` marker
  // pattern (e.g. a bullet that quotes example text). When that happened,
  // the re-parser discovered more "pages" than `slides.length`, which
  // silently shifted every subsequent page's `sourcePdfPages` (and content)
  // out of alignment. The fix builds pages directly from the structured
  // `slides` array instead of re-parsing rendered text.
  const pages = [
    pad('第一頁說明簡介，介紹本文主旨。', 300),
    pad('第二頁舉例說明教學範例，內容引用了示範文字。', 300),
    pad('第三頁總結結論，回顧重點與展望。', 300),
  ];
  const rawText = buildTextWithPdfPageMarkers(pages);
  assert.ok(rawText.length >= 800, 'fixture text should be long enough to trigger outline-first strategy');

  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  slides: [
                    { title: '簡介', bullets: ['本文介紹簡報製作'], source_pages: [1] },
                    {
                      title: '教學範例',
                      bullets: ['範例如下：\nSlide 5: 這是被引用的範例標題\n後面還有更多說明文字'],
                      source_pages: [2],
                    },
                    { title: '結論', bullets: ['總結重點'], source_pages: [3] },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      },
    },
  } as never);

  try {
    const result = await splitTextWithLlm(rawText);

    // Must stay at exactly 3 pages — the embedded "Slide 5:"-looking line
    // inside the second bullet must NOT be mistaken for a 4th page boundary.
    assert.equal(result.pages.length, 3);
    assert.deepEqual(result.pages.map((p) => p.sourcePdfPages), [[1], [2], [3]]);
    assert.match(result.pages[0]!.content, /簡介/);
    assert.match(result.pages[1]!.content, /教學範例/);
    assert.match(result.pages[1]!.content, /Slide 5/);
    assert.match(result.pages[2]!.content, /結論/);
    assert.equal(result.pages.map((p) => p.pageNumber).join(','), '1,2,3');
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('splitTextWithLlm outline-first path leaves sourcePdfPages undefined when input has no markers', async () => {
  const text = pad('一般文字內容，沒有任何頁碼標記，純粹是長篇敘述。', 900);
  assert.equal(containsPdfPageMarkers(text), false);

  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  slides: [
                    { title: '第一段', bullets: ['重點一', '重點二'] },
                    { title: '第二段', bullets: ['重點一', '重點二'] },
                    { title: '第三段', bullets: ['重點一', '重點二'] },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      },
    },
  } as never);

  try {
    const result = await splitTextWithLlm(text);
    assert.equal(result.pages.length, 3);
    for (const page of result.pages) {
      assert.equal(page.sourcePdfPages, undefined);
    }
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('slideCountRangeForSourcePages scales with the source length and stays within bounds', () => {
  // Roughly half a slide to one slide per source page.
  assert.deepEqual(slideCountRangeForSourcePages(39), { min: 20, max: 39 });
  assert.deepEqual(slideCountRangeForSourcePages(20), { min: 10, max: 20 });
  assert.deepEqual(slideCountRangeForSourcePages(11), { min: 6, max: 11 });

  // A very short source still gets a usable deck rather than 0~1 slides.
  assert.deepEqual(slideCountRangeForSourcePages(1), { min: 3, max: 5 });

  // A very long source is capped instead of asking for hundreds of slides,
  // and the range never inverts.
  for (const pages of [100, 200, 5000]) {
    const range = slideCountRangeForSourcePages(pages);
    assert.ok(range.max <= 60, `max should be capped, got ${range.max}`);
    assert.ok(range.min < range.max, `range should not invert at ${pages} pages`);
  }
});

test('estimateSourcePageCount counts [[PDF_PAGE_N]] markers, falling back to character density', () => {
  const withMarkers = buildTextWithPdfPageMarkers(['一', '二', '三', '四']);
  assert.equal(estimateSourcePageCount(withMarkers), 4);

  // No markers (plain .txt import / YouTube captions): estimated from length.
  assert.equal(estimateSourcePageCount(pad('文字', 2800)), 1);
  assert.equal(estimateSourcePageCount(pad('文字', 8400)), 3);
  assert.equal(estimateSourcePageCount(''), 1);
});

test('outline prompt states the slide-count range derived from the source page count', async () => {
  const rawText = buildTextWithPdfPageMarkers(
    Array.from({ length: 39 }, (_, i) => pad(`第 ${i + 1} 頁的內容說明。`, 60)),
  );

  const calls: Array<{ messages: Array<{ role: string; content: string }>; max_tokens?: number }> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (body: { messages: Array<{ role: string; content: string }>; max_tokens?: number }) => {
          calls.push(body);
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    slides: Array.from({ length: 22 }, (_, i) => ({
                      title: `第 ${i + 1} 張`,
                      bullets: ['重點一', '重點二'],
                    })),
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  } as never);

  try {
    const result = await splitTextWithLlm(rawText);

    const system = calls[0]!.messages.find((m) => m.role === 'system')?.content ?? '';
    const user = calls[0]!.messages.find((m) => m.role === 'user')?.content ?? '';
    // 39 source pages -> 20~39 slides, and the model is told so in both messages.
    assert.match(system, /原文約 39 頁，請規劃 20~39 張投影片/);
    assert.match(user, /請產生 20~39 張投影片（原文約 39 頁）/);

    // The token ceiling scales with the range instead of sitting at a fixed
    // 6400, which a 39-slide outline would overrun.
    assert.ok((calls[0]!.max_tokens ?? 0) > 6400, `expected a raised max_tokens, got ${calls[0]!.max_tokens}`);

    assert.equal(result.pages.length, 22);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('an outline slightly above the old 20-slide cap is kept instead of falling back to chunking', async () => {
  // Regression test for the 319-page deck: OutlineSchema capped slides at 20
  // while the prompt never mentioned any limit, so a 39-page paper's perfectly
  // good 22- and 23-slide outlines were both rejected. Rejection dropped the
  // run into the per-chunk strategy, which expanded each 1800-char chunk on its
  // own and produced 319 pages.
  const rawText = buildTextWithPdfPageMarkers(
    Array.from({ length: 39 }, (_, i) => pad(`第 ${i + 1} 頁的內容說明。`, 60)),
  );

  const labels: string[] = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (body: { messages: Array<{ role: string; content: string }> }) => {
          labels.push(body.messages[0]?.content ?? '');
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    slides: Array.from({ length: 23 }, (_, i) => ({
                      title: `第 ${i + 1} 張`,
                      bullets: ['重點一', '重點二', '重點三', '重點四', '重點五'],
                      source_pages: [i + 1],
                    })),
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  } as never);

  try {
    const result = await splitTextWithLlm(rawText);

    assert.equal(result.pages.length, 23);
    // Exactly one call: the outline was accepted, so no chunk pass ran.
    assert.equal(labels.length, 1);
    assert.match(labels[0]!, /你是簡報大綱助理/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('chunk fallback splits on page boundaries and gives each chunk its own slide-count range', async () => {
  // Long enough to need several chunks; markers let each chunk report its own
  // source page count.
  const rawText = buildTextWithPdfPageMarkers(
    Array.from({ length: 39 }, (_, i) => pad(`第 ${i + 1} 頁的內容說明。`, 800)),
  );

  const outlineCalls: string[] = [];
  const chunkCalls: Array<{ system: string; user: string }> = [];
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (body: { messages: Array<{ role: string; content: string }> }) => {
          const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
          const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
          if (system.includes('你是簡報大綱助理')) {
            outlineCalls.push(system);
            // Force the outline strategy to fail so the run falls back to chunking.
            throw new Error('simulated outline failure');
          }
          chunkCalls.push({ system, user });
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    pages: [
                      { page_number: 1, content: '標題：一\n- 重點' },
                      { page_number: 2, content: '標題：二\n- 重點' },
                      { page_number: 3, content: '標題：三\n- 重點' },
                    ],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  } as never);

  try {
    const result = await splitTextWithLlm(rawText);

    assert.ok(outlineCalls.length > 0, 'the outline strategy should be attempted first');
    // At ~815 chars per page and a 12000-char target, 39 pages become a
    // handful of chunks - not the ~30 the old 1800-char size produced.
    assert.ok(chunkCalls.length > 1, 'the source should span several chunks');
    assert.ok(chunkCalls.length <= 8, `expected few large chunks, got ${chunkCalls.length}`);

    for (const call of chunkCalls) {
      // Each chunk is told how many source pages it holds and how many slides
      // that is worth, so total page count tracks the document instead of the
      // number of chunks.
      assert.match(call.system, /這段原文約 \d+ 頁，請產生 \d+~\d+ 頁投影片。/);
      assert.match(call.user, /請產生 \d+~\d+ 頁（這段原文約 \d+ 頁）。/);
    }

    assert.equal(result.pages.length, chunkCalls.length * 3);
    // Page numbers stay contiguous across the merged chunks.
    assert.deepEqual(
      result.pages.map((p) => p.pageNumber),
      Array.from({ length: result.pages.length }, (_, i) => i + 1),
    );
  } finally {
    setOpenAIClientForTest(null);
  }
});
