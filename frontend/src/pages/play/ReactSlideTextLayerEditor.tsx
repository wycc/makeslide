import {
  MAX_TEXT_LAYER_FONT_PX,
  MIN_TEXT_LAYER_FONT_PX,
  TEXT_LAYER_FONTS,
  cssColorToHex,
  type ReactSlideTextLayer,
  type TextLayerFont,
} from '../../lib/reactSlide';
import { useI18n } from '../../i18n';

interface ReactSlideTextLayerEditorProps {
  layer: ReactSlideTextLayer;
  disabled?: boolean;
  onChange: (next: ReactSlideTextLayer) => void;
  onDelete: () => void;
}

/**
 * Editor for one text layer — text lifted out of the background image.
 *
 * Distinct from the element editor on purpose: a text layer *is* editable data (we created it), so
 * it is edited directly rather than through the override mechanism the component's own elements
 * need. That also means every control here is a plain value with a known range, so nothing needs a
 * CSS whitelist.
 */
export function ReactSlideTextLayerEditor({ layer, disabled = false, onChange, onDelete }: ReactSlideTextLayerEditorProps) {
  const { t } = useI18n();
  const set = <K extends keyof ReactSlideTextLayer>(key: K, value: ReactSlideTextLayer[K]) =>
    onChange({ ...layer, [key]: value });

  return (
    <div className="space-y-2">
      <div className="font-mono text-[11px] text-muted">
        {t('play.react.layerTitle')} · {layer.id}
      </div>

      <label className="block text-[11px] text-muted">
        {t('play.react.layerText')}
        <textarea
          rows={3}
          value={layer.text}
          disabled={disabled}
          onChange={(e) => set('text', e.target.value)}
          className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text"
        />
      </label>

      <div className="flex items-center gap-1">
        <span className="w-16 shrink-0 text-[11px] text-text">{t('play.react.layerFontSize')}</span>
        <input
          type="number"
          min={MIN_TEXT_LAYER_FONT_PX}
          max={MAX_TEXT_LAYER_FONT_PX}
          value={Math.round(layer.fontSizePx)}
          disabled={disabled}
          onChange={(e) => set('fontSizePx', Number(e.target.value) || layer.fontSizePx)}
          className="w-20 rounded border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-text"
        />
        <span className="font-mono text-[11px] text-muted">px</span>
      </div>

      <div className="flex items-center gap-1">
        <span className="w-16 shrink-0 text-[11px] text-text">{t('play.react.layerColor')}</span>
        <input
          type="color"
          value={cssColorToHex(layer.color) ?? '#ffffff'}
          disabled={disabled}
          onChange={(e) => set('color', e.target.value)}
          className="h-6 w-9 shrink-0 rounded border border-border bg-transparent"
        />
        <input
          type="text"
          value={layer.color}
          disabled={disabled}
          onChange={(e) => set('color', e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-1 font-mono text-[11px] text-text"
        />
      </div>

      <div className="flex items-center gap-1">
        <span className="w-16 shrink-0 text-[11px] text-text">{t('play.react.layerWeight')}</span>
        <select
          value={String(layer.fontWeight)}
          disabled={disabled}
          onChange={(e) => set('fontWeight', Number(e.target.value))}
          className="rounded border border-border bg-surface px-1.5 py-1 text-[11px] text-text"
        >
          {[300, 400, 500, 600, 700, 800, 900].map((weight) => (
            <option key={weight} value={weight}>{weight}</option>
          ))}
        </select>
        <span className="ml-2 w-12 shrink-0 text-[11px] text-text">{t('play.react.layerAlign')}</span>
        <select
          value={layer.textAlign}
          disabled={disabled}
          onChange={(e) => set('textAlign', e.target.value as ReactSlideTextLayer['textAlign'])}
          className="rounded border border-border bg-surface px-1.5 py-1 text-[11px] text-text"
        >
          <option value="left">left</option>
          <option value="center">center</option>
          <option value="right">right</option>
        </select>
      </div>

      <div className="flex items-center gap-1">
        <span className="w-16 shrink-0 text-[11px] text-text">{t('play.react.layerFont')}</span>
        <select
          value={layer.fontFamily}
          disabled={disabled}
          onChange={(e) => set('fontFamily', e.target.value as TextLayerFont)}
          className="rounded border border-border bg-surface px-1.5 py-1 text-[11px] text-text"
        >
          {TEXT_LAYER_FONTS.map((font) => (
            <option key={font} value={font}>
              {t(`play.react.layerFont.${font}` as 'play.react.layerFont.body')}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onDelete}
        className="text-[11px] text-danger underline disabled:opacity-40"
      >
        {t('play.react.layerDelete')}
      </button>
    </div>
  );
}
