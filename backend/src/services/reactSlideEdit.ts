import { parse } from '@babel/parser';
import { nanoid } from 'nanoid';
import { isEditableCssProperty, isSafeCssValue } from './reactSlide';

/**
 * Editing a React slide by rewriting its JSX.
 *
 * The page's `.slide.jsx` is the only place an edit lives: what you see is what the code says.
 * The alternative — keeping edits as a separate overlay keyed by element position — meant the code
 * and the slide disagreed, that regenerating silently dropped every tweak, and that "what is
 * actually on this slide" had two answers.
 *
 * Two decisions shape everything here:
 *
 * **Edits are applied as source-range splices, not by regenerating the file from an AST.** A
 * printer would reformat the whole document on every edit, so each change to one word would show
 * up as a rewrite of the entire file — useless in a version history, and hostile to a user who
 * also edits the code by hand. Parsing gives us exact offsets; we replace only those bytes.
 *
 * **Elements are addressed by an id written into the source (`data-ms-id`), not by their position
 * in the rendered tree.** A position path (`0/2/1`) is only meaningful while the code is unchanged
 * and the tree is fully static — one `.map()` or one conditional and the runtime's third child is
 * no longer the source's third child, so an edit lands on the wrong element with nothing to
 * indicate it. An id in the source survives reformatting, reordering and hand edits.
 */

/** How an element is addressed, in the source and in the DOM. */
export const ELEMENT_ID_ATTRIBUTE = 'data-ms-id';

const ID_LENGTH = 8;
/** Element ids are ours, so they are checked before ever reaching a query or the source. */
const ELEMENT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export function isValidElementId(id: string): boolean {
  return ELEMENT_ID_RE.test(id);
}

export type SlideEdit =
  | { kind: 'text'; id: string; text: string }
  /** An empty `value` removes the property, matching the editor's "clear this tweak". */
  | { kind: 'style'; id: string; property: string; value: string }
  | { kind: 'delete'; id: string }
  /**
   * Add a positioned block of text to the slide — what "lift this text off the background image"
   * produces. It goes into the code as an ordinary element rather than into a parallel layer, so
   * from the moment it exists it is edited, deleted and versioned like everything else.
   */
  | { kind: 'insertText'; text: string; style: Record<string, string> };

export interface SlideEditResult {
  code: string;
  /** Edits that could not be applied, with the reason — never silently dropped. */
  skipped: Array<{ edit: SlideEdit; reason: string }>;
}

interface JsxElementInfo {
  /** Byte range of the whole element, including its closing tag. */
  start: number;
  end: number;
  /** Byte offset just after the tag name in the opening tag, where a new attribute can go. */
  attributeInsertAt: number;
  /** Byte range between the opening and closing tags; null for a self-closing element. */
  childrenRange: { start: number; end: number } | null;
  /** True when the element's only content is plain text (the only case text editing is safe in). */
  hasOnlyTextChildren: boolean;
  attributes: Map<string, { valueStart: number; valueEnd: number; raw: string }>;
  id: string | null;
}

/** Minimal shape of the Babel AST nodes we walk; typed locally to avoid a @types dependency. */
interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function parseJsx(code: string): Node {
  return parse(code, {
    sourceType: 'script',
    plugins: ['jsx'],
    errorRecovery: false,
  }) as unknown as Node;
}

/** Walk every node, depth-first, without pulling in @babel/traverse. */
function walk(node: unknown, visit: (node: Node) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const candidate = node as Node;
  if (typeof candidate.type !== 'string') return;
  visit(candidate);
  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'loc' || key === 'range' || key === 'leadingComments' || key === 'trailingComments') continue;
    walk(value, visit);
  }
}

/**
 * Every JSX element in the file, in source order, with what an edit needs to know about it.
 *
 * Exported for tests: the mapping from source to elements is the part that has to be right, and it
 * is far easier to assert on directly than through a rewrite.
 */
export function collectJsxElements(code: string): JsxElementInfo[] {
  const ast = parseJsx(code);
  const elements: JsxElementInfo[] = [];
  walk(ast, (node) => {
    if (node.type !== 'JSXElement') return;
    const opening = node.openingElement as Node;
    const name = opening.name as Node;
    const attributes = new Map<string, { valueStart: number; valueEnd: number; raw: string }>();
    let id: string | null = null;
    for (const attr of (opening.attributes as Node[]) ?? []) {
      if (attr.type !== 'JSXAttribute') continue;
      const attrName = (attr.name as Node | undefined)?.name;
      if (typeof attrName !== 'string') continue;
      const value = attr.value as Node | undefined;
      if (value) {
        attributes.set(attrName, {
          valueStart: value.start,
          valueEnd: value.end,
          raw: code.slice(value.start, value.end),
        });
      }
      if (attrName === ELEMENT_ID_ATTRIBUTE && value?.type === 'StringLiteral') {
        const literal = (value as { value?: unknown }).value;
        if (typeof literal === 'string' && isValidElementId(literal)) id = literal;
      }
    }
    const children = ((node.children as Node[]) ?? []).filter(
      (child) => !(child.type === 'JSXText' && String(code.slice(child.start, child.end)).trim() === ''),
    );
    const closing = node.closingElement as Node | null;
    elements.push({
      start: node.start,
      end: node.end,
      attributeInsertAt: name.end,
      childrenRange: closing ? { start: opening.end, end: closing.start } : null,
      hasOnlyTextChildren: children.length > 0 && children.every((child) => child.type === 'JSXText'),
      attributes,
      id,
    });
  });
  return elements.sort((a, b) => a.start - b.start);
}

interface Splice {
  start: number;
  end: number;
  text: string;
}

/**
 * Apply splices to the source.
 *
 * Right-to-left so each offset still refers to the original text when its splice runs; overlapping
 * ranges are a bug in the caller, so they throw rather than producing quietly mangled code.
 */
function applySplices(code: string, splices: Splice[]): string {
  const ordered = [...splices].sort((a, b) => b.start - a.start);
  let out = code;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const splice of ordered) {
    if (splice.end > previousStart) throw new Error('overlapping edits');
    out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
    previousStart = splice.start;
  }
  return out;
}

/**
 * Give every JSX element a `data-ms-id`, leaving existing ones untouched.
 *
 * Run whenever code is stored — after generation and after a hand edit — so an element can be
 * addressed the moment it exists. Ids are only added, never reassigned: a regenerated page gets
 * new ids for its new elements, and edits made against old ids simply no longer match anything,
 * which is the honest answer once that element is gone.
 */
export function ensureElementIds(code: string): { code: string; changed: boolean } {
  const elements = collectJsxElements(code);
  const used = new Set(elements.map((el) => el.id).filter((id): id is string => id !== null));
  const splices: Splice[] = [];
  for (const element of elements) {
    if (element.id) continue;
    let id = nanoid(ID_LENGTH);
    while (used.has(id) || !isValidElementId(id)) id = nanoid(ID_LENGTH);
    used.add(id);
    splices.push({
      start: element.attributeInsertAt,
      end: element.attributeInsertAt,
      text: ` ${ELEMENT_ID_ATTRIBUTE}="${id}"`,
    });
  }
  if (splices.length === 0) return { code, changed: false };
  return { code: applySplices(code, splices), changed: true };
}

/** Text going back into JSX must not be readable as markup or as an expression. */
function escapeJsxText(text: string): string {
  return text.replace(/[{}<>]/g, (ch) => `{'${ch}'}`);
}

/**
 * A CSS value written into a JS string literal.
 *
 * This is the one place user input becomes *code* rather than data, so the value is whitelisted
 * upstream (isSafeCssValue) and everything that could end the literal or start something else is
 * escaped here as well.
 */
function toJsStringLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ')
    // U+2028/U+2029 are line terminators inside a JS string literal, escaped rather than kept.
    .replace(/[\u2028\u2029]/g, ' ');
  return `'${escaped}'`;
}

/** `background-color` → `backgroundColor`, which is how JSX spells a style property. */
function toCamelCase(property: string): string {
  return property.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
}

function findById(elements: JsxElementInfo[], id: string): JsxElementInfo | null {
  return elements.find((el) => el.id === id) ?? null;
}

/**
 * Rewrite `code` so it says what the edits say.
 *
 * All edits are resolved against one parse of the original source and applied together, so their
 * offsets cannot invalidate each other. An edit that cannot be applied — unknown id, an element
 * whose children are not plain text, a value that is not a safe CSS value — is reported in
 * `skipped` rather than dropped: silently ignoring an edit means the user's change vanishes on
 * save with the UI still showing it.
 */
export function applySlideEdits(code: string, edits: SlideEdit[]): SlideEditResult {
  const elements = collectJsxElements(code);
  const skipped: SlideEditResult['skipped'] = [];
  const splices: Splice[] = [];
  // Deleted elements swallow every edit inside them; their ranges are checked before any splice
  // is added, because an edit landing inside a deleted range is exactly the overlap case.
  const deletedRanges: Array<{ start: number; end: number }> = [];
  for (const edit of edits) {
    if (edit.kind !== 'delete') continue;
    const element = findById(elements, edit.id);
    if (!element) {
      skipped.push({ edit, reason: 'element no longer exists' });
      continue;
    }
    deletedRanges.push({ start: element.start, end: element.end });
    splices.push({ start: element.start, end: element.end, text: '' });
  }
  const insideDeleted = (element: JsxElementInfo): boolean =>
    deletedRanges.some((range) => element.start >= range.start && element.end <= range.end);

  // Insertions go into the root element, whose children range shifts as other edits apply; they
  // are collected first and spliced at a fixed offset, so their text is never inside another
  // splice's range.
  const root = elements[0] ?? null;
  const insertions = edits.filter((edit): edit is Extract<SlideEdit, { kind: 'insertText' }> => edit.kind === 'insertText');
  if (insertions.length > 0) {
    if (!root?.childrenRange) {
      for (const edit of insertions) skipped.push({ edit, reason: 'the slide has no root element to add to' });
    } else {
      const indent = indentOfLastChild(code, root.childrenRange);
      const blocks = insertions
        .map((edit) => `${indent}${textElementJsx(edit.text, edit.style)}`)
        .join('\n');
      splices.push({ start: root.childrenRange.end, end: root.childrenRange.end, text: `${blocks}\n` });
    }
  }

  for (const edit of edits) {
    if (edit.kind === 'delete' || edit.kind === 'insertText') continue;
    const element = findById(elements, edit.id);
    if (!element) {
      skipped.push({ edit, reason: 'element no longer exists' });
      continue;
    }
    // Editing something that is being deleted in the same batch is not an error, just a no-op.
    if (insideDeleted(element)) continue;

    if (edit.kind === 'text') {
      if (!element.childrenRange) {
        skipped.push({ edit, reason: 'element has no children to replace' });
        continue;
      }
      if (!element.hasOnlyTextChildren) {
        skipped.push({ edit, reason: 'element contains markup, not plain text' });
        continue;
      }
      // Replace the text, not the whitespace around it: JSX formats children on their own
      // indented lines, and swallowing that turns a one-word change into a multi-line diff — the
      // thing splicing exists to avoid, and now the version history is what undo relies on.
      const raw = code.slice(element.childrenRange.start, element.childrenRange.end);
      const leading = raw.length - raw.trimStart().length;
      const trailing = raw.length - raw.trimEnd().length;
      splices.push({
        start: element.childrenRange.start + leading,
        end: element.childrenRange.end - trailing,
        text: escapeJsxText(edit.text),
      });
      continue;
    }

    const property = edit.property.trim().toLowerCase();
    if (!isEditableCssProperty(property)) {
      skipped.push({ edit, reason: `${property} is not an editable property` });
      continue;
    }
    const value = edit.value.trim();
    if (value !== '' && !isSafeCssValue(value)) {
      skipped.push({ edit, reason: 'unsafe css value' });
      continue;
    }
    const styleSplice = styleSpliceFor(code, element, toCamelCase(property), value);
    if (!styleSplice) {
      skipped.push({ edit, reason: 'style attribute is not an object literal this editor can edit' });
      continue;
    }
    splices.push(styleSplice);
  }

  return { code: applySplices(code, splices), skipped };
}

/**
 * The splice that sets (or removes) one property inside `style={{ … }}`.
 *
 * Only an inline object literal is editable. `style={styles.card}` is valid React and appears in
 * hand-written code, but rewriting it would mean editing a variable somewhere else — reported as
 * skipped instead, so the user is told rather than left wondering why the change did not stick.
 */
function styleSpliceFor(
  code: string,
  element: JsxElementInfo,
  camelProperty: string,
  value: string,
): Splice | null {
  const style = element.attributes.get('style');
  if (!style) {
    if (value === '') return null;
    return {
      start: element.attributeInsertAt,
      end: element.attributeInsertAt,
      text: ` style={{ ${camelProperty}: ${toJsStringLiteral(value)} }}`,
    };
  }
  const raw = style.raw;
  const objectMatch = /^\{\s*\{([\s\S]*)\}\s*\}$/.exec(raw);
  if (!objectMatch) return null;
  const body = objectMatch[1] ?? '';
  const bodyStart = style.valueStart + raw.indexOf(body, 1);
  const entry = findStyleEntry(body, camelProperty);
  if (entry) {
    if (value === '') {
      // Remove the whole entry, including the comma that separates it from its neighbour.
      return { start: bodyStart + entry.removeStart, end: bodyStart + entry.removeEnd, text: '' };
    }
    return {
      start: bodyStart + entry.valueStart,
      end: bodyStart + entry.valueEnd,
      text: toJsStringLiteral(value),
    };
  }
  if (value === '') return null;
  const trimmedBody = body.trim();
  const insertAt = bodyStart + body.length;
  const prefix = trimmedBody === '' ? ' ' : trimmedBody.endsWith(',') ? ' ' : ', ';
  return { start: insertAt, end: insertAt, text: `${prefix}${camelProperty}: ${toJsStringLiteral(value)} ` };
}

/**
 * Locate one property inside a style object body, by scanning rather than re-parsing.
 *
 * The body is a fragment, not a program, so it cannot be handed back to the parser on its own; the
 * scan tracks nesting and strings so a property name inside `url('…')` or a nested object is not
 * mistaken for the entry being looked for.
 */
function findStyleEntry(
  body: string,
  camelProperty: string,
): { valueStart: number; valueEnd: number; removeStart: number; removeEnd: number } | null {
  let depth = 0;
  let quote: string | null = null;
  let entryStart = 0;
  const entries: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; continue; }
    if (ch === ',' && depth === 0) {
      entries.push({ start: entryStart, end: i });
      entryStart = i + 1;
    }
  }
  entries.push({ start: entryStart, end: body.length });

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const text = body.slice(entry.start, entry.end);
    // The trailing \s* keeps the space after the colon out of the replaced range, so replacing a
    // value does not reformat the entry it sits in.
    const keyMatch = /^(\s*)(['"]?)([A-Za-z0-9_$-]+)\2\s*:\s*/.exec(text);
    if (!keyMatch) continue;
    if (keyMatch[3] !== camelProperty) continue;
    const valueStart = entry.start + keyMatch[0].length;
    // Removing the last entry takes the comma before it; any other takes the one after it.
    const isLast = index === entries.length - 1 || body.slice(entry.end).trim() === '';
    const previous = entries[index - 1];
    const removeStart = isLast && previous ? previous.end : entry.start;
    const removeEnd = isLast ? entry.end : entry.end + 1;
    return { valueStart, valueEnd: entry.end, removeStart, removeEnd };
  }
  return null;
}


/**
 * The indentation to give an inserted child: the same as the element it is being added after, so
 * generated code and hand-written code stay readable side by side.
 */
function indentOfLastChild(code: string, childrenRange: { start: number; end: number }): string {
  const body = code.slice(childrenRange.start, childrenRange.end);
  const lines = body.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^(\s+)\S/.exec(lines[i] ?? '');
    if (match) return match[1] ?? '';
  }
  return '      ';
}

/**
 * One positioned text block, as JSX.
 *
 * Written with the same escaping as every other edit: the text goes through the JSX text escape
 * and each style value through the whitelist and the string-literal escape, because this is source
 * code being generated from user (and model) input.
 */
function textElementJsx(text: string, style: Record<string, string>): string {
  const entries: string[] = [];
  for (const [rawProperty, rawValue] of Object.entries(style)) {
    const property = rawProperty.trim().toLowerCase();
    const value = String(rawValue).trim();
    if (!isEditableCssProperty(property) || !isSafeCssValue(value) || value === '') continue;
    entries.push(`${toCamelCase(property)}: ${toJsStringLiteral(value)}`);
  }
  const styleAttr = entries.length > 0 ? ` style={{ ${entries.join(', ')} }}` : '';
  const id = nanoid(ID_LENGTH);
  return `<div ${ELEMENT_ID_ATTRIBUTE}="${id}"${styleAttr}>${escapeJsxText(text)}</div>`;
}
