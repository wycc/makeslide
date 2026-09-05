import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import {
  getAccountContentLanguage,
  getRuntimeAiSettings,
  setSystemAuthSettings,
} from '../src/services/aiSettings';
import { getDeckContentLanguage, runWithDeckContentLanguage } from '../src/services/deckContentLanguage';
import { runWithContentLanguage } from '../src/services/contentLanguageContext';

/**
 * 每份簡報各自的產生語言：建立時記下當下的系統語言、開始生成前還能改，
 * 而整條產生流程要讀到的是這一份的語言而不是帳號設定。
 */

function testSessionCookie(sub = 'deck-language-owner'): string {
  const payload = Buffer.from(
    JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }),
    'utf8',
  ).toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const HEADERS = {
  cookie: `makeslide_session=${encodeURIComponent(testSessionCookie())}`,
  'content-type': 'application/json',
};

setSystemAuthSettings({ googleAuthEnabled: false });

function deckLanguageInDb(id: string): string | null {
  const row = db.prepare('SELECT content_language FROM pdfs WHERE id = ?').get(id) as
    | { content_language: string | null }
    | undefined;
  return row?.content_language ?? null;
}

test('建立簡報時帶的語言會存成這份簡報自己的設定', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { title: 'English deck', content_language: 'en' },
    });
    assert.equal(resp.statusCode, 201);
    const body = resp.json() as { id: string; content_language: string };
    assert.equal(body.content_language, 'en');
    assert.equal(deckLanguageInDb(body.id), 'en');
  } finally {
    await app.close();
  }
});

test('沒帶語言就記下當下的帳號設定，而不是留空跟著設定漂移', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: {},
    });
    assert.equal(resp.statusCode, 201);
    const { id } = resp.json() as { id: string };
    assert.equal(deckLanguageInDb(id), getAccountContentLanguage('deck-language-owner'));
  } finally {
    await app.close();
  }
});

test('兩份同時建立的簡報可以各自是不同語言', async () => {
  const app = await buildApp();
  try {
    const zh = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { content_language: 'zh-TW' },
    });
    const en = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { content_language: 'en' },
    });
    const zhId = (zh.json() as { id: string }).id;
    const enId = (en.json() as { id: string }).id;
    assert.equal(deckLanguageInDb(zhId), 'zh-TW');
    assert.equal(deckLanguageInDb(enId), 'en');
  } finally {
    await app.close();
  }
});

test('簡報詳情同時回報自己的語言與「沿用設定」會是哪一種', async () => {
  const app = await buildApp();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { content_language: 'en' },
    });
    const { id } = created.json() as { id: string };

    const detail = await app.inject({ method: 'GET', url: `/api/pdfs/${id}`, headers: HEADERS });
    assert.equal(detail.statusCode, 200);
    const body = detail.json() as { content_language: string; account_content_language: string };
    assert.equal(body.content_language, 'en');
    // 這一欄是帳號設定，不能被「正在讀這份英文簡報」影響——不然 UI 會以為預設就是英文。
    assert.equal(body.account_content_language, getAccountContentLanguage('deck-language-owner'));
  } finally {
    await app.close();
  }
});

test('runWithDeckContentLanguage 讓產生流程讀到的是這份簡報的語言', async () => {
  const app = await buildApp();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { content_language: 'en' },
    });
    const { id } = created.json() as { id: string };

    const accountLanguage = getRuntimeAiSettings().contentLanguage;
    const inDeckContext = runWithDeckContentLanguage(id, () => getRuntimeAiSettings().contentLanguage);
    assert.equal(inDeckContext, 'en');
    // 離開情境之後不留痕跡，否則同一個 worker 處理下一份簡報就會用錯語言。
    assert.equal(getRuntimeAiSettings().contentLanguage, accountLanguage);
  } finally {
    await app.close();
  }
});

test('在簡報設定裡改語言會改寫這一份的設定，之後的產生流程就用新語言', async () => {
  const app = await buildApp();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { content_language: 'zh-TW' },
    });
    const { id } = created.json() as { id: string };

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/content-language`,
      headers: HEADERS,
      payload: { content_language: 'en' },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal((patched.json() as { content_language: string }).content_language, 'en');
    assert.equal(deckLanguageInDb(id), 'en');
    // 改完之後真的會用新語言產生：這正是 pipeline／重生所走的那一段。
    assert.equal(runWithDeckContentLanguage(id, () => getRuntimeAiSettings().contentLanguage), 'en');

    const detail = await app.inject({ method: 'GET', url: `/api/pdfs/${id}`, headers: HEADERS });
    assert.equal((detail.json() as { content_language: string }).content_language, 'en');
  } finally {
    await app.close();
  }
});

test('簡報設定只收支援的語言，其他值一律拒絕且不動到原本的設定', async () => {
  const app = await buildApp();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { content_language: 'zh-TW' },
    });
    const { id } = created.json() as { id: string };

    for (const payload of [{ content_language: 'ja' }, {}]) {
      const resp = await app.inject({
        method: 'PATCH',
        url: `/api/pdfs/${id}/content-language`,
        headers: HEADERS,
        payload,
      });
      assert.equal(resp.statusCode, 400);
    }
    assert.equal(deckLanguageInDb(id), 'zh-TW');
  } finally {
    await app.close();
  }
});

test('別人的簡報改不了語言', async () => {
  const app = await buildApp();
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { content_language: 'zh-TW' },
    });
    const { id } = created.json() as { id: string };

    const resp = await app.inject({
      method: 'PATCH',
      url: `/api/pdfs/${id}/content-language`,
      headers: {
        cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('someone-else'))}`,
        'content-type': 'application/json',
      },
      payload: { content_language: 'en' },
    });
    assert.equal(resp.statusCode, 403);
    assert.equal(deckLanguageInDb(id), 'zh-TW');
  } finally {
    await app.close();
  }
});

test('帶簡報 id 的請求會自動進入這份簡報的語言情境', async () => {
  // 單頁重寫逐字稿、重生圖片、產生動畫這些都是在請求裡同步呼叫 LLM，靠的就是
  // server.ts 的 onRequest hook 把語言情境帶起來。這裡驗證 hook 真的有生效：
  // 在它之後註冊的 hook 讀到的 contentLanguage 必須是這份簡報的語言。
  const setup = await buildApp();
  let id = '';
  try {
    const created = await setup.inject({
      method: 'POST',
      url: '/api/pdfs/blank',
      headers: HEADERS,
      payload: { content_language: 'en' },
    });
    id = (created.json() as { id: string }).id;
  } finally {
    await setup.close();
  }

  // hook 只能在 ready() 之前註冊，所以觀察用的 app 得是另一個實例（DB 是同一份）。
  const app = await buildApp();
  const observed: string[] = [];
  app.addHook('onRequest', (request, _reply, done) => {
    if ((request.url ?? '').includes(id)) observed.push(getRuntimeAiSettings().contentLanguage);
    done();
  });
  try {
    const detail = await app.inject({ method: 'GET', url: `/api/pdfs/${id}`, headers: HEADERS });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(observed, ['en']);
    // 請求結束後不留痕跡，否則下一個請求會沿用上一份簡報的語言。
    assert.equal(getRuntimeAiSettings().contentLanguage, getAccountContentLanguage('deck-language-owner'));
  } finally {
    await app.close();
  }
});

test('沒設語言的舊簡報沿用帳號設定，不建立覆蓋情境', () => {
  assert.equal(getDeckContentLanguage('does-not-exist'), null);
  const accountLanguage = getRuntimeAiSettings().contentLanguage;
  assert.equal(
    runWithDeckContentLanguage('does-not-exist', () => getRuntimeAiSettings().contentLanguage),
    accountLanguage,
  );
});

test('語言覆蓋不會汙染帳號設定本身', () => {
  const accountLanguage = getAccountContentLanguage();
  const other = accountLanguage === 'en' ? 'zh-TW' : 'en';
  runWithContentLanguage(other, () => {
    assert.equal(getRuntimeAiSettings().contentLanguage, other);
    // 設定頁要顯示／存回的是帳號那一份，不能跟著簡報情境跑。
    assert.equal(getAccountContentLanguage(), accountLanguage);
  });
});
