import { useRef, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import {
  ELEMENT_FONT_FAMILIES,
  ELEMENT_SHAPES,
  joinColor,
  splitColor,
  type ElementShape,
  type ImageElement,
  type PageElement,
  type ShapeElement,
  type TextElement,
} from '../../lib/pageElements';

type TKey = Parameters<ReturnType<typeof useI18n>['t']>[0];

const SHAPE_ICONS: Record<ElementShape, string> = {
  rect: '▭',
  ellipse: '◯',
  triangle: '△',
  diamond: '◇',
  star: '☆',
  line: '―',
  arrow: '→',
};

/**
 * The "元素" tab: toolbar (add text / picture / shape, replace the base image) and the properties
 * panel for whatever is selected on the slide (docs/page-elements.md §5.2). Every change goes
 * through the draft in usePageElements, which autosaves.
 */
export function PageElementsTab() {
  const { t } = useI18n();
  const {
    currentPage,
    isReadOnlyProcessing,
    slideBusy,
    pageElements,
    currentPageSupportsElements,
    selectedElement,
    updateSelectedElement,
    addTextElement,
    addImageElementsFromFiles,
    addShapeElement,
    removeSelectedElement,
    duplicateSelectedElement,
    reorderSelectedElement,
    clearAllElements,
    undoElements,
    redoElements,
    canUndoElements,
    canRedoElements,
    elementsSaveStatus,
    elementsSaveError,
    retryElementsSave,
    handleReplaceImageFile,
    flushElementsSave,
  } = usePlayPageContext();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);

  if (!currentPage) return null;
  if (!currentPageSupportsElements) {
    return <p className="text-xs text-muted">{t('play.elements.unsupported')}</p>;
  }
  const disabled = isReadOnlyProcessing || slideBusy;
  const toolButton = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={toolButton} disabled={disabled} onClick={() => addTextElement()}>
          🅣 {t('play.elements.addText')}
        </button>
        <button type="button" className={toolButton} disabled={disabled} onClick={() => imageInputRef.current?.click()}>
          🖼 {t('play.elements.addImage')}
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void addImageElementsFromFiles(files);
          }}
        />
        <div className="flex items-center gap-1 rounded-md border border-border bg-surface px-1 py-0.5">
          <span className="px-1 text-[11px] text-muted">{t('play.elements.addShape')}</span>
          {ELEMENT_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              disabled={disabled}
              onClick={() => addShapeElement(shape)}
              title={t(`play.elements.shape.${shape}` as TKey)}
              className="rounded px-1.5 py-0.5 text-sm text-text hover:bg-surface-muted disabled:opacity-40"
            >
              {SHAPE_ICONS[shape]}
            </button>
          ))}
        </div>
        <button type="button" className={toolButton} disabled={disabled} onClick={() => baseInputRef.current?.click()} title={t('play.elements.replaceBaseTitle')}>
          🗔 {t('play.elements.replaceBase')}
        </button>
        <input
          ref={baseInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            // The server composes the saved elements onto the new base: make sure the draft is saved first.
            void flushElementsSave().then(() => handleReplaceImageFile(file, currentPage.page_number));
          }}
        />
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          <button type="button" className={toolButton} disabled={!canUndoElements} onClick={undoElements} title="Ctrl+Z">↶ {t('play.elements.undo')}</button>
          <button type="button" className={toolButton} disabled={!canRedoElements} onClick={redoElements} title="Ctrl+Shift+Z">↷ {t('play.elements.redo')}</button>
          <SaveStatus status={elementsSaveStatus} error={elementsSaveError} onRetry={retryElementsSave} />
        </span>
      </div>

      <p className="text-[11px] text-muted">
        {t('play.elements.hint')} · {t('play.elements.count').replace('{count}', String(pageElements.length))}
        {pageElements.length > 0 ? (
          <>
            {' · '}
            <button
              type="button"
              className="underline hover:text-text disabled:opacity-40"
              disabled={disabled}
              onClick={() => {
                if (window.confirm(t('play.elements.clearAllConfirm'))) clearAllElements();
              }}
            >
              {t('play.elements.clearAll')}
            </button>
          </>
        ) : null}
      </p>

      {selectedElement ? (
        <ElementProperties
          el={selectedElement}
          disabled={disabled}
          onChange={updateSelectedElement}
          onRemove={removeSelectedElement}
          onDuplicate={duplicateSelectedElement}
          onReorder={reorderSelectedElement}
        />
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted">{t('play.elements.noSelection')}</p>
      )}
    </div>
  );
}

function SaveStatus({ status, error, onRetry }: { status: 'idle' | 'saving' | 'saved' | 'error'; error: string | null; onRetry: () => void }) {
  const { t } = useI18n();
  if (status === 'saving') return <span>{t('play.elements.saving')}</span>;
  if (status === 'saved') return <span className="text-emerald-600 dark:text-emerald-300">{t('play.elements.saved')}</span>;
  if (status === 'error') {
    return (
      <span className="text-rose-600 dark:text-rose-300">
        {error ?? t('play.elements.saveFailed')}{' '}
        <button type="button" className="underline" onClick={onRetry}>{t('play.elements.retry')}</button>
      </span>
    );
  }
  return null;
}

// ─── Properties panel ───────────────────────────────────────────────────────

interface ElementPropertiesProps {
  el: PageElement;
  disabled: boolean;
  onChange: (patch: Partial<PageElement>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onReorder: (move: 'up' | 'down' | 'top' | 'bottom') => void;
}

function ElementProperties({ el, disabled, onChange, onRemove, onDuplicate, onReorder }: ElementPropertiesProps) {
  const { t } = useI18n();
  const small = 'rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-text disabled:opacity-40';
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-semibold text-text">
          {el.type === 'text' ? '🅣' : el.type === 'image' ? '🖼' : SHAPE_ICONS[el.shape]}{' '}
          {t(`play.elements.type.${el.type}` as TKey)}
        </span>
        <button type="button" className={small} disabled={disabled} onClick={() => onReorder('up')} title={t('play.elements.bringForward')}>▲</button>
        <button type="button" className={small} disabled={disabled} onClick={() => onReorder('down')} title={t('play.elements.sendBackward')}>▼</button>
        <button type="button" className={small} disabled={disabled} onClick={() => onReorder('top')} title={t('play.elements.bringToFront')}>⤒</button>
        <button type="button" className={small} disabled={disabled} onClick={() => onReorder('bottom')} title={t('play.elements.sendToBack')}>⤓</button>
        <button type="button" className={small} disabled={disabled} onClick={onDuplicate} title="Ctrl+D">⧉ {t('play.elements.duplicate')}</button>
        <button type="button" className={`${small} ml-auto border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-200`} disabled={disabled} onClick={onRemove} title="Delete">
          🗑 {t('play.elements.delete')}
        </button>
      </div>

      {el.type === 'text' ? <TextProperties el={el} disabled={disabled} onChange={onChange} /> : null}
      {el.type === 'image' ? <ImageProperties el={el} disabled={disabled} onChange={onChange} /> : null}
      {el.type === 'shape' ? <ShapeProperties el={el} disabled={disabled} onChange={onChange} /> : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumberField label={t('play.elements.positionX')} value={el.x * 100} step={0.5} suffix="%" disabled={disabled} onChange={(v) => onChange({ x: v / 100 })} />
        <NumberField label={t('play.elements.positionY')} value={el.y * 100} step={0.5} suffix="%" disabled={disabled} onChange={(v) => onChange({ y: v / 100 })} />
        <NumberField label={t('play.elements.width')} value={el.w * 100} step={0.5} min={1} suffix="%" disabled={disabled} onChange={(v) => onChange({ w: Math.max(0.01, v / 100) })} />
        <NumberField label={t('play.elements.height')} value={el.h * 100} step={0.5} min={1} suffix="%" disabled={disabled} onChange={(v) => onChange({ h: Math.max(0.01, v / 100) })} />
        <NumberField label={t('play.elements.rotation')} value={el.rotation} step={1} min={-360} max={360} suffix="°" disabled={disabled} onChange={(v) => onChange({ rotation: v })} />
        <RangeField label={t('play.elements.opacity')} value={el.opacity} min={0} max={1} step={0.01} disabled={disabled} onChange={(v) => onChange({ opacity: v })} />
      </div>
    </div>
  );
}

function TextProperties({ el, disabled, onChange }: { el: TextElement; disabled: boolean; onChange: (patch: Partial<TextElement>) => void }) {
  const { t } = useI18n();
  const toggle = (on: boolean) =>
    `rounded-md border px-2 py-0.5 text-xs disabled:opacity-40 ${on ? 'border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-500/50 dark:bg-sky-500/20 dark:text-sky-100' : 'border-border bg-surface text-text'}`;
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[11px] text-muted">{t('play.elements.text')}</span>
        <textarea
          value={el.text}
          disabled={disabled}
          rows={3}
          maxLength={2000}
          onChange={(e) => onChange({ text: e.target.value })}
          className="mt-0.5 w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-muted">
          {t('play.elements.fontFamily')}
          <select value={el.fontFamily} disabled={disabled} onChange={(e) => onChange({ fontFamily: e.target.value as TextElement['fontFamily'] })} className="rounded-md border border-border bg-surface px-1 py-0.5 text-xs text-text">
            {ELEMENT_FONT_FAMILIES.map((f) => (
              <option key={f} value={f}>{t(`play.elements.font.${f}` as TKey)}</option>
            ))}
          </select>
        </label>
        <NumberField label={t('play.elements.fontSize')} value={el.fontSize} step={1} min={8} max={400} suffix="px" disabled={disabled} onChange={(v) => onChange({ fontSize: v })} inline />
        <button type="button" className={toggle(el.bold)} disabled={disabled} onClick={() => onChange({ bold: !el.bold })} title={t('play.elements.bold')}><b>B</b></button>
        <button type="button" className={toggle(el.italic)} disabled={disabled} onClick={() => onChange({ italic: !el.italic })} title={t('play.elements.italic')}><i>I</i></button>
        <button type="button" className={toggle(el.underline)} disabled={disabled} onClick={() => onChange({ underline: !el.underline })} title={t('play.elements.underline')}><u>U</u></button>
        <span className="inline-flex overflow-hidden rounded-md border border-border">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} type="button" disabled={disabled} onClick={() => onChange({ align: a })} title={t(`play.elements.align.${a}` as TKey)} className={`px-2 py-0.5 text-xs ${el.align === a ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-100' : 'bg-surface text-text'}`}>
              {a === 'left' ? '⇤' : a === 'center' ? '☰' : '⇥'}
            </button>
          ))}
        </span>
        <span className="inline-flex overflow-hidden rounded-md border border-border">
          {(['top', 'middle', 'bottom'] as const).map((v) => (
            <button key={v} type="button" disabled={disabled} onClick={() => onChange({ valign: v })} title={t(`play.elements.valign.${v}` as TKey)} className={`px-2 py-0.5 text-xs ${el.valign === v ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-100' : 'bg-surface text-text'}`}>
              {v === 'top' ? '⤒' : v === 'middle' ? '↕' : '⤓'}
            </button>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ColorField label={t('play.elements.color')} value={el.color} disabled={disabled} onChange={(v) => onChange({ color: v ?? '#111111' })} />
        <ColorField label={t('play.elements.background')} value={el.background} nullable disabled={disabled} onChange={(v) => onChange({ background: v })} />
        <NumberField label={t('play.elements.lineHeight')} value={el.lineHeight} step={0.1} min={0.8} max={3} disabled={disabled} onChange={(v) => onChange({ lineHeight: v })} />
        <NumberField label={t('play.elements.padding')} value={el.padding} step={1} min={0} max={200} suffix="px" disabled={disabled} onChange={(v) => onChange({ padding: v })} />
        <NumberField label={t('play.elements.borderRadius')} value={el.borderRadius} step={1} min={0} max={500} suffix="px" disabled={disabled} onChange={(v) => onChange({ borderRadius: v })} />
      </div>
    </div>
  );
}

function ImageProperties({ el, disabled, onChange }: { el: ImageElement; disabled: boolean; onChange: (patch: Partial<ImageElement>) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="block">
        <span className="text-[11px] text-muted">{t('play.elements.fit')}</span>
        <select value={el.fit} disabled={disabled} onChange={(e) => onChange({ fit: e.target.value as ImageElement['fit'] })} className="mt-0.5 w-full rounded-md border border-border bg-surface px-1 py-0.5 text-xs text-text">
          {(['contain', 'cover', 'fill'] as const).map((f) => (
            <option key={f} value={f}>{t(`play.elements.fit.${f}` as TKey)}</option>
          ))}
        </select>
      </label>
      <NumberField label={t('play.elements.borderRadius')} value={el.borderRadius} step={1} min={0} max={500} suffix="px" disabled={disabled} onChange={(v) => onChange({ borderRadius: v })} />
    </div>
  );
}

function ShapeProperties({ el, disabled, onChange }: { el: ShapeElement; disabled: boolean; onChange: (patch: Partial<ShapeElement>) => void }) {
  const { t } = useI18n();
  const isLine = el.shape === 'line' || el.shape === 'arrow';
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label className="block">
        <span className="text-[11px] text-muted">{t('play.elements.shapeKind')}</span>
        <select value={el.shape} disabled={disabled} onChange={(e) => onChange({ shape: e.target.value as ElementShape })} className="mt-0.5 w-full rounded-md border border-border bg-surface px-1 py-0.5 text-xs text-text">
          {ELEMENT_SHAPES.map((s) => (
            <option key={s} value={s}>{SHAPE_ICONS[s]} {t(`play.elements.shape.${s}` as TKey)}</option>
          ))}
        </select>
      </label>
      {!isLine ? <ColorField label={t('play.elements.fill')} value={el.fill} nullable disabled={disabled} onChange={(v) => onChange({ fill: v })} /> : null}
      <ColorField label={t('play.elements.stroke')} value={el.stroke} nullable={!isLine} disabled={disabled} onChange={(v) => onChange({ stroke: v ?? (isLine ? '#111111' : null) })} />
      <NumberField label={t('play.elements.strokeWidth')} value={el.strokeWidth} step={1} min={0} max={200} suffix="px" disabled={disabled} onChange={(v) => onChange({ strokeWidth: v })} />
      {el.shape === 'rect' ? (
        <NumberField label={t('play.elements.borderRadius')} value={el.borderRadius} step={1} min={0} max={500} suffix="px" disabled={disabled} onChange={(v) => onChange({ borderRadius: v })} />
      ) : null}
    </div>
  );
}

// ─── Fields ─────────────────────────────────────────────────────────────────

function NumberField({
  label, value, onChange, step, min, max, suffix, disabled, inline,
}: { label: string; value: number; onChange: (v: number) => void; step: number; min?: number; max?: number; suffix?: string; disabled: boolean; inline?: boolean }) {
  const input = (
    <span className="flex items-center gap-1">
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-full rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-text"
      />
      {suffix ? <span className="text-[10px] text-muted">{suffix}</span> : null}
    </span>
  );
  if (inline) {
    return (
      <label className="flex items-center gap-1 text-[11px] text-muted">
        {label}
        <span className="w-20">{input}</span>
      </label>
    );
  }
  return (
    <label className="block">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="mt-0.5 block">{input}</span>
    </label>
  );
}

function RangeField({ label, value, onChange, min, max, step, disabled }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; disabled: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted">{label} {Math.round(value * 100)}%</span>
      <input type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full" />
    </label>
  );
}

/**
 * Colour = a native picker (exact hex, eyedropper where the browser has one) + the hex typed by
 * hand + an alpha slider. `nullable` adds a "transparent" toggle for fills / backgrounds.
 */
function ColorField({ label, value, onChange, nullable, disabled }: { label: string; value: string | null; onChange: (v: string | null) => void; nullable?: boolean; disabled: boolean }): ReactNode {
  const { t } = useI18n();
  const { hex, alpha } = splitColor(value);
  const isNull = value === null;
  return (
    <div className="block">
      <span className="text-[11px] text-muted">{label}</span>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="color"
          value={hex}
          disabled={disabled}
          onChange={(e) => onChange(joinColor(e.target.value, isNull ? 1 : alpha))}
          className="h-6 w-7 cursor-pointer rounded border border-border bg-surface p-0"
          aria-label={label}
        />
        <input
          type="text"
          value={isNull ? '' : hex}
          placeholder={isNull ? t('play.elements.transparent') : '#rrggbb'}
          disabled={disabled}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(joinColor(v, alpha));
          }}
          className="w-full rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-text"
        />
        {nullable ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(isNull ? '#ffffff' : null)}
            title={t('play.elements.transparent')}
            className={`rounded-md border px-1.5 py-0.5 text-xs ${isNull ? 'border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-500/50 dark:bg-sky-500/20 dark:text-sky-100' : 'border-border bg-surface text-text'} disabled:opacity-40`}
          >
            ∅
          </button>
        ) : null}
      </div>
      {!isNull ? (
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={alpha}
          disabled={disabled}
          onChange={(e) => onChange(joinColor(hex, Number(e.target.value)))}
          title={`${t('play.elements.alpha')} ${Math.round(alpha * 100)}%`}
          className="mt-1 w-full"
        />
      ) : null}
    </div>
  );
}
