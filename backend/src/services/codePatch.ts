/**
 * Search/replace patches for AI-edited source, so an adjustment does not mean regenerating
 * everything.
 *
 * A custom-script animation reaches 19 KB quickly, and asking for "make the circle blue" used to
 * re-emit all of it: slow, charged per output token, and every regeneration is a fresh chance to
 * lose a detail that was already right.
 *
 * The format is the one LLMs are most reliable at — literal old text, literal new text — rather
 * than a unified diff, whose line numbers and hunk headers models routinely get wrong:
 *
 *     <<<<<<< SEARCH
 *     var color = "red";
 *     =======
 *     var color = "blue";
 *     >>>>>>> REPLACE
 *
 * Applying is deliberately strict. Each SEARCH must match exactly once in the current text: a
 * near-miss or an ambiguous match means the model was working from a different idea of the code
 * than we hold, and guessing which occurrence it meant is how a patch silently corrupts a working
 * animation. A failure is reported so the caller can fall back to a full regeneration.
 */

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export interface ParsedPatch {
  blocks: SearchReplaceBlock[];
  /** Count of block-looking fragments that were malformed (e.g. no divider, never closed). */
  malformed: number;
}

const BLOCK_PATTERN = /<{5,9} SEARCH\s*\n([\s\S]*?)\n?={5,9}\s*\n([\s\S]*?)\n?>{5,9} REPLACE/g;
/** Openers found without a complete block after them: the model started one and lost the shape. */
const OPENER_PATTERN = /<{5,9} SEARCH/g;

/**
 * Extracts the search/replace blocks from an LLM reply, tolerating prose or markdown fences around
 * them (a model asked for patches often narrates a little, whatever the prompt says).
 */
export function parseSearchReplaceBlocks(text: string): ParsedPatch {
  const blocks: SearchReplaceBlock[] = [];
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    blocks.push({ search: match[1] ?? '', replace: match[2] ?? '' });
  }
  const openers = [...text.matchAll(OPENER_PATTERN)].length;
  return { blocks, malformed: Math.max(0, openers - blocks.length) };
}

export type ApplyPatchResult =
  | { ok: true; code: string; applied: number }
  | { ok: false; reason: string };

/**
 * Applies every block in order, each to the result of the previous one.
 *
 * All-or-nothing: a half-applied patch leaves source that matches neither what the user had nor
 * what they asked for, and is far harder to recover from than simply regenerating.
 */
export function applySearchReplaceBlocks(code: string, blocks: readonly SearchReplaceBlock[]): ApplyPatchResult {
  if (blocks.length === 0) return { ok: false, reason: 'patch contained no search/replace blocks' };
  let next = code;
  for (const [index, block] of blocks.entries()) {
    if (block.search === '') {
      return { ok: false, reason: `block ${index + 1} has an empty SEARCH section` };
    }
    const first = next.indexOf(block.search);
    if (first === -1) {
      return { ok: false, reason: `block ${index + 1}'s SEARCH text is not present in the current code` };
    }
    if (next.indexOf(block.search, first + 1) !== -1) {
      // Silently patching the first of several identical fragments is how the wrong line changes.
      return { ok: false, reason: `block ${index + 1}'s SEARCH text appears more than once; it must be unique` };
    }
    next = next.slice(0, first) + block.replace + next.slice(first + block.search.length);
  }
  return { ok: true, code: next, applied: blocks.length };
}

/** Parses and applies in one step, reporting malformed fragments as a failure rather than ignoring them. */
export function applyPatchText(code: string, patchText: string): ApplyPatchResult {
  const { blocks, malformed } = parseSearchReplaceBlocks(patchText);
  if (malformed > 0 && blocks.length === 0) {
    return { ok: false, reason: 'patch blocks were malformed' };
  }
  const result = applySearchReplaceBlocks(code, blocks);
  if (result.ok && malformed > 0) {
    // Some edits were understood and others were mangled: applying only the readable half would
    // leave the result looking finished while missing part of what was asked for.
    return { ok: false, reason: `${malformed} patch block(s) were malformed` };
  }
  return result;
}
