import { useState } from 'react';
import {
  CSS_PROPERTY_CHOICES,
  EDITABLE_CSS_PROPERTIES,
  QUICK_CSS_PROPERTIES,
  cssColorToHex,
  isSafeCssValue,
  parseLengthValue,
  withStyleOverride,
  withTextOverride,
  type EditableCssProperty,
  type ReactSlideOverride,
  type SlideElementSelection,
} from '../../lib/reactSlide';
import { useI18n } from '../../i18n';

interface ReactSlideElementEditorProps {
  selection: SlideElementSelection;
  /** The element's current override, if it has one. */
  override: ReactSlideOverride | undefined;
  disabled?: boolean;
  /** Called with the new override, or null when the element has no tweaks left. */
  onChange: (next: ReactSlideOverride | null) => void;
}

/**
 * Editor for one selected element: its text and its CSS.
 *
 * Every control shows the element's *effective* value — the override when there is one, otherwise
 * the computed style the sandbox reported — so the panel reads as "what this element looks like"
 * rather than "what you have overridden so far". Only touched properties are written back, which
 * is what keeps a regenerated page from inheriting a wall of no-op overrides.
 *
 * Shared by the docked editor in the React tab and the floating inspector, so the two can never
 * drift apart.
 */
export function ReactSlideElementEditor({
  selection,
  override,
  disabled = false,
  onChange,
}: ReactSlideElementEditorProps) {
  const { t } = useI18n();
  const [advancedProperty, setAdvancedProperty] = useState<EditableCssProperty>('letter-spacing');
  const [advancedValue, setAdvancedValue] = useState('');

  const styles = override?.styles ?? {};
  /** Override first, then what the element actually renders as. */
  const effective = (property: string): string => styles[property] ?? selection.computed[property] ?? '';
  const isOverridden = (property: string): boolean => styles[property] !== undefined;

  function setStyle(property: string, value: string): void {
    onChange(withStyleOverride(override, property, value));
  }

  function renderControl(property: EditableCssProperty) {
    const value = effective(property);
    const choices = CSS_PROPERTY_CHOICES[property];
    if (choices) {
      return (
        <select
          value={choices.includes(value) ? value : ''}
          disabled={disabled}
          onChange={(e) => setStyle(property, e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-1 text-[11px] text-text"
        >
          <option value="">{t('play.react.inspector.unset')}</option>
          {choices.map((choice) => (
            <option key={choice} value={choice}>{choice}</option>
          ))}
        </select>
      );
    }
    if (property === 'color' || property === 'background-color' || property === 'border-color') {
      const hex = cssColorToHex(value);
      return (
        <>
          <input
            type="color"
            value={hex ?? '#000000'}
            disabled={disabled}
            onChange={(e) => setStyle(property, e.target.value)}
            className="h-6 w-9 shrink-0 rounded border border-border bg-transparent"
          />
          <input
            type="text"
            value={value}
            disabled={disabled}
            placeholder={t('play.react.inspector.unset')}
            onChange={(e) => setStyle(property, e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-text"
          />
        </>
      );
    }
    if (property === 'opacity') {
      const numeric = Number(value);
      return (
        <>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={Number.isFinite(numeric) ? numeric : 1}
            disabled={disabled}
            onChange={(e) => setStyle(property, e.target.value)}
            className="min-w-0 flex-1"
          />
          <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted">
            {Number.isFinite(numeric) ? numeric.toFixed(2) : '—'}
          </span>
        </>
      );
    }
    const length = parseLengthValue(value);
    if (length) {
      return (
        <>
          <input
            type="number"
            value={length.number}
            step={property === 'font-size' ? 2 : 1}
            disabled={disabled}
            onChange={(e) => setStyle(property, `${e.target.value}${length.unit || 'px'}`)}
            className="w-20 shrink-0 rounded border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-text"
          />
          <span className="shrink-0 font-mono text-[11px] text-muted">{length.unit || 'px'}</span>
        </>
      );
    }
    return (
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={t('play.react.inspector.unset')}
        onChange={(e) => setStyle(property, e.target.value)}
        className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-text"
      />
    );
  }

  const extraProperties = Object.keys(styles).filter(
    (property) => !(QUICK_CSS_PROPERTIES as readonly string[]).includes(property),
  );

  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] text-muted">
        &lt;{selection.tagName}&gt; · {selection.path}
      </div>

      {selection.text || override?.text !== undefined ? (
        <label className="block text-[11px] text-muted">
          {t('play.react.elementText')}
          <textarea
            rows={2}
            value={override?.text ?? selection.text}
            disabled={disabled}
            onChange={(e) => onChange(withTextOverride(override, e.target.value))}
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text"
          />
        </label>
      ) : (
        <p className="text-[11px] text-muted">{t('play.react.inspector.containerHint')}</p>
      )}

      <div className="space-y-1">
        {QUICK_CSS_PROPERTIES.map((property) => (
          <div key={property} className="flex items-center gap-1">
            <span
              className={`w-28 shrink-0 font-mono text-[11px] ${isOverridden(property) ? 'text-cyan-300' : 'text-muted'}`}
              title={isOverridden(property) ? t('play.react.inspector.overriddenHint') : undefined}
            >
              {isOverridden(property) ? '• ' : ''}
              {property}
            </span>
            {renderControl(property)}
            <button
              type="button"
              disabled={disabled || !isOverridden(property)}
              onClick={() => setStyle(property, '')}
              title={t('play.react.inspector.clearProperty')}
              className="shrink-0 rounded border border-border px-1.5 py-1 text-[11px] text-muted disabled:opacity-30"
            >
              ↺
            </button>
          </div>
        ))}
      </div>

      {extraProperties.length > 0 ? (
        <div className="space-y-1 border-t border-border pt-2">
          {extraProperties.map((property) => (
            <div key={property} className="flex items-center gap-1">
              <span className="w-28 shrink-0 font-mono text-[11px] text-cyan-300">• {property}</span>
              <input
                type="text"
                value={styles[property] ?? ''}
                disabled={disabled}
                onChange={(e) => setStyle(property, e.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-text"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => setStyle(property, '')}
                className="shrink-0 rounded border border-border px-1.5 py-1 text-[11px] text-muted"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 border-t border-border pt-2">
        <select
          value={advancedProperty}
          disabled={disabled}
          onChange={(e) => setAdvancedProperty(e.target.value as EditableCssProperty)}
          className="rounded border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-text"
        >
          {EDITABLE_CSS_PROPERTIES.map((property) => (
            <option key={property} value={property}>{property}</option>
          ))}
        </select>
        <input
          type="text"
          value={advancedValue}
          disabled={disabled}
          placeholder={selection.computed[advancedProperty] ?? ''}
          onChange={(e) => setAdvancedValue(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-text"
        />
        <button
          type="button"
          disabled={disabled || !isSafeCssValue(advancedValue.trim())}
          onClick={() => {
            setStyle(advancedProperty, advancedValue);
            setAdvancedValue('');
          }}
          className="rounded border border-border px-2 py-1 text-[11px] text-text disabled:opacity-40"
        >
          {t('play.react.addCss')}
        </button>
      </div>

      <button
        type="button"
        disabled={disabled || (override?.text === undefined && Object.keys(styles).length === 0)}
        onClick={() => onChange(null)}
        className="text-[11px] text-rose-400 underline disabled:opacity-40 disabled:no-underline"
      >
        {t('play.react.resetElement')}
      </button>
    </div>
  );
}
