/**
 * Progress of speech synthesis that is running right now, for every path that makes audio: the
 * single-page redo, a step's voice, the deck regenerate and the step narration job all end in
 * `synthesizeOnePage`, which registers here.
 *
 * A TTS call reports nothing while it runs (audio.cpp in particular is one opaque process), so the
 * only honest measure inside one page is time: elapsed against an estimate.
 *
 * The amount of work is measured in **seconds of speech**, not characters. Per character was the
 * first version and it was wrong for anything but Chinese: an English word is five or six
 * characters for about the same speaking time as one and a half Chinese characters, so an English
 * page was estimated several times too long (reported: 62 s in, four of seven segments done,
 * "about 654 s left"). It also made the learned rate meaningless on a machine that narrates both
 * languages — the average of two different units. `speechSeconds()` counts each script its own way.
 *
 * The rate — synthesis seconds per second of speech — is learned from every synthesis that finishes
 * (per provider, as a moving average) and kept in a small file next to the database so it survives
 * restarts. Where a page is split into segments (tone markers, two hosts) the finished segments
 * are a measurement of this very page on this very machine, so they replace the learned rate as
 * soon as enough of the page is done.
 *
 * In memory only: an entry exists exactly while its synthesis does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';

export interface AudioProgressEntry {
  page: number;
  /** Step index for a step's audio, null for a page's audio. */
  step: number | null;
  chars: number;
  started_at: string;
  /**
   * Expected synthesis time: from the provider's learned rate (a default until it has one), then
   * from this page's own pace once segments have finished.
   */
  estimated_seconds: number;
  segments_done: number;
  segments_total: number;
}

interface ActiveEntry extends AudioProgressEntry {
  pdfId: string;
  provider: string;
  /** Seconds of speech to synthesize (see speechSeconds). */
  units: number;
  /** Estimate from the provider's rate alone, before this page's own pace refined it. */
  priorSeconds: number;
  /** When the current run of segments began, and how much time had already gone by then. */
  paceStartMs: number;
  paceBaseSeconds: number;
}

/**
 * A first guess, used until the provider has finished one synthesis: 0.4 s of work per second of
 * speech (what the old per-character default, 0.1 s a character, meant for Chinese at 4 chars/s).
 */
const DEFAULT_SYNTHESIS_RATE = 0.4;
/** Speaking rates, the same figures the transcript editor's estimate uses (speakingTimeEstimate.ts). */
const CJK_CHARS_PER_SECOND = 4;
const WORDS_PER_SECOND = 140 / 60;
/** Share of the page that must be done before its measured pace fully replaces the learned rate. */
const PACE_TRUST_FRACTION = 0.2;
/** Syntheses shorter than this many seconds of speech are mostly start-up cost and teach nothing. */
const MIN_UNITS_TO_LEARN = 5;

const CJK_RE = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF60]/g;
const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’.-]*/g;

/**
 * How long this text takes to say, in seconds: CJK by the character, everything else by the word,
 * each at its own speaking rate. The backend twin of the frontend's `estimateSpeech()`; the text
 * arrives here with tone markers and speaker labels already removed.
 */
export function speechSeconds(text: string): number {
  if (typeof text !== 'string' || !text) return 0;
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const words = text.replace(CJK_RE, ' ').match(WORD_RE)?.length ?? 0;
  return cjk / CJK_CHARS_PER_SECOND + words / WORDS_PER_SECOND;
}
/** Weight of the newest measurement in the moving average. */
const EMA_WEIGHT = 0.3;

const active = new Map<number, ActiveEntry>();
let nextId = 1;

type RateTable = Record<string, number>;
let rates: RateTable | null = null;
/** Off in tests: the rate file sits next to the real database, which tests must not write to. */
let persist = process.env.MAKESLIDE_TEST !== '1';

// Not `tts-throughput.json`: that file holds seconds per *character*, a different unit. Reading it
// as seconds per second of speech would start every estimate four times too short.
function ratesFile(): string {
  return path.join(path.dirname(config.dbPath), 'tts-synthesis-rate.json');
}

function loadRates(): RateTable {
  if (rates) return rates;
  try {
    const parsed = JSON.parse(fs.readFileSync(ratesFile(), 'utf8')) as unknown;
    rates = {};
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) rates[k] = v;
      }
    }
  } catch {
    rates = {};
  }
  return rates;
}

function saveRates(table: RateTable): void {
  if (!persist) return;
  try {
    fs.writeFileSync(ratesFile(), JSON.stringify(table, null, 2), 'utf8');
  } catch (err) {
    logger.debug({ err }, 'audioProgress: could not persist the TTS rate');
  }
}

/** Seconds of synthesis this provider is expected to need per second of speech. */
export function synthesisRate(provider: string): number {
  return loadRates()[provider] ?? DEFAULT_SYNTHESIS_RATE;
}

export function beginAudioProgress(params: {
  pdfId: string;
  page: number;
  step?: number | null;
  /** The text that will be spoken (tone markers already removed). */
  text: string;
  provider: string;
}): number {
  const id = nextId++;
  // A floor, not zero: a text of nothing but symbols still costs a call.
  const units = Math.max(0.5, speechSeconds(params.text));
  const priorSeconds = Math.max(1, units * synthesisRate(params.provider));
  const now = Date.now();
  active.set(id, {
    pdfId: params.pdfId,
    provider: params.provider,
    page: params.page,
    step: params.step ?? null,
    chars: Math.max(1, [...params.text].length),
    started_at: new Date(now).toISOString(),
    estimated_seconds: Math.round(priorSeconds),
    segments_done: 0,
    segments_total: 1,
    units,
    priorSeconds,
    paceStartMs: now,
    paceBaseSeconds: 0,
  });
  return id;
}

/**
 * Reports how many segments are finished and, through `doneText`, how much speech that was. The
 * second part is what keeps the estimate honest: segments are unequal, so "4 of 7" says little,
 * but "this much speech took this long" is this page's real pace, and the remaining time follows
 * from it instead of from a rate learned on other pages (or never learned at all).
 */
export function setAudioSegments(id: number | null | undefined, done: number, total: number, doneText?: string): void {
  if (id == null) return;
  const entry = active.get(id);
  if (!entry) return;
  entry.segments_total = Math.max(1, total);
  entry.segments_done = Math.min(Math.max(0, done), entry.segments_total);

  const now = Date.now();
  const elapsed = Math.max(0, (now - Date.parse(entry.started_at)) / 1000);
  if (entry.segments_done === 0) {
    // A (re)start of the segment loop: a failed attempt's time is spent, but it says nothing
    // about how fast segments go, so the pace is measured from here.
    entry.paceStartMs = now;
    entry.paceBaseSeconds = elapsed;
    return;
  }
  const unitsDone = Math.min(entry.units, speechSeconds(doneText ?? ''));
  const paceSeconds = (now - entry.paceStartMs) / 1000;
  if (!(unitsDone > 0) || !(paceSeconds > 0)) return;
  const measured = entry.paceBaseSeconds + (paceSeconds / unitsDone) * entry.units;
  // One short opening segment is mostly start-up cost; lean on it in proportion to how much of
  // the page it covers, and fully once a fifth is done.
  const trust = Math.min(1, unitsDone / entry.units / PACE_TRUST_FRACTION);
  entry.estimated_seconds = Math.max(1, Math.round(measured * trust + entry.priorSeconds * (1 - trust)));
}

/** Ends an entry; a successful one teaches the rate its provider is estimated with. */
export function endAudioProgress(id: number | null | undefined, ok: boolean): void {
  if (id == null) return;
  const entry = active.get(id);
  active.delete(id);
  if (!entry || !ok) return;
  const elapsed = (Date.now() - Date.parse(entry.started_at)) / 1000;
  // Very short texts are dominated by fixed start-up cost and would skew the rate.
  if (!(elapsed > 0) || entry.units < MIN_UNITS_TO_LEARN) return;
  const measured = elapsed / entry.units;
  const table = loadRates();
  const previous = table[entry.provider];
  table[entry.provider] = previous == null ? measured : previous * (1 - EMA_WEIGHT) + measured * EMA_WEIGHT;
  saveRates(table);
}

/** What is being synthesized for this deck right now, oldest first. */
export function listAudioProgress(pdfId: string): AudioProgressEntry[] {
  return [...active.values()]
    .filter((e) => e.pdfId === pdfId)
    .map(({ pdfId: _p, provider: _v, units: _u, priorSeconds: _s, paceStartMs: _m, paceBaseSeconds: _b, ...entry }) => ({ ...entry }));
}

/** Test hook: forget the learned rates and the active entries, and stop writing the rate file. */
export function resetAudioProgressForTest(): void {
  active.clear();
  rates = {};
  persist = false;
}
