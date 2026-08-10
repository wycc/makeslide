import type { PreviewProvider, SpeakerPreviewKey, SpeakerPreviewState } from './useSpeakerPreview';

const INPUT_CLASS =
  'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted';

/**
 * One 人設 field with a preview button beside it.
 *
 * The button sends the values **currently in the form** — this field's persona plus the voice
 * selected for the same speaker — so a persona can be heard before it is saved. That is why
 * `voice` is passed in rather than read from storage: previewing the stored value would make you
 * commit an untested persona to find out how it sounds.
 */
export function SpeakerPersonaField(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Voice currently selected for this same speaker; empty means "inherit". */
  voice: string;
  provider: PreviewProvider;
  speaker: '1' | '2';
  preview: SpeakerPreviewState;
  labels: { play: string; playing: string; loading: string };
}) {
  const { label, placeholder, value, onChange, voice, provider, speaker, preview, labels } = props;
  const key: SpeakerPreviewKey = `${provider}:${speaker}`;
  const isActive = preview.activeKey === key;
  const isLoading = isActive && preview.loading;
  const errorMessage = preview.error?.key === key ? preview.error.message : null;

  return (
    <div className="block text-sm text-text">
      <label className="block">
        {label}
        <div className="mt-1 flex items-start gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLASS}
            placeholder={placeholder}
          />
        </div>
      </label>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          // Clicking the active one stops it, so a long clip does not have to be waited out
          // before trying the next persona.
          onClick={() => (isActive ? preview.stop() : preview.play(key, { provider, voice, persona: value }))}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-text transition hover:border-primary disabled:opacity-50"
        >
          {isLoading ? labels.loading : isActive ? labels.playing : labels.play}
        </button>
        {errorMessage ? <span className="text-xs text-red-400">{errorMessage}</span> : null}
      </div>
    </div>
  );
}
