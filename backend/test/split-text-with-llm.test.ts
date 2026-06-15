import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextWithLlm } from '../src/worker/steps/splitTextWithLlm';
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
