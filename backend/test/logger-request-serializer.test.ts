import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeRequestForLog } from '../src/logger';

// 使用者要求（2026-11-03）：查「學生為什麼無法完成」時後端日誌沒有任何裝置線索。測驗相關路徑記 User-Agent，其他不記。
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Line/14.8.0';
function req(url: string) {
  return { method: 'POST', url, headers: { 'user-agent': UA, 'accept-version': undefined }, hostname: 'h', ip: '127.0.0.1', socket: { remotePort: 1234 } };
}

test('quiz-related requests carry the user agent, other requests keep the default fields only', () => {
  for (const url of [
    '/api/pdfs/abc/quizzes',
    '/api/pdfs/abc/quizzes/35/attempts',
    '/api/pdfs/abc/quizzes/35/essay-answers',
    '/api/pdfs/abc/sync/quiz/progress',
    '/api/pdfs/abc/sync/share-join',
    '/api/pdfs/abc/sync/join',
    '/api/pdfs/abc/quizzes?x=1',
  ]) {
    assert.equal(serializeRequestForLog(req(url)).userAgent, UA, url);
  }
  for (const url of ['/api/pdfs/abc/sync/state?client_id=x', '/api/pdfs/abc/pages/1/audio', '/']) {
    const out = serializeRequestForLog(req(url));
    assert.equal('userAgent' in out, false, url);
  }
  const out = serializeRequestForLog(req('/api/pdfs/abc/quizzes'));
  assert.deepEqual(Object.keys(out).sort(), ['hostname', 'method', 'remoteAddress', 'remotePort', 'url', 'userAgent', 'version'].sort(), 'the default fields stay');
});
