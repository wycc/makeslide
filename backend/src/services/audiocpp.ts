import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { AUDIOCPP_BACKENDS, OPENAI_TTS_VOICES, config, isAudioCppBackend, type AudioCppBackend } from '../config';
import { logger } from '../logger';
import { getRuntimeAiSettings, type RuntimeAiSettings } from './aiSettings';
import { readVoiceRefTranscript } from './audiocppVoiceRef';
import { isGeminiVoiceName } from './gemini';

/**
 * Local TTS through audio.cpp (https://github.com/0xShug0/audio.cpp) — a ggml-based C++ engine
 * that runs TTS models on this machine, so a deck can be narrated with no API key, no network
 * and no per-character cost.
 *
 * Two ways to reach it, because audio.cpp ships two front-ends and neither is strictly better:
 *   - 'cli'    — spawn `audiocpp_cli --task tts …` per segment. **This is the mode that can pick
 *                CPU or GPU**, since the backend is a command-line flag (`--backend`). Costs one
 *                process start (and one model load, unless the binary caches) per segment.
 *   - 'server' — POST to a long-running `audiocpp_server`'s OpenAI-compatible `/v1/audio/speech`.
 *                The model stays resident, so it is much faster per page, but the CPU/GPU choice
 *                belongs to that server's `server.json` (`"backend": "cuda"`), not to us.
 *
 * 'auto' picks server when a base URL is configured and CLI otherwise, which is what the two
 * settings already imply — nobody fills in a base URL for a server they don't run.
 */
export type AudioCppMode = 'auto' | 'cli' | 'server';

/** 'auto' is ours — resolved to one of AUDIOCPP_BACKENDS before anything is spawned. */
export type AudioCppBackendSetting = AudioCppBackend | 'auto';
export { AUDIOCPP_BACKENDS, isAudioCppBackend, type AudioCppBackend };

/**
 * Hardware probe for 'auto'. Kept as a pure function over an explicit description of the machine
 * so the decision is unit-testable without an actual GPU (the probing itself is `probeMachine`).
 *
 * Order is deliberate: Apple Silicon always has Metal, so on darwin there is nothing to detect;
 * elsewhere an NVIDIA driver means CUDA, an AMD one means HIP/ROCm, and CPU is the fallback that
 * always works. Vulkan is never auto-selected — it is portable but slower than the vendor
 * backends, so it only makes sense as an explicit choice.
 */
export function detectAudioCppBackend(machine: {
  platform: NodeJS.Platform;
  hasNvidia: boolean;
  hasRocm: boolean;
}): AudioCppBackend {
  if (machine.platform === 'darwin') return 'metal';
  if (machine.hasNvidia) return 'cuda';
  if (machine.hasRocm) return 'hip';
  return 'cpu';
}

/**
 * Whether this machine looks like it has an NVIDIA GPU available to the process.
 *
 * `CUDA_VISIBLE_DEVICES=''`/`-1` is the documented way to hide every GPU from a CUDA process, so
 * it is honoured here: an operator who sets it expects CPU, not a CUDA binary that fails at load.
 */
function hasNvidiaGpu(env: NodeJS.ProcessEnv = process.env): boolean {
  const visible = env.CUDA_VISIBLE_DEVICES?.trim();
  if (visible === '' || visible === '-1') return false;
  if (visible) return true;
  return fs.existsSync('/proc/driver/nvidia/version') || fs.existsSync('/dev/nvidiactl');
}

function hasRocmGpu(): boolean {
  return fs.existsSync('/dev/kfd');
}

/** Cached because it is a filesystem probe consulted once per synthesized segment. */
let detectedBackend: AudioCppBackend | null = null;

export function resolveAudioCppBackend(setting: string): AudioCppBackend {
  const value = setting.trim().toLowerCase();
  if (isAudioCppBackend(value)) return value;
  if (!detectedBackend) {
    detectedBackend = detectAudioCppBackend({
      platform: process.platform,
      hasNvidia: hasNvidiaGpu(),
      hasRocm: hasRocmGpu(),
    });
    logger.info({ backend: detectedBackend }, 'audiocpp: auto-detected compute backend');
  }
  return detectedBackend;
}

/** Test seam: forget the cached probe result. */
export function resetAudioCppBackendCache(): void {
  detectedBackend = null;
}

/**
 * Whether `voice` names a reference audio file (voice cloning, `--voice-ref`) rather than one of
 * the model's built-in voices.
 *
 * audio.cpp has no way to enumerate a family's built-in voice ids over the CLI, so the settings
 * field is free text and this is what tells the two uses apart. A path is the only thing a
 * built-in id can never be — ids are bare tokens like `alba`.
 */
export function looksLikeVoiceReference(voice: string): boolean {
  const v = voice.trim();
  if (!v) return false;
  return v.includes('/') || v.includes('\\') || /\.(wav|mp3|flac|ogg|m4a)$/i.test(v);
}

/**
 * The value stored in a voice field to mean "design the voice from the 人設 text".
 *
 * A sentinel rather than an extra settings field: this is the third answer to the question the
 * voice field already asks (packaged speaker / reference clip / designed), and a parallel boolean
 * would let the two disagree — "voice = vivian AND design = on" has no meaning. The leading space
 * keeps it outside the space of real values: speaker ids are bare tokens and paths never start
 * with one.
 */
export const AUDIOCPP_VOICE_DESIGN = ' voice-design';

/**
 * Where a voice comes from, which for Qwen3-TTS also decides **which model package and which
 * task** the CLI has to be given:
 *
 * | mode        | package     | task   | voice flag     |
 * |-------------|-------------|--------|----------------|
 * | 'speaker'   | CustomVoice | `tts`  | `--speaker`    |
 * | 'reference' | Base        | `tts`  | `--voice-ref`  |
 * | 'design'    | VoiceDesign | `vdes` | none (`--instruct` carries it) |
 *
 * These are three separate downloads, not three modes of one model: CustomVoice has no cloning
 * path, Base has no packaged speakers, and VoiceDesign only answers to `--task vdes`. Asking the
 * wrong one fails every segment, so the mode picks the package instead of the user having to
 * retype a model path whenever they change a voice.
 */
export type AudioCppVoiceMode = 'speaker' | 'reference' | 'design';

export function audioCppVoiceMode(voice: string): AudioCppVoiceMode {
  const v = voice.trim();
  if (v === AUDIOCPP_VOICE_DESIGN.trim() || voice === AUDIOCPP_VOICE_DESIGN) return 'design';
  return looksLikeVoiceReference(v) ? 'reference' : 'speaker';
}

/** The `--task` a mode runs under. Only VoiceDesign leaves the `tts` task. */
export function audioCppTaskFor(mode: AudioCppVoiceMode): 'tts' | 'vdes' {
  return mode === 'design' ? 'vdes' : 'tts';
}

/**
 * The three Qwen3-TTS package directory names, as `model_manager_v2.py` writes them, and the mode
 * each one serves. The `-GGUF` suffix is part of the downloaded name but not of the upstream
 * documentation's, so both spellings have to be recognised.
 */
const QWEN3_PACKAGE_MARKERS: ReadonlyArray<{ mode: AudioCppVoiceMode; marker: string }> = [
  { mode: 'speaker', marker: 'CustomVoice' },
  { mode: 'design', marker: 'VoiceDesign' },
  { mode: 'reference', marker: 'Base' },
];

/**
 * The model path for `mode`, derived from whichever Qwen3 package the settings point at.
 *
 * Deriving beats asking: the three packages live side by side under the same models root and
 * differ by one word in the directory name, so a user who configured any one of them has already
 * told us where the others are. Returns null when the configured path carries no recognisable
 * package name — then the caller keeps the configured path, which is the only honest answer for a
 * family we know nothing about.
 *
 * `Base` is matched last and only as a whole word: `Qwen3-TTS-…-Base-GGUF` contains no other
 * marker, but a careless substring match on "Base" would also fire on a path that merely has the
 * word inside a longer directory name.
 */
export function audioCppModelPathForMode(model: string, mode: AudioCppVoiceMode): string | null {
  const trimmed = model.trim();
  if (!trimmed) return null;
  const dir = path.dirname(trimmed);
  const base = path.basename(trimmed);
  const target = QWEN3_PACKAGE_MARKERS.find((entry) => entry.mode === mode);
  if (!target) return null;
  for (const { marker } of QWEN3_PACKAGE_MARKERS) {
    const pattern = new RegExp(`(^|[-_])${marker}([-_]|$)`);
    const match = pattern.exec(base);
    if (!match) continue;
    if (marker === target.marker) return trimmed;
    const swapped = base.replace(pattern, `${match[1]}${target.marker}${match[2]}`);
    return dir === '.' ? swapped : path.join(dir, swapped);
  }
  return null;
}

/**
 * Which flag carries a built-in voice name — and it is not the same one for every family.
 *
 * PocketTTS takes `--voice-id`, which the CLI routes to the "cached voice" path. Qwen3-TTS's
 * CustomVoice package instead takes `--speaker` (`Vivian`, `Ryan`, …), looked up in a speaker
 * table baked into the model; handing it `--voice-id` means the speaker option is simply never
 * set, and the model throws "unsupported speaker" — per segment, for the whole deck.
 *
 * 'auto' therefore picks by family. `AUDIOCPP_TTS_VOICE_FLAG` overrides it, because this mapping
 * is a property of each family's loader and new families will keep appearing: getting it wrong
 * should cost one env var, not a code change.
 */
export function audioCppVoiceFlag(params: {
  voice: string;
  family: string;
  setting?: string;
}): '--voice-id' | '--speaker' | '--voice-ref' | null {
  const voice = params.voice.trim();
  if (!voice) return null;
  const setting = (params.setting ?? 'auto').trim().toLowerCase();
  if (setting === 'voice-id') return '--voice-id';
  if (setting === 'speaker') return '--speaker';
  if (setting === 'voice-ref') return '--voice-ref';
  // A path is unambiguous whatever the family is: only voice cloning takes one.
  if (looksLikeVoiceReference(voice)) return '--voice-ref';
  return params.family.trim().toLowerCase().startsWith('qwen3_tts') ? '--speaker' : '--voice-id';
}

/**
 * Whether `voice` is a name that belongs to a *hosted* provider (an OpenAI or Gemini prebuilt
 * voice) and therefore means nothing to a local model.
 *
 * The fallback chain a deck walks (services/.../resolveSpeakerVoice) ends at the deck's single
 * voice, which is very often a leftover `alloy`/`Kore` from whichever provider was selected when
 * the deck was made. Passing that to `--voice-id` is not a no-op: the family either errors out or
 * silently picks something arbitrary. Recognising it as foreign lets the chain keep going, and if
 * nothing else is configured, the request simply carries no voice — audio.cpp then uses the
 * family's own default, which is the closest thing to "unset" that exists here.
 */
export function isAudioCppVoiceUsable(voice: string): boolean {
  const v = voice.trim();
  if (!v) return false;
  if (isGeminiVoiceName(v)) return false;
  return !(OPENAI_TTS_VOICES as readonly string[]).includes(v.toLowerCase());
}

/** `voice` if it can be used with audio.cpp, otherwise '' ("let the family choose"). */
export function audioCppVoiceOrEmpty(voice: string | null | undefined): string {
  const v = voice?.trim() ?? '';
  return isAudioCppVoiceUsable(v) ? v : '';
}

export interface AudioCppCliParams {
  binPath: string;
  modelPath: string;
  family: string;
  backend: AudioCppBackend;
  text: string;
  voice: string;
  outPath: string;
  /** GPU ordinal for multi-GPU hosts; omitted from the args when null. */
  device: number | null;
  /** CPU threads (only meaningful for the cpu backend, but harmless elsewhere). */
  threads: number | null;
  /** `key=value` pairs appended as `--load-option`, e.g. `language=spanish`. */
  loadOptions: string[];
  /** Overrides which flag the voice rides on; see audioCppVoiceFlag. */
  voiceFlag?: string;
  /**
   * The speaker's 人設, for families with a real instruction field (`--instruct`). Only sent when
   * `supportsInstruct` says the family reads it — see audioCppSupportsInstruct.
   */
  persona?: string | null;
  /**
   * What the reference clip says, for cloning. Qwen3-TTS Base treats this as required even though
   * upstream lists it as optional; other cloning families accept a clip without one.
   */
  referenceText?: string | null;
  /** The model's own word for the text language (`chinese`, …); '' sends no `--language`. */
  language?: string | null;
}

/**
 * Content language → the word Qwen3-TTS wants on `--language`.
 *
 * Its vocabulary is English words (`chinese`, `english`, …), not BCP-47 tags, so `zh-TW` means
 * nothing to it. `--inspect` on the packages reports: Auto, chinese, english, french, german,
 * italian, japanese, korean, portuguese, russian, spanish.
 */
const QWEN3_LANGUAGE_BY_APP_LANGUAGE: Readonly<Record<string, string>> = {
  'zh-TW': 'chinese',
  'zh-CN': 'chinese',
  zh: 'chinese',
  en: 'english',
};

/**
 * The value for `--language`, or '' to send none.
 *
 * Sending nothing leaves the model to infer the language from the text, and for Chinese input it
 * can land on the wrong variety — a zh-TW deck read in Cantonese is the bug this exists to fix.
 * The deck's own content language is the answer we already have, so it is passed on rather than
 * left to be guessed.
 *
 * Only families whose language vocabulary we actually know are given one. Values differ per
 * family (`chinese` here, `english`/`de`/… elsewhere, and PocketTTS takes it through
 * `--load-option language=…` instead), and a wrong value is a CLI error on every segment — so an
 * unknown family gets nothing unless `AUDIOCPP_TTS_LANGUAGE` says otherwise. That setting is
 * passed through verbatim, which is also how you ask for `Auto` back.
 */
export function audioCppLanguageFor(params: {
  family: string;
  contentLanguage?: string;
  setting?: string;
}): string {
  const setting = (params.setting ?? '').trim();
  if (setting) return setting;
  if (!params.family.trim().toLowerCase().startsWith('qwen3_tts')) return '';
  return QWEN3_LANGUAGE_BY_APP_LANGUAGE[(params.contentLanguage ?? '').trim()] ?? '';
}

/**
 * Whether this family has a native instruction field for style/emotion (`--instruct`).
 *
 * This is the difference between a persona that works and one that gets read aloud. The hosted
 * providers take steering either in a separate `instructions` field (OpenAI) or in the prompt
 * (Gemini); most audio.cpp families have neither and would simply speak whatever you prepend —
 * which is why AUDIOCPP_TTS_PROMPT_STEERING defaults to off. Qwen3-TTS is the exception: its
 * CustomVoice and VoiceDesign packages take the description on `--instruct`, where it steers
 * delivery and is never spoken.
 */
export function audioCppSupportsInstruct(family: string): boolean {
  return family.trim().toLowerCase().startsWith('qwen3_tts');
}

/**
 * The `audiocpp_cli` argument list for one segment. Pure, so the flag shapes are pinned by tests
 * rather than only discovered when a synthesis run fails.
 */
export function buildAudioCppCliArgs(params: AudioCppCliParams): string[] {
  const mode = audioCppVoiceMode(params.voice);
  const args = ['--task', audioCppTaskFor(mode), '--model', params.modelPath];
  if (params.family.trim()) args.push('--family', params.family.trim());
  args.push('--backend', params.backend);
  if (params.device != null) args.push('--device', String(params.device));
  if (params.threads != null) args.push('--threads', String(params.threads));
  const language = params.language?.trim();
  if (language) args.push('--language', language);
  for (const option of params.loadOptions) {
    if (option.trim()) args.push('--load-option', option.trim());
  }
  // Design mode has no voice to send — the instruction below *is* the voice, and the sentinel is
  // ours, so passing it on any flag would be handing the model a speaker id that cannot exist.
  if (mode !== 'design') {
    const voice = params.voice.trim();
    const flag = audioCppVoiceFlag({ voice, family: params.family, setting: params.voiceFlag });
    if (flag) args.push(flag, voice);
    const referenceText = params.referenceText?.trim();
    if (flag === '--voice-ref' && referenceText) args.push('--reference-text', referenceText);
  }
  const persona = params.persona?.trim();
  if (persona && audioCppSupportsInstruct(params.family)) args.push('--instruct', persona);
  // Last, so the (potentially very long) text never sits between two flags in a log line.
  args.push('--text', params.text, '--out', params.outPath);
  return args;
}

/**
 * Body for the server mode's OpenAI-compatible `/v1/audio/speech`.
 *
 * `response_format: 'wav'` rather than the pipeline's usual pcm: audio.cpp families differ in
 * sample rate (24 kHz for PocketTTS, 48 kHz for VoxCPM2), and headerless PCM would leave us
 * guessing which — a wrong guess is not an error, it just plays at the wrong pitch and speed.
 * WAV carries the rate in its header.
 *
 * `speed` is deliberately absent — see `AUDIOCPP_APPLIES_SPEED_IN_FFMPEG` in synthesizeAudio.ts.
 */
export function buildAudioCppSpeechBody(params: {
  model: string;
  text: string;
  voice: string;
  /** The speaker's 人設, forwarded as `instructions` for families that read one. */
  persona?: string | null;
  /** Decides whether the persona is worth sending at all; see audioCppSupportsInstruct. */
  family?: string;
  /** The model's own word for the text language; omitted when empty. */
  language?: string | null;
}): Record<string, unknown> {
  const voice = params.voice.trim();
  const persona = params.persona?.trim();
  return {
    model: params.model,
    input: params.text,
    // Omitted rather than sent empty: an empty string is a voice id the family will not find,
    // whereas an absent field is what makes it fall back to its own default voice.
    ...(voice ? { voice } : {}),
    // Named `instructions` after the OpenAI field this endpoint imitates — the server maps it to
    // the same place the CLI's `--instruct` goes. Only sent for families that have one, so a
    // family that would choke on an unknown field never sees it.
    ...(persona && audioCppSupportsInstruct(params.family ?? '') ? { instructions: persona } : {}),
    // The server reads this off the request body (app/server/runtime.cpp), so the deck's content
    // language reaches a resident server the same way it reaches the CLI — otherwise the same
    // deck would be read in a different language depending on which transport is configured.
    ...(params.language?.trim() ? { language: params.language.trim() } : {}),
    response_format: 'wav',
  };
}

/** `<base>/audio/speech`, tolerating a base URL written with or without a trailing slash. */
export function audioCppSpeechUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/audio/speech`;
}

/**
 * Whether a failed CLI run looks like "this build cannot use that compute backend here" —
 * a missing CUDA driver, no Metal device, a CPU-only build — as opposed to a bad model path or
 * malformed text.
 *
 * Only this class of failure is worth retrying on the CPU: everything else would fail identically
 * there, and silently spending minutes on a second doomed run is worse than reporting the error.
 */
export function isBackendUnavailableError(stderr: string): boolean {
  const s = stderr.toLowerCase();
  if (!s.trim()) return false;
  return /cuda|cublas|nvidia|no such device|out of memory|metal|vulkan|rocm|hip|device not found|no (gpu|device)|unsupported backend|not compiled/.test(s);
}

interface CliResult {
  code: number | null;
  stderr: string;
}

function runAudioCppCli(binPath: string, args: string[], timeoutMs: number): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    // Drained rather than ignored: a full stdout pipe would block the child forever.
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      // Local inference on CPU can take minutes and prints progress here; keeping only the tail
      // bounds memory while still leaving the actual error message (which comes last) intact.
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${binPath} timed out after ${timeoutMs}ms and was killed`));
      } else {
        resolve({ code, stderr: stderr.trim() });
      }
    });
  });
}

export interface AudioCppSettings {
  mode: AudioCppMode;
  baseUrl: string;
  binPath: string;
  model: string;
  family: string;
  backend: AudioCppBackendSetting;
  /** Resolved once here so the CLI and the server body cannot disagree about it. */
  language: string;
}

/** The account's audio.cpp settings, with the operator-level env defaults filled in. */
export function audioCppSettingsOf(runtime: RuntimeAiSettings): AudioCppSettings {
  const mode = runtime.audiocppTtsMode.trim() as AudioCppMode;
  return {
    mode: mode === 'cli' || mode === 'server' ? mode : 'auto',
    baseUrl: runtime.audiocppTtsBaseUrl.trim(),
    binPath: runtime.audiocppTtsBinPath.trim() || config.audiocppTtsBinPath,
    model: runtime.audiocppTtsModel.trim(),
    family: runtime.audiocppTtsFamily.trim(),
    backend: (runtime.audiocppTtsBackend.trim() || 'auto') as AudioCppBackendSetting,
    language: audioCppLanguageFor({
      family: runtime.audiocppTtsFamily.trim(),
      contentLanguage: runtime.contentLanguage,
      setting: config.audiocppTtsLanguage,
    }),
  };
}

/** Which transport a given settings object resolves to. */
export function effectiveAudioCppMode(settings: AudioCppSettings): 'cli' | 'server' {
  if (settings.mode === 'cli' || settings.mode === 'server') return settings.mode;
  return settings.baseUrl ? 'server' : 'cli';
}

/**
 * Raised when audio.cpp is selected but not usable yet (no model configured, server unreachable,
 * binary missing). Carries `status` so the retry loop in synthesizeAudio treats it the way it
 * treats an HTTP error: 424 is a permanent "you have to configure/start something", not a blip
 * worth ten retries.
 */
export class AudioCppUnavailableError extends Error {
  readonly status = 424;
  readonly code = 'AUDIOCPP_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'AudioCppUnavailableError';
  }
}

/**
 * Synthesize one segment locally and return it as WAV bytes.
 *
 * `persona` reaches the model only through a real instruction field (`--instruct`), and only on
 * the families that have one — see audioCppSupportsInstruct. Prefixing it to the text instead is
 * the caller's decision (AUDIOCPP_TTS_PROMPT_STEERING, off by default) because a pure acoustic
 * model reads every character it is handed, instruction included.
 */
export async function synthesizeAudioCppSpeech(params: {
  text: string;
  voice: string;
  /** The speaker's 人設; ignored by families with no instruction field. */
  persona?: string | null;
  /** Overrides the account's settings; used by tests and by the preview route. */
  settings?: AudioCppSettings;
  runtime?: RuntimeAiSettings;
}): Promise<Buffer> {
  // Resolved lazily: an explicit `settings` is the whole configuration, so there is no reason to
  // go and read the account's settings (and no reason for a caller that has none to need one).
  const settings = params.settings ?? audioCppSettingsOf(params.runtime ?? getRuntimeAiSettings());
  const mode = effectiveAudioCppMode(settings);
  if (!settings.model) {
    throw new AudioCppUnavailableError(
      mode === 'server'
        ? 'audio.cpp 尚未設定模型 id（AUDIOCPP_TTS_MODEL）。請到「設定 → AI 設定」填入 audiocpp_server 上的模型 id。'
        : 'audio.cpp 尚未設定模型路徑（AUDIOCPP_TTS_MODEL）。請到「設定 → AI 設定」填入本機模型目錄。',
    );
  }
  // Voice Design is a different `--task`, and the OpenAI-compatible endpoint has no field for one:
  // whatever that server was started with is what you get. Better to say so than to quietly
  // synthesize with the wrong package and hand back a voice nobody asked for.
  if (mode === 'server' && audioCppVoiceMode(params.voice) === 'design') {
    throw new AudioCppUnavailableError(
      'Voice Design 需要 audiocpp_cli 的 --task vdes，而 server 模式的 /v1/audio/speech 沒有這個欄位。' +
        '請把「audio.cpp 執行方式」改為 cli，或改選內建講者／參考音檔。',
    );
  }
  return mode === 'server'
    ? synthesizeViaServer(settings, params.text, params.voice, params.persona)
    : synthesizeViaCli(settings, params.text, params.voice, params.persona);
}

async function synthesizeViaServer(
  settings: AudioCppSettings,
  text: string,
  voice: string,
  persona?: string | null,
): Promise<Buffer> {
  const baseUrl = settings.baseUrl || config.audiocppTtsBaseUrl;
  if (!baseUrl) {
    throw new AudioCppUnavailableError(
      'audio.cpp 選了 server 模式但沒有 base URL。請填入 audiocpp_server 的位址（例如 http://127.0.0.1:8080/v1），或改用 cli 模式。',
    );
  }
  const url = audioCppSpeechUrl(baseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        buildAudioCppSpeechBody({
          model: settings.model,
          text,
          voice,
          persona,
          family: settings.family,
          language: settings.language,
        }),
      ),
      signal: AbortSignal.timeout(config.audiocppTtsTimeoutMs),
    });
  } catch (err) {
    // A local server that isn't running is the single most likely failure here, and the raw
    // "fetch failed" says nothing about which address was tried.
    throw new AudioCppUnavailableError(
      `無法連上 audiocpp_server（${url}）：${err instanceof Error ? err.message : String(err)}。請確認它已啟動。`,
    );
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500);
    const error = new Error(`audiocpp_server ${response.status}: ${detail || response.statusText}`);
    // Mirrors the SDK errors the retry loop already understands (5xx/429 retry, 4xx don't).
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) throw new Error('audiocpp_server returned an empty audio body');
  return audio;
}

async function synthesizeViaCli(
  settings: AudioCppSettings,
  text: string,
  voice: string,
  persona?: string | null,
): Promise<Buffer> {
  const requested = resolveAudioCppBackend(settings.backend);
  const modelPath = resolveModelPathForVoice(settings, voice, persona);
  const referenceText = resolveReferenceText(settings, voice);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-audiocpp-'));
  const outPath = path.join(dir, 'out.wav');
  try {
    let backend = requested;
    let result = await runOnce(settings, text, voice, backend, outPath, persona, modelPath, referenceText);
    // A GPU backend that isn't actually usable (no driver in this container, CPU-only build, GPU
    // busy) fails every segment identically, and the deck would come back with no audio at all.
    // The CPU backend is always compiled in, so one retry there turns a total failure into a
    // slower run — which is the whole point of having both modes.
    if (result.code !== 0 && backend !== 'cpu' && isBackendUnavailableError(result.stderr)) {
      logger.warn(
        { backend, error: result.stderr.slice(-500) },
        'audiocpp: GPU backend failed, retrying this segment on the CPU backend',
      );
      backend = 'cpu';
      result = await runOnce(settings, text, voice, backend, outPath, persona, modelPath, referenceText);
    }
    if (result.code !== 0) {
      throw new Error(
        `audiocpp_cli exited with code ${result.code} (backend=${backend}): ${result.stderr.slice(-500)}`,
      );
    }
    const audio = await fs.promises.readFile(outPath).catch(() => Buffer.alloc(0));
    if (audio.byteLength === 0) {
      throw new Error(`audiocpp_cli produced no audio at ${outPath} (backend=${backend})`);
    }
    return audio;
  } catch (err) {
    // ENOENT from spawn means the binary isn't on PATH — an install/config problem, not a
    // transient one, so say so instead of retrying it ten times.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AudioCppUnavailableError(
        `找不到 audio.cpp 執行檔（${settings.binPath}）。請安裝 audio.cpp 並在設定中填入 audiocpp_cli 的完整路徑。`,
      );
    }
    throw err;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The model directory this segment actually runs against, and a check that it is there.
 *
 * The voice mode picks the package (see audioCppVoiceMode), so choosing 「上傳的參考音檔」 or
 * 「Voice Design」 silently moves the run to a sibling directory the user may never have
 * downloaded. Failing here — with the one command that fixes it — beats failing inside
 * `audiocpp_cli`, whose message for a missing directory says nothing about packages.
 */
function resolveModelPathForVoice(settings: AudioCppSettings, voice: string, persona?: string | null): string {
  const mode = audioCppVoiceMode(voice);
  if (mode === 'design' && !persona?.trim()) {
    throw new AudioCppUnavailableError(
      'Voice Design 需要用文字描述聲音，但這位講者的人設是空的。請到「設定 → AI 設定」填寫人設（例如「沉穩的中年男聲」），或改選內建講者。',
    );
  }
  const derived = audioCppModelPathForMode(settings.model, mode);
  if (!derived || derived === settings.model) return settings.model;
  if (!fs.existsSync(derived)) {
    const pkg = mode === 'design' ? 'qwen3_tts_1_7b_voicedesign_q8_0' : 'qwen3_tts_1_7b_base_q8_0';
    const what = mode === 'design' ? 'Voice Design' : '參考音檔（語音複製）';
    throw new AudioCppUnavailableError(
      `${what} 要用 Qwen3-TTS 的另一個模型套件，但 ${derived} 不存在。請先下載：` +
        `cd .audiocpp && python3 tools/model_manager_v2.py install ${pkg} --models-root ${path.dirname(derived)}`,
    );
  }
  return derived;
}

/**
 * The transcript of the reference clip, read from its sidecar (see audiocppVoiceRef).
 *
 * Qwen3-TTS Base will not clone without one — `audiocpp_cli failed: Qwen3 voice clone ICL mode
 * requires reference text`, which tells a user nothing about where to type it. Other cloning
 * families do not need it, so the demand is limited to the family that actually makes it.
 */
function resolveReferenceText(settings: AudioCppSettings, voice: string): string {
  if (audioCppVoiceMode(voice) !== 'reference') return '';
  const transcript = readVoiceRefTranscript(voice.trim());
  if (!transcript && audioCppSupportsInstruct(settings.family)) {
    throw new AudioCppUnavailableError(
      'Qwen3-TTS 的語音複製需要「參考音檔的逐字稿」（模型要照著它學這段聲音），但這個音檔沒有逐字稿。' +
        '請到「設定 → AI 設定」重新上傳音檔，或補上逐字稿。',
    );
  }
  return transcript;
}

async function runOnce(
  settings: AudioCppSettings,
  text: string,
  voice: string,
  backend: AudioCppBackend,
  outPath: string,
  persona?: string | null,
  modelPath?: string,
  referenceText?: string,
): Promise<CliResult> {
  const args = buildAudioCppCliArgs({
    binPath: settings.binPath,
    modelPath: modelPath ?? settings.model,
    family: settings.family,
    backend,
    text,
    voice,
    outPath,
    device: config.audiocppTtsDevice,
    threads: config.audiocppTtsThreads,
    loadOptions: config.audiocppTtsLoadOptions,
    voiceFlag: config.audiocppTtsVoiceFlag,
    persona,
    referenceText,
    language: settings.language,
  });
  logger.debug({ bin: settings.binPath, backend, chars: text.length }, 'audiocpp: running cli');
  return runAudioCppCli(settings.binPath, args, config.audiocppTtsTimeoutMs);
}
