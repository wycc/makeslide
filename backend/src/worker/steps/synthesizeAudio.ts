import fs from 'node:fs';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { parseWavPcmChunk, buildWavPcm16 } from '../../services/wav';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';
// One page's spoken-audio transcode (typically tens of seconds to a few minutes of speech);
// 3 minutes is a generous safety margin over normal runtime.
const AUDIO_TRANSCODE_TIMEOUT_MS = 3 * 60_000;
import PQueue from 'p-queue';
import { parseFile } from 'music-metadata';
import { APIError } from 'openai';
import { config } from '../../config';
import { logger } from '../../logger';
import { getOpenAIClient, transcribeAudioBufferWithWordTimestamps } from '../../services/openai';
import { normalizeGeminiVoiceName, synthesizeGeminiSpeech } from '../../services/gemini';
import { getRuntimeAiSettings, accountHasOwnProviderKey, globalSpeakerVoicesFor, type RuntimeAiSettings, type TtsProvider } from '../../services/aiSettings';
import { getStickyTtsProvider, setStickyTtsProvider, estimateTtsCostUsd } from '../../services/llmUsage';
import { currentAccountId } from '../../services/accountContext';
import {
  getAccountWeeklyUsage,
  recordDefaultSourceCost,
  defaultSourceQuotaExceededMessage,
} from '../../services/defaultSourceQuota';
import { pageAudioPath, pageScriptPath, pageTimelinePath } from '../../services/storage';
import { alignSentencesToWordTimestamps, splitScriptIntoSentences } from '../../services/subtitleAlignment';
import { db, savePageGenerationPrompt } from '../../db';
import { redactTextForLog } from '../../services/logSanitizer';

/**
 * `timeoutMs`, if given, kills the process (SIGTERM) and rejects with a distinct "timed out"
 * message instead of waiting forever — this step runs once per page in the main pipeline, so
 * with `PROCESS_CONCURRENCY` defaulting to 2, a single stuck ffmpeg call here is enough to stall
 * the entire processing queue (same class of issue already fixed for yt-dlp/ffmpeg in
 * youtubeCaptions.ts and for generateVideo.ts's ffmpeg calls).
 */
/** Exported for unit testing; not part of this module's public synthesis API. */
export function runCommand(command: string, args: string[], timeoutMs?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs)
      : null;
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms and was killed`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

// Re-exported (imported at top) so existing importers keep working.
export { parseWavPcmChunk, buildWavPcm16 };

/**
 * OpenAI TTS hard limit on the `input` field (per docs, 4096 characters).
 * We clip conservatively below this to leave room for multibyte escaping.
 */
const TTS_INPUT_MAX_CHARS = 4096;
const TTS_MAX_ATTEMPTS = 10;
const TTS_RETRY_INITIAL_DELAY_MS = 1000;
const TTS_RETRY_MAX_DELAY_MS = 15000;
const TTS_RETRY_FACTOR = 2;
const TONE_MARKER_RE = /\[\[\s*([^\]]+)\s*\]\]/g;
/**
 * Single-pass EBU R128 loudness normalization applied to every synthesized segment.
 * `I=-16` (integrated LUFS) is the usual target for spoken web/podcast audio, `TP=-1.5`
 * leaves headroom against clipping, `LRA=11` keeps a natural dynamic range. Single pass is
 * deliberate: a two-pass measure/apply run would double the ffmpeg work per page for an
 * accuracy gain that does not matter for levelling segments against each other.
 */
const LOUDNORM_FILTER = 'loudnorm=I=-16:TP=-1.5:LRA=11';
/**
 * OpenRouter's Gemini TTS returns headerless PCM and reports the rate only in the
 * `Content-Type` (`audio/pcm;rate=24000;channels=1`), which the OpenAI SDK does not surface.
 * 24 kHz mono is what Gemini TTS emits, matching its direct API.
 */
const OPENROUTER_TTS_SAMPLE_RATE = 24000;
/** Sample rate written for every page. All three TTS providers here produce 24 kHz speech. */
const TTS_OUTPUT_SAMPLE_RATE = 24000;
const SPEAKER_PREFIX_RE = /^\s*Speaker\s*([12])\s*[:：]\s*/i;
// 舊版 Gemini 腳本以 {{語氣}} 描述情緒；一律移除。
const LEGACY_BRACE_TONE_RE = /\{\{[^{}]*\}\}/g;
// Gemini 腳本的 prompt 會插入單括號英文語氣標籤（如 [seriously]、[excitedly]、
// [very fast]），本應由具語意理解的 TTS 當成情緒指令而不朗讀；但實務上 Gemini
// 偶爾照唸，切到 OpenAI TTS（其 splitByToneMarkers 只認 [[ ]]）時更是必被讀出。
// 送 TTS 前一律濾掉這類「純英文字母/空白的單括號」標籤。雙括號 [[ 中文語氣 ]] 因
// 內容為中文、且緊接 [ 的是 [ 或空白而非字母，故不會被此規則誤傷（仍交給
// splitByToneMarkers 處理）；[1] 這類數字引註同理不受影響。
const INLINE_TONE_TAG_RE = /\[[A-Za-z][A-Za-z ]*\]/g;

/**
 * Removes tone/emotion annotations that must never be spoken aloud, before the
 * script is handed to any TTS provider:
 *   - legacy `{{...}}` emotion notes, and
 *   - single-bracket English tags (`[seriously]`, `[very fast]`, …) that the
 *     Gemini script prompts embed as native TTS steering.
 * Double-bracket `[[ 中文語氣 ]]` markers are intentionally left intact for
 * `splitByToneMarkers` to consume downstream. Collapses the runs of spaces the
 * removals leave behind. Exported for unit testing.
 */
export function stripSpokenToneTags(script: string): string {
  return script
    .replace(LEGACY_BRACE_TONE_RE, '')
    .replace(INLINE_TONE_TAG_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface SynthesizeAudioPageResult {
  pageNumber: number;
  audioPath: string;
  chars: number;
  bytes: number;
  durationSeconds: number | null;
  generatedAt: string;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  skipped: boolean;
  /** Reason the page was skipped (i.e. TTS failed after all retries), if any. */
  error: string | null;
}

export interface SynthesizeAudioResult {
  pages: SynthesizeAudioPageResult[];
  totalChars: number;
}

export interface SynthesizeAudioOptions {
  pdfId: string;
  pageCount: number;
  /** Per-page scripts already produced by the generateScript step. */
  pages: Array<{ pageNumber: number; script: string }>;
  /**
   * Optional progress callback fired after each page completes (including
   * idempotent skips). `done` is 1-based count of pages finished so far.
   * Safe to invoke from within concurrent workers.
   */
  onPage?: (pageNumber: number, done: number, info?: { startedAt: string; endedAt: string; skipped: boolean; audioPath: string; durationSeconds: number | null; error: string | null }) => void;
  voice?: string | null;
  /**
   * Per-deck dual-host voices. Take precedence over the global speaker voices;
   * null/empty means "use the global one" (see resolveSpeakerVoice).
   */
  speaker1Voice?: string | null;
  speaker2Voice?: string | null;
  speed?: number | null;
  /**
   * Optional cancellation probe. Invoked before each page's TTS request.
   * If it returns true, that page throws `CANCELLED` immediately. Tasks
   * already in flight still complete; pending ones will see the abort
   * flag and cascade-throw quickly.
   */
  shouldAbort?: () => boolean;
}

async function readAudioDuration(filePath: string): Promise<number | null> {
  try {
    const meta = await parseFile(filePath, { duration: true });
    const d = meta.format?.duration;
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
      return d;
    }
    return null;
  } catch (err) {
    logger.warn(
      { filePath, error: err instanceof Error ? err.message : String(err) },
      'synthesizeAudio: failed to read audio duration',
    );
    return null;
  }
}

export function isRetryableTtsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string; type?: string; status?: number };
  const name = (e.name ?? '').toLowerCase();
  const type = (e.type ?? '').toLowerCase();
  const message = (e.message ?? '').toLowerCase();
  const status = e.status;

  if (status === 408 || status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (name.includes('timeout') || type.includes('timeout') || message.includes('timed out')) {
    return true;
  }
  if (name.includes('connection') || type.includes('connection')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a human-readable error message for a failed TTS attempt, including
 * the HTTP status / error code when available so the reason shown in the
 * console and UI is actionable (e.g. "401 invalid_api_key: Incorrect API key").
 */
export function extractTtsErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as { status?: unknown; code?: unknown; type?: unknown; message?: unknown };
  const status = typeof e.status === 'number' ? e.status : null;
  const code = typeof e.code === 'string' ? e.code : null;
  const type = typeof e.type === 'string' ? e.type : null;
  const message = typeof e.message === 'string' ? e.message : String(err);
  const prefix = [status != null ? String(status) : null, code ?? type]
    .filter((v): v is string => !!v)
    .join(' ');
  return prefix ? `${prefix}: ${message}` : message;
}

export function splitByToneMarkers(script: string): Array<{ instruction: string; text: string }> {
  const out: Array<{ instruction: string; text: string }> = [];
  let currentInstruction = '平穩敘述';
  let lastIdx = 0;
  TONE_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TONE_MARKER_RE.exec(script)) !== null) {
    const seg = script.slice(lastIdx, m.index).trim();
    if (seg) out.push({ instruction: currentInstruction, text: seg });
    currentInstruction = (m[1] ?? '').trim() || '平穩敘述';
    lastIdx = m.index + m[0].length;
  }
  const tail = script.slice(lastIdx).trim();
  if (tail) out.push({ instruction: currentInstruction, text: tail });
  if (out.length === 0 && script.trim()) {
    out.push({ instruction: '平穩敘述', text: script.trim() });
  }
  return out;
}

/**
 * Whether an OpenAI TTS model accepts the `instructions` field (tone/pace steering).
 * The legacy `tts-1` / `tts-1-hd` models reject it, so callers must omit it there —
 * only the `gpt-*` speech models (e.g. `gpt-4o-mini-tts`) support it.
 */
export function supportsTtsInstructions(model: string): boolean {
  return model.trim().toLowerCase().startsWith('gpt-');
}

/**
 * Build the `instructions` string for one OpenAI TTS segment.
 *
 * Until now the per-segment tone from `[[ 語氣 ]]` markers and the per-speaker persona
 * (`OPENAI_TTS_SPEAKER1/2`) only ever reached the script-writing LLM — the speech request
 * itself carried nothing but text/voice/speed, so "活潑、語速稍快" changed the wording but
 * never the delivery. Both now travel with the request.
 *
 * Returns undefined when there is nothing to say, so callers can omit the field entirely.
 */
export function buildTtsInstructions(params: {
  tone?: string | null;
  persona?: string | null;
}): string | undefined {
  const lines: string[] = [];
  const persona = params.persona?.trim();
  const tone = params.tone?.trim();
  if (persona) lines.push(`角色設定：${persona}`);
  if (tone) lines.push(`這一段的語氣：${tone}`);
  if (lines.length === 0) return undefined;
  return lines.join('\n');
}

/**
 * Voice to read one segment with, resolved most-specific-first:
 * this deck's voice for that speaker → the global voice for that speaker → this deck's
 * single voice.
 *
 * The per-deck speaker voices used to not exist, so the global ones silently overrode the
 * voice chosen for the deck — picking a voice in the play page appeared to do nothing on
 * dual-host decks. A deck now wins over the global setting, and leaving its speaker voice
 * empty is what opts back into the global one.
 */
export function resolveSpeakerVoice(params: {
  speaker: '1' | '2' | null;
  deckVoice: string;
  deckSpeaker1Voice?: string | null;
  deckSpeaker2Voice?: string | null;
  globalSpeaker1Voice?: string | null;
  globalSpeaker2Voice?: string | null;
}): string {
  if (params.speaker === null) return params.deckVoice;
  const deckSpeakerVoice = params.speaker === '1' ? params.deckSpeaker1Voice : params.deckSpeaker2Voice;
  if (deckSpeakerVoice?.trim()) return deckSpeakerVoice.trim();
  const globalSpeakerVoice = params.speaker === '1' ? params.globalSpeaker1Voice : params.globalSpeaker2Voice;
  if (globalSpeakerVoice?.trim()) return globalSpeakerVoice.trim();
  return params.deckVoice;
}

/**
 * ffmpeg arguments that level every synthesized segment to the same loudness and concatenate
 * them into the page's final track.
 *
 * Each segment is its own TTS call, so the two hosts (and even two segments of the same host)
 * come back at whatever level the API happened to produce — the "Speaker 2 sounds quieter"
 * symptom. Normalizing per segment is what fixes that: a single pass over the already-joined
 * page would lift the whole track equally and preserve the imbalance.
 */
export function buildSegmentLoudnessConcatArgs(inputPaths: string[], targetPath: string): string[] {
  if (inputPaths.length === 0) throw new Error('buildSegmentLoudnessConcatArgs requires at least one input');
  // `-ar` is not cosmetic: loudnorm works internally at 192 kHz and, in single-pass mode,
  // hands that rate downstream, so without this the aac encoder writes 96 kHz (its ceiling)
  // and the page balloons in size for no gain. Every TTS provider here emits 24 kHz speech.
  const encodeArgs = ['-c:a', 'aac', '-b:a', '128k', '-ar', String(TTS_OUTPUT_SAMPLE_RATE), '-movflags', '+faststart', targetPath];
  if (inputPaths.length === 1) {
    return ['-y', '-i', inputPaths[0]!, '-af', LOUDNORM_FILTER, ...encodeArgs];
  }
  const normalized = inputPaths.map((_, idx) => `[${idx}:a]${LOUDNORM_FILTER}[s${idx}]`).join(';');
  const concatInputs = inputPaths.map((_, idx) => `[s${idx}]`).join('');
  const filter = `${normalized};${concatInputs}concat=n=${inputPaths.length}:v=0:a=1[out]`;
  return [
    '-y',
    ...inputPaths.flatMap((p) => ['-i', p]),
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    ...encodeArgs,
  ];
}

/**
 * The `stage: 'audio'` entry kept in `page_generation_prompts` — what a page's speech was
 * actually generated from, for after-the-fact inspection.
 *
 * The per-speaker voice/persona lines matter because in dual-host mode they override the
 * per-presentation voice entirely: without them recorded, a stored `voice: alloy` looks like
 * the whole page was read by alloy even when Speaker 2 was actually sage.
 */
export function buildAudioPromptRecord(params: {
  provider: string;
  voice: string;
  speed: number;
  script: string;
  speaker1Voice?: string | null;
  speaker2Voice?: string | null;
  speaker1Persona?: string | null;
  speaker2Persona?: string | null;
}): string {
  const lines = [`provider: ${params.provider}`, `voice: ${params.voice}`, `speed: ${params.speed}`];
  const speakerLine = (label: string, voice?: string | null, persona?: string | null): string | null => {
    const parts: string[] = [];
    if (voice?.trim()) parts.push(`voice=${voice.trim()}`);
    if (persona?.trim()) parts.push(`persona=${persona.trim()}`);
    return parts.length > 0 ? `${label}: ${parts.join(' ')}` : null;
  };
  const s1 = speakerLine('speaker1', params.speaker1Voice, params.speaker1Persona);
  const s2 = speakerLine('speaker2', params.speaker2Voice, params.speaker2Persona);
  if (s1) lines.push(s1);
  if (s2) lines.push(s2);
  lines.push(`script:\n${params.script}`);
  return lines.join('\n');
}

/**
 * Strip a leading "Speaker 1:" / "Speaker 2:" label from a dual-host segment
 * (OpenAI dual mode) so it isn't read aloud, and report which speaker the
 * segment belongs to so the caller can pick a per-speaker voice.
 */
export function splitSpeakerPrefix(text: string): { speaker: '1' | '2' | null; text: string } {
  const m = SPEAKER_PREFIX_RE.exec(text);
  if (!m) return { speaker: null, text };
  return { speaker: m[1] as '1' | '2', text: text.slice(m[0].length).trim() };
}

/**
 * Builds and persists a Whisper-aligned subtitle timeline for one page, used by the
 * "subtitleSyncMode === 'whisper'" precision mode. Never throws — a transcription failure (e.g.
 * no OpenAI key configured even though TTS itself uses Gemini, a transient API error) just means
 * no timeline file gets written, and the frontend transparently falls back to its own
 * character-count estimate for that page, exactly as it already does when this mode is off.
 */
async function writeWhisperTimelineIfEnabled(params: {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
  script: string;
  audioPath: string;
}): Promise<void> {
  const { pdfId, pageNumber, pageUid, script, audioPath } = params;
  const sentences = splitScriptIntoSentences(script);
  if (sentences.length === 0) return;
  try {
    const audioBuffer = await fs.promises.readFile(audioPath);
    const words = await transcribeAudioBufferWithWordTimestamps(audioBuffer, `${pageUid}.m4a`, 'audio/mp4');
    if (words.length === 0) return;
    const timeline = alignSentencesToWordTimestamps(sentences, words);
    await fs.promises.writeFile(pageTimelinePath(pdfId, pageUid), JSON.stringify(timeline), 'utf8');
  } catch (err) {
    logger.warn(
      { err, pdfId, pageNumber },
      'synthesizeAudio: failed to build Whisper subtitle timeline, falling back to estimate',
    );
  }
}

async function synthesizeOnePage(params: {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
  script: string;
  voice: string;
  speaker1Voice: string | null;
  speaker2Voice: string | null;
  speed: number;
  shouldAbort?: () => boolean;
}): Promise<SynthesizeAudioPageResult> {
  const { pdfId, pageNumber, pageUid, script, voice, speaker1Voice, speaker2Voice, speed, shouldAbort } = params;
  if (shouldAbort?.()) {
    const err = new Error('CANCELLED');
    (err as Error & { code?: string }).code = 'CANCELLED';
    throw err;
  }
  const absPath = pageAudioPath(pdfId, pageUid);
  const targetPath = absPath.replace(/\.mp3$/i, '.m4a');

  // Always regenerate audio so updated voice/speed settings reliably apply.

  let input = script.trim();
  if (!input) {
    throw new Error(`Page ${pageNumber} has empty script, cannot synthesize`);
  }
  // 送 TTS 前移除所有不該被朗讀的語氣註記：舊版 {{...}} 與 Gemini 的單括號英文
  // 標籤（如 [seriously]／[excitedly]）。見 stripSpokenToneTags 說明。
  input = stripSpokenToneTags(input);
  if (!input) {
    throw new Error(`Page ${pageNumber} has empty script after removing tone markers, cannot synthesize`);
  }

  const runtime = getRuntimeAiSettings();
  const provider = getStickyTtsProvider() ?? runtime.ttsProvider;
  const result = await synthesizeOnePageWithProvider(
    { pdfId, pageNumber, pageUid, script, voice, speaker1Voice, speaker2Voice, speed, input, targetPath },
    runtime,
    provider,
  );
  if (!result.skipped) return result;

  // The primary provider exhausted every retry (see the loop below) — if this account has a
  // secondary TTS provider configured, switch to it for the rest of this run (setStickyTtsProvider)
  // instead of letting every remaining page in the deck fail the same way.
  const secondary = runtime.secondaryTtsProvider;
  if (secondary && secondary !== provider && getStickyTtsProvider() !== secondary) {
    logger.warn(
      { pdfId, pageNumber, from: provider, to: secondary, error: result.error },
      'synthesizeAudio: primary TTS provider failed after exhausting retries — failing over to secondary provider for the rest of this run',
    );
    setStickyTtsProvider(secondary);
    const secondaryResult = await synthesizeOnePageWithProvider(
      { pdfId, pageNumber, pageUid, script, voice, speaker1Voice, speaker2Voice, speed, input, targetPath },
      runtime,
      secondary,
    );
    if (!secondaryResult.skipped) return secondaryResult;
    // Both attempts failed — say so explicitly, so error_message doesn't read identically to
    // "failover never triggered" (see openai.ts's describeFailoverExhausted for the same reasoning).
    return {
      ...secondaryResult,
      error: `主要供應商（${provider}）失敗：${result.error}；已自動切換至次要供應商（${secondary}），但也失敗：${secondaryResult.error}`,
    };
  }
  return result;
}

async function synthesizeOnePageWithProvider(
  params: {
    pdfId: string;
    pageNumber: number;
    pageUid: string;
    script: string;
    voice: string;
    speaker1Voice: string | null;
    speaker2Voice: string | null;
    speed: number;
    input: string;
    targetPath: string;
  },
  runtime: RuntimeAiSettings,
  provider: TtsProvider,
): Promise<SynthesizeAudioPageResult> {
  const { pdfId, pageNumber, pageUid, script, voice, speaker1Voice, speaker2Voice, speed, input, targetPath } = params;
  const accountId = currentAccountId();
  const usingDefaultKey = !accountHasOwnProviderKey(accountId, provider);
  if (usingDefaultKey) {
    const quotaUsage = getAccountWeeklyUsage(accountId);
    if (quotaUsage.remainingUsd <= 0) {
      const nowIso = new Date().toISOString();
      logger.warn({ pdfId, pageNumber, provider }, 'synthesizeAudio: account has no default-source quota remaining, skipping page');
      return {
        pageNumber,
        audioPath: targetPath,
        chars: input.length,
        bytes: 0,
        durationSeconds: null,
        generatedAt: nowIso,
        startedAt: nowIso,
        endedAt: nowIso,
        latencyMs: 0,
        skipped: true,
        error: defaultSourceQuotaExceededMessage(quotaUsage),
      };
    }
  }
  // 'openrouter' talks to OpenRouter's OpenAI-compatible endpoint, so it uses the same SDK
  // client, just pointed at that provider's key/baseURL.
  const client =
    provider === 'openai' ? getOpenAIClient()
    : provider === 'openrouter' ? getOpenAIClient(accountId, 'openrouter')
    : null;

  const rawSegments = splitByToneMarkers(input);
  const segments = rawSegments.map((seg) => {
    // OpenAI 雙人模式：腳本以 "Speaker 1: " / "Speaker 2: " 標籤區分講者，
    // 朗讀前需去除標籤並依講者切換對應聲音；Gemini 則保留標籤交給其
    // multiSpeakerVoiceConfig 自行解析。
    let text = seg.text;
    let segVoice = voice;
    // Persona of the speaker this segment belongs to, so the delivery (not just the
    // wording) follows the configured 人設; null in solo mode, where no persona applies.
    let segPersona: string | null = null;
    // Both OpenAI and OpenRouter are synthesized one segment at a time, so the speaker label
    // is stripped here and the voice switched per segment. (Direct Gemini keeps the labels and
    // resolves them itself through multiSpeakerVoiceConfig.)
    if (provider === 'openai' || provider === 'openrouter') {
      const isOpenRouter = provider === 'openrouter';
      const { speaker, text: stripped } = splitSpeakerPrefix(seg.text);
      text = stripped;
      segVoice = resolveSpeakerVoice({
        speaker,
        deckVoice: voice,
        deckSpeaker1Voice: speaker1Voice,
        deckSpeaker2Voice: speaker2Voice,
        globalSpeaker1Voice: isOpenRouter ? runtime.openrouterTtsSpeaker1Voice : runtime.openaiTtsSpeaker1Voice,
        globalSpeaker2Voice: isOpenRouter ? runtime.openrouterTtsSpeaker2Voice : runtime.openaiTtsSpeaker2Voice,
      });
      // OpenRouter's TTS models are Gemini's, so the voice names are Gemini's too — an
      // OpenAI name left over from a provider switch would be rejected outright.
      if (isOpenRouter) segVoice = normalizeGeminiVoiceName(segVoice);
      const persona1 = isOpenRouter ? runtime.openrouterTtsSpeaker1 : runtime.openaiTtsSpeaker1;
      const persona2 = isOpenRouter ? runtime.openrouterTtsSpeaker2 : runtime.openaiTtsSpeaker2;
      if (speaker === '1') segPersona = persona1?.trim() || null;
      else if (speaker === '2') segPersona = persona2?.trim() || null;
    }
    if (text.length <= TTS_INPUT_MAX_CHARS) return { ...seg, text, voice: segVoice, persona: segPersona };
    logger.warn(
      {
        pdfId,
        pageNumber,
        originalChars: text.length,
        maxChars: TTS_INPUT_MAX_CHARS,
      },
      'synthesizeAudio: segment exceeds TTS input limit, truncating',
    );
    return {
      ...seg,
      text: text.slice(0, TTS_INPUT_MAX_CHARS),
      voice: segVoice,
      persona: segPersona,
    };
  });

  let lastErr: unknown;
  let delayMs = TTS_RETRY_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    const startedAtIso = new Date().toISOString();
    try {
      const buffers: Buffer[] = [];
      for (const seg of segments) {
        logger.debug(
          {
            pdfId,
            pageNumber,
            instruction: seg.instruction,
            text: redactTextForLog(seg.text),
            chars: seg.text.length,
            voice: seg.voice,
            provider,
          },
          'synthesizeAudio: tts segment request',
        );
        let b: Buffer;
        if (provider === 'gemini') {
          // Gemini keeps the "Speaker N:" labels and resolves them itself via
          // multiSpeakerVoiceConfig, so the per-speaker voices are picked here rather than
          // per segment — same precedence: this deck first, global as the fallback.
          b = await synthesizeGeminiSpeech({
            model: runtime.geminiTtsModel,
            text: seg.text,
            voiceName: voice,
            speaker1VoiceName: speaker1Voice?.trim() || runtime.geminiTtsSpeaker1Voice,
            speaker2VoiceName: speaker2Voice?.trim() || runtime.geminiTtsSpeaker2Voice,
          });
        } else if (provider === 'openrouter') {
          // OpenRouter exposes Gemini TTS behind an OpenAI-compatible /audio/speech, but that
          // route only emits raw PCM (24 kHz mono) — wrap it as WAV so ffmpeg can read it.
          // `speed` and `instructions` are OpenAI-only fields there, so neither is sent.
          const response = await client!.audio.speech.create({
            model: runtime.openrouterTtsModel || config.openrouterTtsModel,
            voice: seg.voice,
            input: seg.text,
            response_format: 'pcm',
          });
          b = buildWavPcm16(Buffer.from(await response.arrayBuffer()), OPENROUTER_TTS_SAMPLE_RATE, 1);
        } else {
          const model = runtime.openaiTtsModel || config.openaiTtsModel;
          // Tone + persona steer the delivery; legacy tts-1 models reject the field.
          const instructions = supportsTtsInstructions(model)
            ? buildTtsInstructions({ tone: seg.instruction, persona: seg.persona })
            : undefined;
          const response = await client!.audio.speech.create({
            model,
            voice: seg.voice,
            input: seg.text,
            response_format: config.openaiTtsFormat,
            speed,
            ...(instructions ? { instructions } : {}),
          });
          b = Buffer.from(await response.arrayBuffer());
        }
        if (b.byteLength === 0) {
          throw new Error('OpenAI returned empty audio buffer');
        }
        buffers.push(b);
      }
      // ffmpeg does the joining now (see buildSegmentLoudnessConcatArgs): each segment is
      // levelled on its own before being concatenated, so one host does not end up quieter
      // than the other. Gemini is the exception — it returns raw PCM chunks that have to be
      // stitched into a single WAV here before ffmpeg can read them at all.
      const segmentBuffers: Buffer[] = [];
      const segmentExt = provider === 'openai' ? 'mp3' : 'wav';
      if (provider === 'gemini') {
        const parsed = buffers.map((b) => parseWavPcmChunk(b));
        const first = parsed.find((p) => p !== null) ?? null;
        if (first && first.bitsPerSample === 16) {
          const pcm = Buffer.concat(
            parsed
              .map((p, idx) => {
                if (!p) return buffers[idx] ?? Buffer.alloc(0);
                return p.data;
              })
              .filter((b) => b.length > 0),
          );
          segmentBuffers.push(buildWavPcm16(pcm, first.sampleRate, first.channels));
        } else {
          segmentBuffers.push(Buffer.concat(buffers));
        }
      } else {
        segmentBuffers.push(...buffers);
      }
      const totalBytes = segmentBuffers.reduce((sum, b) => sum + b.byteLength, 0);
      const segmentPaths = segmentBuffers.map((_, idx) => `${targetPath}.tmp.${idx}.${segmentExt}`);
      try {
        await Promise.all(
          segmentBuffers.map((b, idx) => fs.promises.writeFile(segmentPaths[idx]!, b)),
        );
        await runCommand(
          FFMPEG,
          buildSegmentLoudnessConcatArgs(segmentPaths, targetPath),
          AUDIO_TRANSCODE_TIMEOUT_MS,
        );
      } finally {
        await Promise.all(segmentPaths.map((p) => fs.promises.rm(p, { force: true })));
      }

      const latencyMs = Date.now() - startedAt;
      const duration = await readAudioDuration(targetPath);

      if (runtime.subtitleSyncMode === 'whisper') {
        await writeWhisperTimelineIfEnabled({ pdfId, pageNumber, pageUid, script, audioPath: targetPath });
      } else {
        // Audio just got regenerated under 'estimate' mode — remove any timeline left over from
        // a previous generation made while 'whisper' mode was on, so the frontend doesn't keep
        // serving stale alignment for narration that's no longer there.
        await fs.promises.rm(pageTimelinePath(pdfId, pageUid), { force: true });
      }

      logger.info(
        {
          pdfId,
          pageNumber,
          chars: input.length,
          segments: segments.length,
          bytes: totalBytes,
          durationSeconds: duration,
          latencyMs,
          attempt,
          voice,
          speed,
          model: provider === 'gemini' ? runtime.geminiTtsModel : runtime.openaiTtsModel,
        },
        'synthesizeAudio: page done',
      );

      if (usingDefaultKey) {
        const ttsModel = provider === 'gemini' ? runtime.geminiTtsModel : runtime.openaiTtsModel;
        recordDefaultSourceCost(accountId, estimateTtsCostUsd(provider, ttsModel, input.length));
      }

      const endedAtIso = new Date().toISOString();
      return {
        pageNumber,
        audioPath: targetPath,
        chars: input.length,
        bytes: totalBytes,
        durationSeconds: duration,
        generatedAt: endedAtIso,
        startedAt: startedAtIso,
        endedAt: endedAtIso,
        latencyMs,
        skipped: false,
        error: null,
      };
    } catch (err) {
      lastErr = err;
      const latencyMs = Date.now() - startedAt;
      const apiErr = err instanceof APIError ? err : null;
      const retryable = isRetryableTtsError(err);
      const hasMore = attempt < TTS_MAX_ATTEMPTS;
      logger.warn(
        {
          pdfId,
          pageNumber,
          attempt,
          retryable,
          latencyMs,
          status: apiErr?.status,
          code: apiErr?.code,
          error: err instanceof Error ? err.message : String(err),
        },
        'synthesizeAudio: attempt failed',
      );

      if (!retryable || !hasMore) {
        break;
      }

      await sleep(delayMs);
      delayMs = Math.min(Math.floor(delayMs * TTS_RETRY_FACTOR), TTS_RETRY_MAX_DELAY_MS);
    }
  }

  const errorMessage = extractTtsErrorMessage(lastErr);
  logger.error(
    {
      pdfId,
      pageNumber,
      attempts: TTS_MAX_ATTEMPTS,
      error: errorMessage,
    },
    'synthesizeAudio: page failed after max retries, skipping page',
  );

  return {
    pageNumber,
    audioPath: targetPath,
    chars: input.length,
    bytes: 0,
    durationSeconds: null,
    generatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    latencyMs: 0,
    skipped: true,
    error: errorMessage,
  };
}

/**
 * Per-page OpenAI TTS synthesis driven by a small in-process p-queue so we
 * run multiple pages concurrently (bounded by `TTS_CONCURRENCY`).
 *
 * Existing mp3 files are overwritten to ensure latest TTS settings (voice /
 * speed) always take effect.
 *
 * Throws on the first unrecoverable per-page error (after one retry). Callers
 * should mark the PDF as `failed` in that case.
 */
export async function synthesizeAudio(
  opts: SynthesizeAudioOptions,
): Promise<SynthesizeAudioResult> {
  const { pdfId, pageCount, pages, onPage, shouldAbort } = opts;
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid, render_type FROM pages WHERE pdf_id = ?`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string; render_type: string | null }>;
  const pageUidByNumber = new Map(pageUidRows.map((r) => [r.page_number, r.page_uid]));
  // Notebook pages are silent (no script/audio); never synthesize TTS for them even if a
  // caller passes one in. They are recorded as a benign skip (no error) so they don't count
  // as failures or leave a stale audio file. See plan §2.3 "notebook 頁無音訊".
  const notebookPageNumbers = new Set(
    pageUidRows.filter((r) => r.render_type === 'notebook').map((r) => r.page_number),
  );
  const voice = opts.voice?.trim() || config.openaiTtsVoice;
  // Read straight from the deck rather than making every caller (pipeline, regenerate,
  // addPagesFromPrompt, single-page redo) thread these through — the callers that pass
  // `voice` do so because they reconcile it against the run's history, which these have no
  // equivalent of. An explicit opts value still wins, for tests and future callers.
  const deckRow = db
    .prepare(`SELECT tts_speaker1_voice, tts_speaker2_voice FROM pdfs WHERE id = ?`)
    .get(pdfId) as { tts_speaker1_voice: string | null; tts_speaker2_voice: string | null } | undefined;
  const speaker1Voice = opts.speaker1Voice?.trim() || deckRow?.tts_speaker1_voice?.trim() || null;
  const speaker2Voice = opts.speaker2Voice?.trim() || deckRow?.tts_speaker2_voice?.trim() || null;
  const speed = opts.speed ?? config.openaiTtsSpeed;
  const runtime = getRuntimeAiSettings();
  const ttsModel =
    runtime.ttsProvider === 'gemini' ? 'gemini-tts'
    : runtime.ttsProvider === 'openrouter' ? (runtime.openrouterTtsModel || config.openrouterTtsModel)
    : (config.openaiTtsModel ?? 'tts-1');
  const { speaker1Voice: globalSpeaker1Voice, speaker2Voice: globalSpeaker2Voice } =
    globalSpeakerVoicesFor(runtime.ttsProvider, runtime);

  // Record audio generation parameters for each page (best-effort). The voices recorded are
  // the ones actually used, i.e. after this deck's settings take precedence over the global.
  for (const page of pages) {
    savePageGenerationPrompt(
      pdfId,
      page.pageNumber,
      'audio',
      buildAudioPromptRecord({
        provider: runtime.ttsProvider,
        voice,
        speed,
        script: page.script,
        speaker1Voice: resolveSpeakerVoice({
          speaker: '1',
          deckVoice: voice,
          deckSpeaker1Voice: speaker1Voice,
          globalSpeaker1Voice,
        }),
        speaker2Voice: resolveSpeakerVoice({
          speaker: '2',
          deckVoice: voice,
          deckSpeaker2Voice: speaker2Voice,
          globalSpeaker2Voice,
        }),
        speaker1Persona: runtime.openaiTtsSpeaker1,
        speaker2Persona: runtime.openaiTtsSpeaker2,
      }),
      ttsModel,
    );
  }

  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

  const queue = new PQueue({ concurrency: config.ttsConcurrency });
  const results: SynthesizeAudioPageResult[] = new Array(sorted.length);
  let done = 0;
  let cancelled = false;

  await Promise.all(
    sorted.map((page, idx) =>
      queue.add(async () => {
        try {
          const uid = pageUidByNumber.get(page.pageNumber);
          if (!uid) throw new Error(`page_uid not found for page ${page.pageNumber}`);
          if (notebookPageNumbers.has(page.pageNumber)) {
            const ts = new Date().toISOString();
            const res: SynthesizeAudioPageResult = {
              pageNumber: page.pageNumber,
              audioPath: '',
              chars: 0,
              bytes: 0,
              durationSeconds: null,
              generatedAt: ts,
              startedAt: ts,
              endedAt: ts,
              latencyMs: 0,
              skipped: true,
              error: null,
            };
            results[idx] = res;
            done += 1;
            onPage?.(page.pageNumber, done, {
              startedAt: res.startedAt,
              endedAt: res.endedAt,
              skipped: res.skipped,
              audioPath: res.audioPath,
              durationSeconds: res.durationSeconds,
              error: res.error,
            });
            return;
          }
          const res = await synthesizeOnePage({
            pdfId,
            pageNumber: page.pageNumber,
            pageUid: uid,
            script: page.script,
            voice,
            speaker1Voice,
            speaker2Voice,
            speed,
            shouldAbort,
          });
          results[idx] = res;
          done += 1;
          onPage?.(page.pageNumber, done, {
            startedAt: res.startedAt,
            endedAt: res.endedAt,
            skipped: res.skipped,
            audioPath: res.audioPath,
            durationSeconds: res.durationSeconds,
            error: res.error,
          });
        } catch (err) {
          const code = (err as Error & { code?: string }).code;
          if (code === 'CANCELLED') {
            cancelled = true;
          }
        }
      }),
    ),
  );

  if (cancelled) {
    const err = new Error('CANCELLED');
    (err as Error & { code?: string }).code = 'CANCELLED';
    throw err;
  }

  const totalChars = results.reduce((acc, r) => acc + (r.skipped ? 0 : r.chars), 0);
  logger.info(
    {
      pdfId,
      pageCount,
      generated: results.filter((r) => !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      totalChars,
    },
    'synthesizeAudio: all pages complete',
  );

  return { pages: results, totalChars };
}

/**
 * Read persisted script content for every page (falls back to empty string
 * on read failure). Used by the pipeline to feed the TTS step.
 */
export async function readScriptsForTts(
  pdfId: string,
  pageCount: number,
): Promise<Array<{ pageNumber: number; script: string }>> {
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ? AND page_number <= ? ORDER BY page_number ASC`)
    .all(pdfId, pageCount) as Array<{ page_number: number; page_uid: string }>;
  const out: Array<{ pageNumber: number; script: string }> = [];
  for (const { page_number: n, page_uid: uid } of pageUidRows) {
    const p = pageScriptPath(pdfId, uid);
    try {
      const content = await fs.promises.readFile(p, 'utf8');
      out.push({ pageNumber: n, script: content });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        out.push({ pageNumber: n, script: '' });
      } else {
        throw err;
      }
    }
  }
  return out;
}
