/**
 * Which audio.cpp TTS models are actually installed on this machine, for the settings menu.
 *
 * Typing a model path was the one part of setting up local TTS that had no right answer on the
 * page: it had to be absolute (the CLI is handed it verbatim), it was a directory for some families
 * and a file for others, and a wrong one only showed up as a failed synthesis. The machine already
 * knows the answer — audio.cpp's own catalog (`model_specs/<family>.json`) lists every package with
 * the files it installs, so a package is installed exactly when those files are there. That also
 * covers packages installed before model_manager started leaving a manifest behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { isQwen3TtsFamily } from './audiocpp';

export interface InstalledAudioCppModel {
  /** `--family` value, e.g. `breeze_tts`. */
  family: string;
  /** The family's own name, e.g. `BreezeTTS 2`. */
  familyName: string;
  /** Catalog package id, e.g. `breeze_tts_2_q8_0`. */
  packageId: string;
  /** Human name of the package, e.g. `BreezeTTS 2 Q8_0 GGUF`. */
  label: string;
  /** What goes in the model setting: absolute, and a directory or a file as the family needs. */
  path: string;
  precision: string;
  /** The catalog's recommended package for the family. */
  isDefault: boolean;
}

interface CatalogPackage {
  id?: unknown;
  display_name?: unknown;
  default?: unknown;
  precision?: unknown;
  target_directory?: unknown;
  files?: unknown;
}

/**
 * The audio.cpp checkout a configured CLI belongs to.
 *
 * The binary normally lives at `<checkout>/build/bin/audiocpp_cli` (or a build subdirectory);
 * a bare `audiocpp_cli` on PATH says nothing, so the checkout this app installs itself is the
 * fallback.
 */
export function audioCppCheckoutFor(binPath: string): string {
  const bin = binPath.trim();
  const match = /^(.*)[/\\]build[/\\](?:[^/\\]+[/\\])*bin[/\\]audiocpp_cli(?:\.exe)?$/.exec(bin);
  if (match?.[1] && path.isAbsolute(match[1])) return match[1];
  return path.join(config.repoRoot, '.audiocpp');
}

/**
 * The model value for a package.
 *
 * Qwen3-TTS is given its package *directory*: the backend switches between its CustomVoice,
 * VoiceDesign and Base packages by rewriting that directory name (audioCppModelPathForMode), and a
 * file name would not carry the marker in the same form. Everything else is given its single model
 * file when it has one — BreezeTTS 2 keeps q8_0 and bf16 side by side in one directory, so the
 * directory alone would not say which.
 */
export function audioCppModelValueFor(family: string, modelsRoot: string, pkg: { target: string; files: string[] }): string {
  if (isQwen3TtsFamily(family)) return path.join(modelsRoot, pkg.target);
  const ggufs = pkg.files.filter((f) => f.toLowerCase().endsWith('.gguf'));
  if (ggufs.length === 1) return path.join(modelsRoot, ggufs[0]!);
  return path.join(modelsRoot, pkg.target);
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Every installed TTS package, grouped as the catalog lists them, one entry per distinct model value. */
export function listInstalledAudioCppModels(checkout: string): InstalledAudioCppModel[] {
  const specsDir = path.join(checkout, 'model_specs');
  const modelsRoot = path.join(checkout, 'models');
  let specFiles: string[];
  try {
    specFiles = fs.readdirSync(specsDir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const out: InstalledAudioCppModel[] = [];
  const seen = new Set<string>();
  for (const file of specFiles) {
    const spec = readJson(path.join(specsDir, file));
    if (!spec || spec.category !== 'tts') continue;
    const family = typeof spec.family === 'string' ? spec.family : '';
    if (!family) continue;
    const familyName = typeof spec.display_name === 'string' ? spec.display_name : family;
    const packages = Array.isArray(spec.packages) ? (spec.packages as CatalogPackage[]) : [];
    for (const pkg of packages) {
      const id = typeof pkg.id === 'string' ? pkg.id : '';
      const target = typeof pkg.target_directory === 'string' ? pkg.target_directory : '';
      const files = Array.isArray(pkg.files) ? pkg.files.filter((f): f is string => typeof f === 'string') : [];
      if (!id || !target || files.length === 0) continue;
      // Installed means every file the catalog says the package brings is on disk. A directory
      // holding a *different* precision of the same model does not count as this package.
      if (!files.every((f) => fs.existsSync(path.join(modelsRoot, f)))) continue;
      const value = audioCppModelValueFor(family, modelsRoot, { target, files });
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({
        family,
        familyName,
        packageId: id,
        label: typeof pkg.display_name === 'string' ? pkg.display_name : id,
        path: value,
        precision: typeof pkg.precision === 'string' ? pkg.precision : '',
        isDefault: pkg.default === true,
      });
    }
  }
  return out;
}
