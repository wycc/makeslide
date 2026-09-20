import test from 'node:test';
import assert from 'node:assert/strict';

// The getStored* helpers read `window.localStorage`, so stub a minimal window
// before importing the module (mirrors lib/viewerId.test.ts).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}
const localStorage = new MemoryStorage();
(globalThis as { window?: unknown }).window = { localStorage };

const {
  getStoredShowSubtitle,
  getStoredInteractiveMode,
  getStoredAutoAdvance,
  getStoredTtsSpeed,
  getStoredPlaybackSpeed,
  SHOW_SUBTITLE_STORAGE_KEY,
  INTERACTIVE_MODE_STORAGE_KEY,
  AUTO_ADVANCE_STORAGE_KEY,
  TTS_SPEED_STORAGE_KEY,
  PLAYBACK_SPEED_STORAGE_KEY,
} = await import('./i18n');

test('getStoredShowSubtitle defaults to true and parses 1/true as true, anything else false', () => {
  localStorage.clear();
  assert.equal(getStoredShowSubtitle(), true); // unset -> default true
  localStorage.setItem(SHOW_SUBTITLE_STORAGE_KEY, '1');
  assert.equal(getStoredShowSubtitle(), true);
  localStorage.setItem(SHOW_SUBTITLE_STORAGE_KEY, 'TRUE');
  assert.equal(getStoredShowSubtitle(), true);
  localStorage.setItem(SHOW_SUBTITLE_STORAGE_KEY, '0');
  assert.equal(getStoredShowSubtitle(), false);
  localStorage.setItem(SHOW_SUBTITLE_STORAGE_KEY, 'nope');
  assert.equal(getStoredShowSubtitle(), false);
});

test('getStoredInteractiveMode defaults to false and parses 1/true', () => {
  localStorage.clear();
  assert.equal(getStoredInteractiveMode(), false); // unset -> default false
  localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, 'true');
  assert.equal(getStoredInteractiveMode(), true);
  localStorage.setItem(INTERACTIVE_MODE_STORAGE_KEY, '0');
  assert.equal(getStoredInteractiveMode(), false);
});

test('getStoredAutoAdvance plays on to the next page unless it was turned off', () => {
  // 一直以來的預設是「停在每一頁」，而面板徽章寫的是「連續播放」：一頁講完就停，看到的人
  // 找不到原因。沒設定過＝會接著播下一頁，只有明確關掉才停。
  localStorage.clear();
  assert.equal(getStoredAutoAdvance(), true, '沒設定過就應該接著播下一頁');
  localStorage.setItem(AUTO_ADVANCE_STORAGE_KEY, '0');
  assert.equal(getStoredAutoAdvance(), false, '關掉的人要維持關掉');
  localStorage.setItem(AUTO_ADVANCE_STORAGE_KEY, 'false');
  assert.equal(getStoredAutoAdvance(), false);
  localStorage.setItem(AUTO_ADVANCE_STORAGE_KEY, '1');
  assert.equal(getStoredAutoAdvance(), true);
});

test('getStoredTtsSpeed defaults to 1 and accepts only the 0.5–2 range', () => {
  localStorage.clear();
  assert.equal(getStoredTtsSpeed(), 1); // unset
  localStorage.setItem(TTS_SPEED_STORAGE_KEY, '1.5');
  assert.equal(getStoredTtsSpeed(), 1.5);
  localStorage.setItem(TTS_SPEED_STORAGE_KEY, '0.3'); // below range
  assert.equal(getStoredTtsSpeed(), 1);
  localStorage.setItem(TTS_SPEED_STORAGE_KEY, '3'); // above range
  assert.equal(getStoredTtsSpeed(), 1);
  localStorage.setItem(TTS_SPEED_STORAGE_KEY, 'abc');
  assert.equal(getStoredTtsSpeed(), 1);
});

test('getStoredPlaybackSpeed defaults to 1 and only accepts allowed-set speeds', () => {
  localStorage.clear();
  assert.equal(getStoredPlaybackSpeed(), 1); // unset
  localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, '1.5');
  assert.equal(getStoredPlaybackSpeed(), 1.5);
  localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, '1.1'); // not in allowed set
  assert.equal(getStoredPlaybackSpeed(), 1);
  localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, '9');
  assert.equal(getStoredPlaybackSpeed(), 1);
});
