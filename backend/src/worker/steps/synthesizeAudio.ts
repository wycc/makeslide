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
import { isGeminiVoiceName, normalizeGeminiVoiceName, parseMimeRateAndChannels, synthesizeGeminiSpeech } from '../../services/gemini';
import { audioCppVoiceOrEmpty, isAudioCppVoiceUsable, synthesizeAudioCppSpeech } from '../../services/audiocpp';
import { getRuntimeAiSettings, accountHasOwnProviderKey, globalSpeakerVoicesFor, speakerPersonasFor, type AppLanguage, type RuntimeAiSettings, type TtsProvider } from '../../services/aiSettings';
import { ttsLanguageInstruction, withTtsPrompt } from '../../services/ttsLanguagePrompt';
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
  /** Content language of the deck; adds the variant/delivery steering line for Chinese. */
  language?: AppLanguage | null;
}): string | undefined {
  const lines: string[] = [];
  // First, so the persona and per-segment tone below refine it rather than compete with it.
  const language = params.language ? ttsLanguageInstruction(params.language) : null;
  if (language) lines.push(language);
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
 *
 * `isVoiceUsable` lets a provider reject a candidate that belongs to a different voice
 * namespace so the chain carries on to the next one. Without it, OpenRouter (Gemini voices)
 * would accept a deck's leftover OpenAI name and only discover it is unusable after the
 * fallback chain is over, where the only remaining move is to map it onto a default — which
 * is how both hosts ended up sharing one voice.
 *
 * An unlabelled segment (`speaker === null`, a page written as one narrator rather than a
 * dialogue) used to stop at the deck's voice and go no further. That is right when the deck has
 * one, but a deck whose voice is empty — or is a leftover `alloy`/`Kore` that this provider
 * cannot use — then produced *no* voice at all, while every dialogue page on the same deck
 * synthesized fine from the speaker settings. Falling through to speaker 1 keeps the single
 * narrator on the voice the user already configured for the deck's main host.
 */
export function resolveSpeakerVoice(params: {
  speaker: '1' | '2' | null;
  deckVoice: string;
  deckSpeaker1Voice?: string | null;
  deckSpeaker2Voice?: string | null;
  globalSpeaker1Voice?: string | null;
  globalSpeaker2Voice?: string | null;
  isVoiceUsable?: (voice: string) => boolean;
}): string {
  const usable = (voice?: string | null): string | null => {
    const trimmed = voice?.trim();
    if (!trimmed) return null;
    if (params.isVoiceUsable && !params.isVoiceUsable(trimmed)) return null;
    return trimmed;
  };
  // The deck's own voice comes first for an unlabelled segment: it is the setting that page is
  // actually about. Only when it is missing or foreign does the speaker chain below apply.
  if (params.speaker === null) {
    return (
      usable(params.deckVoice) ?? usable(params.deckSpeaker1Voice) ?? usable(params.globalSpeaker1Voice) ?? params.deckVoice
    );
  }
  return (
    usable(params.speaker === '1' ? params.deckSpeaker1Voice : params.deckSpeaker2Voice) ??
    usable(params.speaker === '1' ? params.globalSpeaker1Voice : params.globalSpeaker2Voice) ??
    params.deckVoice
  );
}

/**
 * An `atempo` chain for `speed`, or null when there is nothing to do.
 *
 * A single `atempo` only accepts 0.5–2.0; two chained stages cover 0.25–4.0, which is the range
 * the speed setting itself allows (see OPENAI_TTS_SPEED). Exported for unit testing.
 */
export function buildAtempoFilter(speed: number | null | undefined): string | null {
  if (speed == null || !Number.isFinite(speed) || speed <= 0) return null;
  if (Math.abs(speed - 1) < 0.001) return null;
  if (speed >= 0.5 && speed <= 2) return `atempo=${round3(speed)}`;
  if (speed > 2 && speed <= 4) return `atempo=2.0,atempo=${round3(speed / 2)}`;
  if (speed >= 0.25 && speed < 0.5) return `atempo=0.5,atempo=${round3(speed / 0.5)}`;
  return null;
}

function round3(value: number): string {
  return String(Math.round(value * 1000) / 1000);
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
export function buildSegmentLoudnessConcatArgs(
  inputPaths: string[],
  targetPath: string,
  opts: {
    /**
     * Playback speed to bake in with `atempo`, for providers that cannot apply it themselves.
     *
     * audio.cpp is the case this exists for. It does expose `--speaking-rate` on the CLI (and
     * `speed` on the server), but both are honoured only by the families that implement them —
     * a family that ignores it produces audio at the wrong length with no error, and the two
     * transports would disagree. Doing it here is uniform and always works. 1 = untouched, which
     * is what every other provider passes: they apply `speed` in the request itself.
     */
    tempo?: number;
  } = {},
): string[] {
  if (inputPaths.length === 0) throw new Error('buildSegmentLoudnessConcatArgs requires at least one input');
  // atempo alone covers 0.5–2.0; chaining two stages covers the 0.25–4.0 range OPENAI_TTS_SPEED
  // allows. Outside that, the value is not something ffmpeg can express and is dropped.
  const tempoFilter = buildAtempoFilter(opts.tempo);
  const segmentFilter = tempoFilter ? `${LOUDNORM_FILTER},${tempoFilter}` : LOUDNORM_FILTER;
  // `-ar` is not cosmetic: loudnorm works internally at 192 kHz and, in single-pass mode,
  // hands that rate downstream, so without this the aac encoder writes 96 kHz (its ceiling)
  // and the page balloons in size for no gain. Every TTS provider here emits 24 kHz speech.
  const encodeArgs = ['-c:a', 'aac', '-b:a', '128k', '-ar', String(TTS_OUTPUT_SAMPLE_RATE), '-movflags', '+faststart', targetPath];
  if (inputPaths.length === 1) {
    return ['-y', '-i', inputPaths[0]!, '-af', segmentFilter, ...encodeArgs];
  }
  const normalized = inputPaths.map((_, idx) => `[${idx}:a]${segmentFilter}[s${idx}]`).join(';');
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
 * Whether a script actually contains "Speaker 1:" / "Speaker 2:" dialogue.
 *
 * Multi-speaker synthesis is only correct for text that carries those labels — handing it a
 * solo narration would leave the second voice unused and, worse, keep any stray label in the
 * spoken text. Mirrors the same check the direct Gemini path makes before switching modes.
 */
/**
 * Whether a TTS failure was the provider refusing the request body (4xx other than the
 * rate-limit/timeout pair), as opposed to a transient fault.
 *
 * Used to tell "this request shape is unsupported, stop sending it" apart from "try again":
 * the message is what `extractTtsErrorMessage` produced, so the status is at its front.
 */
export function looksLikeRejectedRequest(error: string | null | undefined): boolean {
  if (!error) return false;
  const status = /^(\d{3})\b/.exec(error.trim())?.[1];
  if (!status) return false;
  const code = Number(status);
  return code >= 400 && code < 500 && code !== 408 && code !== 429;
}

/**
 * The model name to log and to file this page's generation under, for whichever provider actually
 * produced it.
 *
 * One place rather than an inline ternary per call site: OpenRouter and audio.cpp both used to be
 * recorded as whatever sat in `openaiTtsModel`, which makes a run's history claim a model that was
 * never contacted. For audio.cpp this is a local path or a server-side id, hence the
 * `audiocpp:` prefix — bare, it would read like a hosted model name.
 */
export function ttsModelLabelFor(
  provider: TtsProvider,
  runtime: Pick<RuntimeAiSettings, 'geminiTtsModel' | 'openaiTtsModel' | 'openrouterTtsModel' | 'audiocppTtsModel' | 'audiocppTtsFamily'>,
): string {
  if (provider === 'gemini') return runtime.geminiTtsModel;
  if (provider === 'openrouter') return runtime.openrouterTtsModel || config.openrouterTtsModel;
  if (provider === 'audiocpp') {
    const family = runtime.audiocppTtsFamily.trim();
    const model = runtime.audiocppTtsModel.trim();
    return `audiocpp:${family || 'auto'}${model ? ` ${model}` : ''}`;
  }
  return runtime.openaiTtsModel || config.openaiTtsModel;
}

export function hasSpeakerDialog(script: string): boolean {
  return /(^|\n)\s*Speaker\s*1\s*[:：]/i.test(script) && /(^|\n)\s*Speaker\s*2\s*[:：]/i.test(script);
}

/**
 * Gemini's `multiSpeakerVoiceConfig`, wrapped in OpenRouter's `provider.options.<slug>`
 * passthrough envelope.
 *
 * OpenRouter documents that envelope (`{provider: {options: {<slug>: {...}}}}`) but publishes
 * examples only for `openai` and `azure` — Google's TTS parameters and slug are undocumented,
 * hence `slug` being configurable. Field names follow Google's REST JSON exactly, which is what
 * services/gemini.ts already sends on the direct path.
 */
export function buildOpenRouterMultiSpeakerOptions(params: {
  slug: string;
  speaker1Voice: string;
  speaker2Voice: string;
}): Record<string, unknown> {
  const speakerConfig = (speaker: string, voiceName: string) => ({
    speaker,
    voiceConfig: { prebuiltVoiceConfig: { voiceName } },
  });
  return {
    options: {
      [params.slug]: {
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              speakerConfig('Speaker 1', params.speaker1Voice),
              speakerConfig('Speaker 2', params.speaker2Voice),
            ],
          },
        },
      },
    },
  };
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

  // OpenRouter's multi-speaker passthrough is an undocumented shape (see config.ts). If it turns
  // out to be rejected, that is a request-validation failure, not a transient one — retrying the
  // same body is pointless. Redo the page on the per-segment path instead, which still gives the
  // two configured voices, so an unsupported passthrough costs prosody and not the whole page.
  if (provider === 'openrouter' && config.openrouterTtsMultiSpeaker && looksLikeRejectedRequest(result.error)) {
    logger.warn(
      { pdfId, pageNumber, error: result.error, slug: config.openrouterTtsProviderSlug },
      'synthesizeAudio: openrouter rejected the multi-speaker passthrough — retrying this page one speaker at a time. Set OPENROUTER_TTS_MULTI_SPEAKER=false to stop trying, or correct OPENROUTER_TTS_PROVIDER_SLUG.',
    );
    const perSegment = await synthesizeOnePageWithProvider(
      { pdfId, pageNumber, pageUid, script, voice, speaker1Voice, speaker2Voice, speed, input, targetPath },
      runtime,
      provider,
      { disableMultiSpeaker: true },
    );
    if (!perSegment.skipped) return perSegment;
  }

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
  opts: { disableMultiSpeaker?: boolean } = {},
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

  // Multi-speaker only applies to OpenRouter on a page that really is a dialogue; a solo page
  // has no second voice to assign and must keep the ordinary single-voice path.
  const openRouterMultiSpeaker =
    provider === 'openrouter'
    && config.openrouterTtsMultiSpeaker
    && !opts.disableMultiSpeaker
    && hasSpeakerDialog(input);
  // Resolved once for the whole page rather than per segment: in multi-speaker mode both voices
  // go into a single request. Same precedence chain the per-segment path uses, so turning the
  // mode off cannot change which voices a deck gets.
  const resolveOpenRouterVoice = (speaker: '1' | '2'): string => {
    const { speaker1Voice: globalS1, speaker2Voice: globalS2 } = globalSpeakerVoicesFor('openrouter', runtime);
    return normalizeGeminiVoiceName(
      resolveSpeakerVoice({
        speaker,
        deckVoice: voice,
        deckSpeaker1Voice: speaker1Voice,
        deckSpeaker2Voice: speaker2Voice,
        globalSpeaker1Voice: globalS1,
        globalSpeaker2Voice: globalS2,
        isVoiceUsable: isGeminiVoiceName,
      }),
    );
  };
  const openRouterSpeaker1Voice = openRouterMultiSpeaker ? resolveOpenRouterVoice('1') : '';
  const openRouterSpeaker2Voice = openRouterMultiSpeaker ? resolveOpenRouterVoice('2') : '';
  // This provider's own personas (OpenRouter inherits Gemini's when its boxes are empty).
  const providerPersonas = speakerPersonasFor(provider, runtime);

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
    let segSpeaker: '1' | '2' | null = null;
    // OpenAI, and OpenRouter when it is not in multi-speaker mode, are synthesized one segment
    // at a time, so the speaker label is stripped here and the voice switched per segment.
    // Gemini — and OpenRouter in multi-speaker mode — keep the labels and let
    // multiSpeakerVoiceConfig resolve them.
    // audio.cpp joins OpenAI on the per-segment path: it synthesizes one voice per call, so the
    // "Speaker N:" label has to come off here (nothing downstream would resolve it, and the
    // acoustic models read it out verbatim) and the voice switched per speaker.
    if (provider === 'openai' || provider === 'audiocpp' || (provider === 'openrouter' && !openRouterMultiSpeaker)) {
      const isOpenRouter = provider === 'openrouter';
      const { speaker, text: stripped } = splitSpeakerPrefix(seg.text);
      text = stripped;
      segSpeaker = speaker;
      const { speaker1Voice: globalS1, speaker2Voice: globalS2 } = globalSpeakerVoicesFor(provider, runtime);
      segVoice = resolveSpeakerVoice({
        speaker,
        deckVoice: voice,
        deckSpeaker1Voice: speaker1Voice,
        deckSpeaker2Voice: speaker2Voice,
        globalSpeaker1Voice: globalS1,
        globalSpeaker2Voice: globalS2,
        // OpenRouter's TTS models are Gemini's, so only Gemini names mean anything there.
        // Skipping the foreign ones keeps the chain moving instead of settling on a name that
        // has to be normalized away. audio.cpp does the same for both hosted namespaces.
        isVoiceUsable:
          isOpenRouter ? isGeminiVoiceName
          : provider === 'audiocpp' ? isAudioCppVoiceUsable
          : undefined,
      });
      // Last resort: the deck's own single voice can still be an OpenAI name (that fallback is
      // not speaker-specific, so rejecting it would leave nothing at all).
      if (isOpenRouter) segVoice = normalizeGeminiVoiceName(segVoice);
      // Same last resort, opposite conclusion: there is no local equivalent of "map it onto a
      // known voice", so a foreign name is dropped and the family's default voice is used.
      if (provider === 'audiocpp') segVoice = audioCppVoiceOrEmpty(segVoice);
      const { speaker1Persona: persona1, speaker2Persona: persona2 } = speakerPersonasFor(provider, runtime);
      if (speaker === '1') segPersona = persona1?.trim() || null;
      else if (speaker === '2') segPersona = persona2?.trim() || null;
    }
    if (text.length <= TTS_INPUT_MAX_CHARS) {
      return { ...seg, text, voice: segVoice, persona: segPersona, speaker: segSpeaker };
    }
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
      speaker: segSpeaker,
    };
  });

  // A dual-host page whose two hosts resolved to one voice is the failure this whole chain
  // exists to avoid, and it is inaudible in the logs otherwise — the run just sounds wrong.
  const speaker1Voices = new Set(segments.filter((s) => s.speaker === '1').map((s) => s.voice));
  const speaker2Voices = new Set(segments.filter((s) => s.speaker === '2').map((s) => s.voice));
  if (speaker1Voices.size > 0 && speaker2Voices.size > 0) {
    const [v1] = [...speaker1Voices];
    const [v2] = [...speaker2Voices];
    if (v1 === v2) {
      logger.warn(
        { pdfId, pageNumber, provider, voice: v1 },
        'synthesizeAudio: dual-host page resolved both speakers to the same voice — set this provider\'s two speaker voices in settings, or give the deck its own pair',
      );
    }
  }

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
            language: runtime.contentLanguage,
            // Gemini has no instructions field, so until now the 人設 shaped only the wording the
            // script step produced, never the delivery. Both go in and it picks by mode.
            speaker1Persona: providerPersonas.speaker1Persona,
            speaker2Persona: providerPersonas.speaker2Persona,
          });
        } else if (provider === 'openrouter') {
          // OpenRouter exposes Gemini TTS behind an OpenAI-compatible /audio/speech, which emits
          // headerless PCM — wrap it as WAV so ffmpeg can read it.
          // `speed` and `instructions` are OpenAI-only fields there, so neither is sent.
          // In multi-speaker mode the labels are still in seg.text and both voices ride in the
          // passthrough, so the model produces one continuous dialogue rather than lines
          // synthesized in isolation. `voice` is still sent because OpenRouter rejects the
          // request without one; Google's config takes precedence over it.
          const multiSpeaker = openRouterMultiSpeaker
            ? buildOpenRouterMultiSpeakerOptions({
                slug: config.openrouterTtsProviderSlug,
                speaker1Voice: openRouterSpeaker1Voice,
                speaker2Voice: openRouterSpeaker2Voice,
              })
            : null;
          const response = await client!.audio.speech.create({
            model: runtime.openrouterTtsModel || config.openrouterTtsModel,
            voice: multiSpeaker ? openRouterSpeaker1Voice : seg.voice,
            // No instructions field on this route (it is OpenAI-only), so language and persona
            // both ride in the prompt itself — same channel and form as the direct Gemini path.
            // Multi-speaker sends one request for both hosts, so it names both personas; the
            // per-segment path has already resolved which host this segment belongs to.
            input: withTtsPrompt(seg.text, {
              language: runtime.contentLanguage,
              persona: multiSpeaker ? null : seg.persona,
              speaker1Persona: multiSpeaker ? providerPersonas.speaker1Persona : null,
              speaker2Persona: multiSpeaker ? providerPersonas.speaker2Persona : null,
            }),
            response_format: 'pcm',
            ...(multiSpeaker ? { provider: multiSpeaker } : {}),
          } as Parameters<NonNullable<typeof client>['audio']['speech']['create']>[0]);
          // Take the rate from the response rather than assuming it. Headerless PCM stamped with
          // the wrong rate does not error — it plays at the wrong pitch and tempo, which is
          // exactly how "the same voice sounds different from Gemini" shows up. The direct Gemini
          // path has always read its rate from the response mime type; this one guessed 24 kHz.
          const contentType = response.headers?.get('content-type') ?? '';
          const { sampleRate, channels } = contentType
            ? parseMimeRateAndChannels(contentType)
            : { sampleRate: OPENROUTER_TTS_SAMPLE_RATE, channels: 1 };
          if (sampleRate !== OPENROUTER_TTS_SAMPLE_RATE) {
            logger.debug(
              { pdfId, pageNumber, contentType, sampleRate, channels },
              'synthesizeAudio: openrouter PCM is not the assumed 24 kHz — using the rate it reported',
            );
          }
          b = buildWavPcm16(Buffer.from(await response.arrayBuffer()), sampleRate, channels);
        } else if (provider === 'audiocpp') {
          // Local engine: WAV in, WAV out, no key and no network. The persona travels on the
          // family's own instruction field where one exists (Qwen3-TTS's `--instruct`); the
          // steering *prompt* stays opt-in (config.audiocppTtsPromptSteering) because most other
          // families are acoustic models with no instruction following — they would read
          // 「請使用台灣用語⋯」 aloud instead of obeying it.
          b = await synthesizeAudioCppSpeech({
            text: config.audiocppTtsPromptSteering
              ? withTtsPrompt(seg.text, { language: runtime.contentLanguage, persona: seg.persona })
              : seg.text,
            voice: seg.voice,
            persona: seg.persona,
            runtime,
          });
        } else {
          const model = runtime.openaiTtsModel || config.openaiTtsModel;
          // Tone + persona steer the delivery; legacy tts-1 models reject the field.
          const instructions = supportsTtsInstructions(model)
            ? buildTtsInstructions({ tone: seg.instruction, persona: seg.persona, language: runtime.contentLanguage })
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
          // audio.cpp takes no usable speed parameter, so the deck's speed is applied here
          // instead of being silently ignored. The other providers already applied it in the
          // request and must not have it applied twice.
          buildSegmentLoudnessConcatArgs(segmentPaths, targetPath, {
            tempo: provider === 'audiocpp' ? speed : undefined,
          }),
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
          model: ttsModelLabelFor(provider, runtime),
        },
        'synthesizeAudio: page done',
      );

      if (usingDefaultKey) {
        recordDefaultSourceCost(
          accountId,
          estimateTtsCostUsd(provider, ttsModelLabelFor(provider, runtime), input.length),
        );
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
    runtime.ttsProvider === 'gemini' ? 'gemini-tts' : ttsModelLabelFor(runtime.ttsProvider, runtime);
  const { speaker1Voice: globalSpeaker1Voice, speaker2Voice: globalSpeaker2Voice } =
    globalSpeakerVoicesFor(runtime.ttsProvider, runtime);
  const recordVoiceUsable =
    runtime.ttsProvider === 'openrouter' ? isGeminiVoiceName
    : runtime.ttsProvider === 'audiocpp' ? isAudioCppVoiceUsable
    : undefined;

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
          isVoiceUsable: recordVoiceUsable,
        }),
        speaker2Voice: resolveSpeakerVoice({
          speaker: '2',
          deckVoice: voice,
          deckSpeaker2Voice: speaker2Voice,
          globalSpeaker2Voice,
          isVoiceUsable: recordVoiceUsable,
        }),
        // The personas recorded have to be the provider's own, or a deck synthesized through
        // Gemini/OpenRouter is filed under whatever happens to sit in OpenAI's boxes.
        ...speakerPersonasFor(runtime.ttsProvider, runtime),
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
