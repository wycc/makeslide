import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

function readPromptFile(relPath: string): string | null {
  try {
    const abs = path.join(config.repoRoot, relPath);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

export function loadPromptTemplate(relPath: string, fallback: string): string {
  const text = readPromptFile(relPath);
  const trimmed = text?.trim();
  if (!trimmed) return fallback;
  return trimmed;
}

export function renderPromptTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    return vars[key] ?? '';
  });
}

