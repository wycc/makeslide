/**
 * Progress of speech synthesis that is running right now, for every path that makes audio: the
 * single-page redo, a step's voice, the deck regenerate and the step narration job all end in
 * `synthesizeOnePage`, which registers here.
 *
 * A TTS call reports nothing while it runs (audio.cpp in particular is one opaque process), so the
 * only honest measure inside one page is time: elapsed against an estimate. The estimate is seconds
 * per character, learned from every synthesis that finishes (per provider, as a moving average)
 * and kept in a small file next to the database so it survives restarts. Where a page is split
 * into segments (tone markers, two hosts) the segment count is reported as well.
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
  /** Expected synthesis time, from the provider's learned rate (a default until it has one). */
  estimated_seconds: number;
  segments_done: number;
  segments_total: number;
}

interface ActiveEntry extends AudioProgressEntry {
  pdfId: string;
  provider: string;
}

/** A first guess, used until the provider has finished one synthesis: roughly 10 chars a second. */
const DEFAULT_SECONDS_PER_CHAR = 0.1;
/** Weight of the newest measurement in the moving average. */
const EMA_WEIGHT = 0.3;

const active = new Map<number, ActiveEntry>();
let nextId = 1;

type RateTable = Record<string, number>;
let rates: RateTable | null = null;

function ratesFile(): string {
  return path.join(path.dirname(config.dbPath), 'tts-throughput.json');
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
  try {
    fs.writeFileSync(ratesFile(), JSON.stringify(table, null, 2), 'utf8');
  } catch (err) {
    logger.debug({ err }, 'audioProgress: could not persist the TTS rate');
  }
}

/** Seconds per character this provider is expected to take. */
export function secondsPerChar(provider: string): number {
  return loadRates()[provider] ?? DEFAULT_SECONDS_PER_CHAR;
}

export function beginAudioProgress(params: {
  pdfId: string;
  page: number;
  step?: number | null;
  chars: number;
  provider: string;
}): number {
  const id = nextId++;
  const chars = Math.max(1, params.chars);
  active.set(id, {
    pdfId: params.pdfId,
    provider: params.provider,
    page: params.page,
    step: params.step ?? null,
    chars,
    started_at: new Date().toISOString(),
    estimated_seconds: Math.max(1, Math.round(chars * secondsPerChar(params.provider))),
    segments_done: 0,
    segments_total: 1,
  });
  return id;
}

export function setAudioSegments(id: number | null | undefined, done: number, total: number): void {
  if (id == null) return;
  const entry = active.get(id);
  if (!entry) return;
  entry.segments_total = Math.max(1, total);
  entry.segments_done = Math.min(Math.max(0, done), entry.segments_total);
}

/** Ends an entry; a successful one teaches the rate its provider is estimated with. */
export function endAudioProgress(id: number | null | undefined, ok: boolean): void {
  if (id == null) return;
  const entry = active.get(id);
  active.delete(id);
  if (!entry || !ok) return;
  const elapsed = (Date.now() - Date.parse(entry.started_at)) / 1000;
  // Very short texts are dominated by fixed start-up cost and would skew the per-character rate.
  if (!(elapsed > 0) || entry.chars < 20) return;
  const measured = elapsed / entry.chars;
  const table = loadRates();
  const previous = table[entry.provider];
  table[entry.provider] = previous == null ? measured : previous * (1 - EMA_WEIGHT) + measured * EMA_WEIGHT;
  saveRates(table);
}

/** What is being synthesized for this deck right now, oldest first. */
export function listAudioProgress(pdfId: string): AudioProgressEntry[] {
  return [...active.values()]
    .filter((e) => e.pdfId === pdfId)
    .map(({ pdfId: _pdfId, provider: _provider, ...entry }) => ({ ...entry }));
}

/** Test hook: forget the learned rates and the active entries. */
export function resetAudioProgressForTest(): void {
  active.clear();
  rates = {};
}
