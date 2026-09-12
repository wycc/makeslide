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
 * removed" — which is what buildStepSlideXml produces.
 */

import { attr, cutRanges, decodeXmlText, findElements, walkXmlElements } from './ooxml';

/** One click step of a slide's build. */
export interface PptxAnimationStep {
  /** Shape ids this click makes appear. */
  enter: string[];
  /** Shape ids this click makes disappear. */
  exit: string[];
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
    for (const node of findElements(inner, 'p:cTn')) {
      const presetClass = attr(node.attrs, 'presetClass');
      if (!presetClass) continue;
      const scope = inner.slice(node.start, node.end);
      for (const target of findElements(scope, 'p:spTgt')) {
        const spid = attr(target.attrs, 'spid');
        if (!spid) continue;
        if (presetClass === 'exit') exit.add(spid);
        else enter.add(spid);
      }
    }
    const shapeTexts = shapeTextById(slideXml);
    const text = [...enter]
      .map((id) => shapeTexts.get(id) ?? '')
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ');
    steps.push({ enter: [...enter], exit: [...exit], text });
  }
  return steps;
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
  const hide = new Set<string>();
  steps.forEach((step, i) => {
    if (i >= stepIndex) {
      // Not yet clicked: anything this click brings in is not on screen.
      for (const id of step.enter) hide.add(id);
    } else {
      // Already clicked: what it took away is gone, what it brought in stays.
      for (const id of step.exit) hide.add(id);
      for (const id of step.enter) hide.delete(id);
    }
  });
  if (hide.size === 0) return slideXml;
  return removeShapes(slideXml, hide);
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
