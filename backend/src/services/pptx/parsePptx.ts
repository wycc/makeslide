/**
 * Reading a .pptx: which slides it has, what each one says, and how its animation is built up
 * (docs/pptx-animated-import-design.md §1, §5).
 *
 * The animation model we care about is the click sequence: under `p:timing` there is one
 * `p:seq` whose `p:cTn` has `nodeType="mainSeq"`, and each direct child of its `p:childTnLst` is
 * one *click* — everything inside that child happens on that click (further `p:par`s nested in it
 * are "with previous"/"after previous" effects that belong to the same click). Each effect names
 * its target shape through `p:spTgt/@spid`, and `presetClass` says whether the shape enters
 * (`entr`) or leaves (`exit`).
 *
 * From that, step k's picture is "the slide with every shape that only appears at a later step
 * removed, and every shape that has already exited removed too" — which is what
 * buildStepSlideXml produces. The second half matters on any slide with an exit effect: its fully
 * built state is *not* the file as authored, because the file still contains what left the screen.
 */

import { attr, cutRanges, decodeXmlText, findElements, walkXmlElements } from './ooxml';

/**
 * One effect's target: a whole shape, or named paragraphs of one shape's text.
 *
 * PowerPoint builds a bulleted list by animating the *same* shape once per paragraph, narrowing
 * each effect with `p:txEl/p:pRg`. Reading only `@spid` collapses those clicks into one shape that
 * appears at the last of them, which is how a page with six "reveal the next line" clicks rendered
 * six identical frames and then the whole list at once.
 */
export interface PptxAnimationTarget {
  spid: string;
  /** 0-based paragraph indices within the shape's text body; absent = the shape as a whole. */
  paragraphs?: number[];
}

/** One click step of a slide's build. */
export interface PptxAnimationStep {
  /** Shape ids this click makes appear as a whole. */
  enter: string[];
  /** Shape ids this click makes disappear as a whole. */
  exit: string[];
  /** Paragraph-level targets of this click: one shape's lines appearing or leaving on their own. */
  enterParagraphs: PptxAnimationTarget[];
  exitParagraphs: PptxAnimationTarget[];
  /**
   * The words on the shapes this click brings in — "what just appeared", in the slide's own text.
   *
   * This is what makes per-step narration possible without showing a model 136 pictures: the step
   * is described by the content it reveals. Empty for a step that reveals something wordless (an
   * arrow, a box), which is also information: there is nothing new to read out.
   */
  text: string;
}

export interface PptxSlide {
  /** 1-based position in the deck. */
  slideNumber: number;
  /** Part name inside the archive, e.g. `ppt/slides/slide3.xml`. */
  partName: string;
  /** Click steps, in order. Empty for a static slide. */
  steps: PptxAnimationStep[];
  /** Visible text, one entry per paragraph, in reading order. */
  paragraphs: string[];
  /** Speaker notes, when the slide has any. */
  notes: string;
}

export interface PptxDeck {
  slides: PptxSlide[];
  /** Slide size in EMU, straight from presentation.xml (914400 EMU = 1 inch). */
  widthEmu: number;
  heightEmu: number;
}

/** Reads a part out of the archive as text; a missing part is an empty string. */
export type PartReader = (partName: string) => Promise<string | null>;

const DEFAULT_WIDTH_EMU = 9144000; // 10in — PowerPoint's 4:3 default, only used if sldSz is absent
const DEFAULT_HEIGHT_EMU = 6858000;

/**
 * The slides of the deck, in presentation order.
 *
 * Order comes from `p:sldIdLst` in presentation.xml resolved through its rels, not from the file
 * names: `slide12.xml` is not necessarily the twelfth slide, and a deck that has had slides
 * reordered or deleted routinely has neither contiguous nor sorted numbering.
 */
export async function readSlideOrder(readPart: PartReader): Promise<string[]> {
  const presentation = await readPart('ppt/presentation.xml');
  const rels = await readPart('ppt/_rels/presentation.xml.rels');
  if (!presentation || !rels) return [];
  const relTargets = new Map<string, string>();
  for (const el of findElements(rels, 'Relationship')) {
    const id = attr(el.attrs, 'Id');
    const target = attr(el.attrs, 'Target');
    if (id && target) relTargets.set(id, normalizePartName(target));
  }
  const order: string[] = [];
  for (const el of findElements(presentation, 'p:sldId')) {
    const rid = attr(el.attrs, 'r:id');
    const target = rid ? relTargets.get(rid) : null;
    if (target) order.push(target);
  }
  return order;
}

/** `../slides/slide1.xml` (relative to ppt/_rels) → `ppt/slides/slide1.xml`. */
function normalizePartName(target: string): string {
  const cleaned = target.replace(/^\/+/, '');
  if (cleaned.startsWith('ppt/')) return cleaned;
  return `ppt/${cleaned.replace(/^\.\.\//, '')}`;
}

export async function readSlideSize(readPart: PartReader): Promise<{ widthEmu: number; heightEmu: number }> {
  const presentation = (await readPart('ppt/presentation.xml')) ?? '';
  const sldSz = findElements(presentation, 'p:sldSz')[0];
  const cx = sldSz ? Number(attr(sldSz.attrs, 'cx')) : NaN;
  const cy = sldSz ? Number(attr(sldSz.attrs, 'cy')) : NaN;
  return {
    widthEmu: Number.isFinite(cx) && cx > 0 ? cx : DEFAULT_WIDTH_EMU,
    heightEmu: Number.isFinite(cy) && cy > 0 ? cy : DEFAULT_HEIGHT_EMU,
  };
}

/**
 * The click steps of one slide's XML.
 *
 * A step with no targets at all (a transition-only click, or an effect on something we cannot
 * resolve) is kept: it is still a click the presenter makes, and dropping it would silently
 * shift every later step's narration onto the wrong picture.
 */
export function parseAnimationSteps(slideXml: string): PptxAnimationStep[] {
  const mainSeq = findMainSeqChildList(slideXml);
  if (!mainSeq) return [];
  const steps: PptxAnimationStep[] = [];
  // Direct children of the mainSeq child list are the clicks.
  for (const click of childElements(slideXml, mainSeq, 'p:par')) {
    const inner = slideXml.slice(click.start, click.end);
    const enter = new Set<string>();
    const exit = new Set<string>();
    const enterParagraphs: PptxAnimationTarget[] = [];
    const exitParagraphs: PptxAnimationTarget[] = [];
    for (const node of findElements(inner, 'p:cTn')) {
      const presetClass = attr(node.attrs, 'presetClass');
      if (!presetClass) continue;
      const scope = inner.slice(node.start, node.end);
      for (const target of findElements(scope, 'p:spTgt')) {
        const spid = attr(target.attrs, 'spid');
        if (!spid) continue;
        const paragraphs = targetParagraphs(scope.slice(target.start, target.end));
        if (paragraphs) {
          (presetClass === 'exit' ? exitParagraphs : enterParagraphs).push({ spid, paragraphs });
        } else if (presetClass === 'exit') {
          exit.add(spid);
        } else {
          enter.add(spid);
        }
      }
    }
    const shapeTexts = shapeTextById(slideXml);
    const paragraphTexts = shapeParagraphsById(slideXml);
    // What this click puts on screen, in the slide's own words: whole shapes bring all their text,
    // a paragraph-level effect brings exactly the lines it names.
    const text = [
      ...[...enter].map((id) => shapeTexts.get(id) ?? ''),
      ...enterParagraphs.map(({ spid, paragraphs }) =>
        (paragraphs ?? []).map((index) => paragraphTexts.get(spid)?.[index] ?? '').join(' '),
      ),
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ');
    steps.push({ enter: [...enter], exit: [...exit], enterParagraphs, exitParagraphs, text });
  }
  return steps;
}

/**
 * The paragraphs an effect targets, or null when it targets the shape as a whole.
 *
 * `<p:txEl><p:pRg st="2" end="4"/></p:txEl>` means paragraphs 2 through 4 of that shape's text.
 * A `p:txEl` without a range means the shape's text as a whole, which for our purposes is the
 * shape.
 */
function targetParagraphs(targetXml: string): number[] | null {
  const ranges = findElements(targetXml, 'p:pRg');
  if (ranges.length === 0) return null;
  const indices = new Set<number>();
  for (const range of ranges) {
    const from = Number(attr(range.attrs, 'st') ?? NaN);
    const to = Number(attr(range.attrs, 'end') ?? NaN);
    if (!Number.isInteger(from) || from < 0) continue;
    const last = Number.isInteger(to) && to >= from ? to : from;
    // A range is inclusive on both ends, and a "reveal the rest" range can be long; the cap keeps
    // a malformed file from turning into a million-entry set.
    for (let i = from; i <= Math.min(last, from + 500); i++) indices.add(i);
  }
  return indices.size > 0 ? [...indices].sort((a, b) => a - b) : null;
}

/** Each top-level shape's id and its paragraphs' text, in the order the paragraphs appear. */
function shapeParagraphsById(slideXml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const spTree = findElements(slideXml, 'p:spTree')[0];
  if (!spTree) return out;
  const body = slideXml.slice(spTree.start, spTree.end);
  for (const el of findElements(body, 'p:cNvPr')) {
    const id = attr(el.attrs, 'id');
    if (!id || out.has(id)) continue;
    const owner = topLevelShapeAt(body, el.start);
    if (!owner) continue;
    // Not `parseSlideText`: that drops blank paragraphs, and the indices in `p:pRg` count every
    // paragraph including the empty ones used as spacing.
    out.set(id, allParagraphTexts(body.slice(owner.start, owner.end)));
  }
  return out;
}

/**
 * Each top-level shape's id and the text on it (including text inside a group, since a group is
 * animated as a whole and its words appear together).
 */
function shapeTextById(slideXml: string): Map<string, string> {
  const texts = new Map<string, string>();
  const spTree = findElements(slideXml, 'p:spTree')[0];
  if (!spTree) return texts;
  const body = slideXml.slice(spTree.start, spTree.end);
  for (const el of findElements(body, 'p:cNvPr')) {
    const id = attr(el.attrs, 'id');
    if (!id || texts.has(id)) continue;
    const owner = topLevelShapeAt(body, el.start);
    if (!owner) continue;
    texts.set(id, parseSlideText(body.slice(owner.start, owner.end)).join(' '));
  }
  return texts;
}

function topLevelShapeAt(treeBody: string, offset: number): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  walkXmlElements(treeBody, (el) => {
    if (!SHAPE_TAGS.has(el.tag)) return;
    if (el.start > offset || el.end < offset) return;
    if (!best || el.start > best.start) best = { start: el.start, end: el.end };
  });
  return best;
}

/** The `p:childTnLst` of the `mainSeq` timing node, as a byte range. */
function findMainSeqChildList(slideXml: string): { start: number; end: number; depth: number } | null {
  let found: { start: number; end: number; depth: number } | null = null;
  walkXmlElements(slideXml, (el) => {
    if (found || el.tag !== 'p:cTn' || attr(el.attrs, 'nodeType') !== 'mainSeq') return;
    const body = slideXml.slice(el.start, el.end);
    const list = findElements(body, 'p:childTnLst')[0];
    if (!list) return;
    found = { start: el.start + list.start, end: el.start + list.end, depth: el.depth + 1 };
  });
  return found;
}

/** Elements with `tag` that are *direct* children of the given range. */
function childElements(
  xml: string,
  range: { start: number; end: number },
  tag: string,
): Array<{ start: number; end: number }> {
  const body = xml.slice(range.start, range.end);
  const all = findElements(body, tag);
  const out: Array<{ start: number; end: number }> = [];
  for (const el of all) {
    // A direct child is one not contained in another match.
    if (out.some((prev) => el.start > prev.start - range.start && el.end <= prev.end - range.start)) continue;
    const abs = { start: range.start + el.start, end: range.start + el.end };
    if (out.some((prev) => abs.start >= prev.start && abs.end <= prev.end)) continue;
    out.push(abs);
  }
  return out;
}

/** Visible text of a slide, one string per `a:p` paragraph, blank paragraphs dropped. */
export function parseSlideText(slideXml: string): string[] {
  const paragraphs: string[] = [];
  for (const p of topLevelParagraphs(slideXml)) {
    const body = slideXml.slice(p.start, p.end);
    let text = '';
    for (const t of findElements(body, 'a:t')) {
      const open = body.indexOf('>', t.start) + 1;
      const close = body.lastIndexOf('</a:t>', t.end);
      if (open > 0 && close > open) text += decodeXmlText(body.slice(open, close));
    }
    const trimmed = text.trim();
    if (trimmed) paragraphs.push(trimmed);
  }
  return paragraphs;
}

/** Every paragraph's text in order, blank ones kept — `p:pRg` counts them. */
function allParagraphTexts(xml: string): string[] {
  return topLevelParagraphs(xml).map((p) => {
    const body = xml.slice(p.start, p.end);
    let text = '';
    for (const t of findElements(body, 'a:t')) {
      const open = body.indexOf('>', t.start) + 1;
      const close = body.lastIndexOf('</a:t>', t.end);
      if (open > 0 && close > open) text += decodeXmlText(body.slice(open, close));
    }
    return text.trim();
  });
}

function topLevelParagraphs(xml: string): Array<{ start: number; end: number }> {
  const all = findElements(xml, 'a:p');
  const out: Array<{ start: number; end: number }> = [];
  for (const el of all) {
    if (out.some((prev) => el.start >= prev.start && el.end <= prev.end)) continue;
    out.push({ start: el.start, end: el.end });
  }
  return out;
}

/**
 * The slide XML as it looks at step `stepIndex`: shapes that only enter at a later click are
 * removed, and shapes that have already exited by this point are removed too.
 *
 * `stepIndex` 0 is the slide as it appears before the first click. The last valid index is
 * `steps.length`, which is the fully built slide.
 *
 * The timing section is left in place on purpose. LibreOffice ignores effects whose target is
 * gone, and stripping it would mean touching far more bytes than the shapes themselves.
 */
export function buildStepSlideXml(slideXml: string, steps: PptxAnimationStep[], stepIndex: number): string {
  const hideShapes = new Set(hiddenShapeIdsForStep(steps, stepIndex));
  const hideParagraphs = hiddenParagraphsForStep(steps, stepIndex);
  // A shape with none of its paragraphs left is removed outright: an empty text box still draws
  // its own frame and placeholder prompt, which is not what "this line has not appeared yet" looks
  // like.
  const paragraphCounts = shapeParagraphsById(slideXml);
  for (const [spid, hidden] of hideParagraphs) {
    const total = paragraphCounts.get(spid)?.length ?? 0;
    if (total > 0 && hidden.size >= total) {
      hideShapes.add(spid);
      hideParagraphs.delete(spid);
    }
  }
  if (hideShapes.size === 0 && hideParagraphs.size === 0) return slideXml;
  // Shapes first: cutting whole shapes cannot disturb paragraph offsets inside the shapes that
  // remain, because each pass recomputes them from the XML it is handed.
  const withoutShapes = hideShapes.size > 0 ? removeShapes(slideXml, hideShapes) : slideXml;
  return removeParagraphs(withoutShapes, hideParagraphs);
}

/**
 * Shape ids that are *not* on screen at `stepIndex`.
 *
 * Exported because "is this frame the same as the file as authored?" has to be answered with
 * exactly this rule, not a proxy for it: the renderer skips building a variant when the answer is
 * an empty set, and any cheaper guess is how a frame ends up showing shapes the animation had
 * already taken away.
 */
export function hiddenShapeIdsForStep(steps: PptxAnimationStep[], stepIndex: number): Set<string> {
  const events = new Map<string, Array<{ at: number; kind: 'enter' | 'exit' }>>();
  steps.forEach((step, at) => {
    for (const id of step.enter) push(events, id, { at, kind: 'enter' });
    for (const id of step.exit) push(events, id, { at, kind: 'exit' });
  });
  return hiddenKeys(events, stepIndex);
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/**
 * Which of the animated things are off screen at `stepIndex`, from each one's own event list.
 *
 * The rule is "what has happened to it by now": the last click before this step decides, and
 * something never touched yet is off screen only if a later click brings it on. Written this way
 * rather than as "hide whatever a later click enters" because a thing can be entered twice — a
 * list animated paragraph by paragraph aims six clicks at one shape — and the simpler rule kept it
 * hidden until the last of them.
 */
function hiddenKeys(
  events: Map<string, Array<{ at: number; kind: 'enter' | 'exit' }>>,
  stepIndex: number,
): Set<string> {
  const hidden = new Set<string>();
  for (const [key, list] of events) {
    const past = list.filter((e) => e.at < stepIndex);
    if (past.length > 0) {
      if (past[past.length - 1]!.kind === 'exit') hidden.add(key);
      continue;
    }
    // Nothing has happened to it yet: it is waiting to enter, unless its only future is leaving,
    // in which case it is on screen now.
    if (list.some((e) => e.kind === 'enter')) hidden.add(key);
  }
  return hidden;
}

/**
 * Paragraphs that are *not* on screen at `stepIndex`, by shape id.
 *
 * The paragraph twin of `hiddenShapeIdsForStep`, and it follows the same rule: a click that has
 * not happened yet has not put its lines on screen, and one that has taken lines away leaves them
 * off. A shape whose every paragraph ends up hidden is reported through `hiddenShapeIdsForStep`
 * instead, so the empty text box does not sit on the slide with nothing in it.
 */
export function hiddenParagraphsForStep(steps: PptxAnimationStep[], stepIndex: number): Map<string, Set<number>> {
  // Keyed "shape\u0000paragraph" so one shape's lines are judged independently of each other, by
  // exactly the rule whole shapes get.
  const events = new Map<string, Array<{ at: number; kind: 'enter' | 'exit' }>>();
  steps.forEach((step, at) => {
    for (const target of step.enterParagraphs ?? []) {
      for (const index of target.paragraphs ?? []) push(events, `${target.spid}\u0000${index}`, { at, kind: 'enter' });
    }
    for (const target of step.exitParagraphs ?? []) {
      for (const index of target.paragraphs ?? []) push(events, `${target.spid}\u0000${index}`, { at, kind: 'exit' });
    }
  });
  const hide = new Map<string, Set<number>>();
  for (const key of hiddenKeys(events, stepIndex)) {
    const [spid, index] = key.split('\u0000');
    if (!spid || index === undefined) continue;
    const set = hide.get(spid) ?? new Set<number>();
    set.add(Number(index));
    hide.set(spid, set);
  }
  return hide;
}

/** Whether the slide at this step is the file exactly as authored — nothing hidden, at any level. */
export function isFullyBuiltStep(steps: PptxAnimationStep[], stepIndex: number): boolean {
  return hiddenShapeIdsForStep(steps, stepIndex).size === 0 && hiddenParagraphsForStep(steps, stepIndex).size === 0;
}

const SHAPE_TAGS = new Set(['p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp', 'p:cxnSp', 'p:contentPart']);

/**
 * Remove the shapes with these ids from the slide's shape tree.
 *
 * Only shapes directly under `p:spTree` are considered: an animation targeting a shape *inside* a
 * group would otherwise cut a member out of a group whose remaining members are still on screen,
 * which is not what the animation says. (PowerPoint animates the group in that case; the ids we
 * see in practice are group-level.)
 */
/**
 * Remove named paragraphs from named shapes' text.
 *
 * The counterpart of `removeShapes` for a list that builds one line per click: the shape stays on
 * the slide (its box, its title, its bullets so far) and only the lines that have not been reached
 * are cut out. Indices count every paragraph of the shape, blank ones included, because that is
 * what `p:pRg` counts.
 */
export function removeParagraphs(slideXml: string, paragraphsByShape: Map<string, Set<number>>): string {
  if (paragraphsByShape.size === 0) return slideXml;
  const spTree = findElements(slideXml, 'p:spTree')[0];
  if (!spTree) return slideXml;
  const treeBody = slideXml.slice(spTree.start, spTree.end);
  const ranges: Array<{ start: number; end: number }> = [];
  const done = new Set<string>();
  for (const el of findElements(treeBody, 'p:cNvPr')) {
    const id = attr(el.attrs, 'id');
    if (!id || done.has(id)) continue;
    const hide = paragraphsByShape.get(id);
    if (!hide || hide.size === 0) continue;
    const owner = enclosingShape(treeBody, el.start);
    if (!owner) continue;
    done.add(id);
    const shapeBody = treeBody.slice(owner.start, owner.end);
    topLevelParagraphs(shapeBody).forEach((paragraph, index) => {
      if (!hide.has(index)) return;
      ranges.push({
        start: spTree.start + owner.start + paragraph.start,
        end: spTree.start + owner.start + paragraph.end,
      });
    });
  }
  if (ranges.length === 0) return slideXml;
  return cutRanges(slideXml, ranges);
}

export function removeShapes(slideXml: string, shapeIds: Set<string>): string {
  const spTree = findElements(slideXml, 'p:spTree')[0];
  if (!spTree) return slideXml;
  const treeBody = slideXml.slice(spTree.start, spTree.end);
  const ranges: Array<{ start: number; end: number }> = [];
  const claimed: Array<{ start: number; end: number }> = [];
  for (const el of findElements(treeBody, 'p:cNvPr')) {
    // Only the shape's *own* cNvPr counts; a nested one belongs to a group member.
    const id = attr(el.attrs, 'id');
    if (!id || !shapeIds.has(id)) continue;
    const owner = enclosingShape(treeBody, el.start);
    if (!owner) continue;
    if (claimed.some((c) => owner.start >= c.start && owner.end <= c.end)) continue;
    claimed.push(owner);
    ranges.push({ start: spTree.start + owner.start, end: spTree.start + owner.end });
  }
  if (ranges.length === 0) return slideXml;
  return cutRanges(slideXml, ranges);
}

/** The innermost shape element containing `offset`, searching only top-level shapes. */
function enclosingShape(treeBody: string, offset: number): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  walkXmlElements(treeBody, (el) => {
    if (!SHAPE_TAGS.has(el.tag)) return;
    if (el.start > offset || el.end < offset) return;
    if (!best || el.start > best.start) best = { start: el.start, end: el.end };
  });
  return best;
}

/** Parse the whole deck: slide order, per-slide steps, text and notes. */
export async function parsePptxDeck(readPart: PartReader): Promise<PptxDeck> {
  const { widthEmu, heightEmu } = await readSlideSize(readPart);
  const order = await readSlideOrder(readPart);
  const slides: PptxSlide[] = [];
  for (const [index, partName] of order.entries()) {
    const xml = await readPart(partName);
    if (xml === null) continue;
    slides.push({
      slideNumber: index + 1,
      partName,
      steps: parseAnimationSteps(xml),
      paragraphs: parseSlideText(xml),
      notes: await readSlideNotes(readPart, partName),
    });
  }
  return { slides, widthEmu, heightEmu };
}

async function readSlideNotes(readPart: PartReader, slidePart: string): Promise<string> {
  const relsPart = slidePart.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = await readPart(relsPart);
  if (!rels) return '';
  for (const el of findElements(rels, 'Relationship')) {
    const target = attr(el.attrs, 'Target') ?? '';
    if (!target.includes('notesSlide')) continue;
    const notesPart = normalizePartName(target.replace(/^\.\.\//, 'ppt/'));
    const xml = await readPart(notesPart.startsWith('ppt/') ? notesPart : `ppt/${notesPart}`);
    if (!xml) continue;
    // Drop the slide-number placeholder paragraph PowerPoint puts in every notes page.
    return parseSlideText(xml)
      .filter((line) => !/^\d+$/.test(line))
      .join('\n')
      .trim();
  }
  return '';
}
