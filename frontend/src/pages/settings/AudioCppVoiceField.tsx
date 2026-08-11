import { useEffect, useState } from 'react';

import { AUDIOCPP_QWEN3_VOICES, isAudioCppQwen3Voice } from '../../lib/ttsVoices';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted';

/** Sentinel for the "type it yourself" option — cannot collide with a speaker id or a path. */
const CUSTOM = ' custom';

/**
 * Voice picker for audio.cpp: the nine packaged Qwen3-TTS speakers as a menu, with an escape
 * hatch back to free text.
 *
 * A plain dropdown would be wrong on its own, because this field legitimately takes things that
 * are not in any list: a path to a reference clip (voice cloning), or a built-in id from a
 * different model family. So the list covers what is actually pickable and 「自訂」 covers the
 * rest.
 *
 * Custom mode is local state rather than a function of the value: choosing 「自訂」 has to clear
 * the value (there is nothing to type yet), and deriving the mode from the value alone would make
 * the input box vanish the instant it appeared. A stored value that is not a packaged speaker
 * still switches the mode on by itself, so nothing typed earlier is silently swapped for a menu
 * entry.
 */
export function AudioCppVoiceField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  labels: {
    inherit: string;
    male: string;
    female: string;
    custom: string;
    customPlaceholder: string;
    hint: string;
    /** Short language/dialect tag per voice, e.g. 「國語」/「北京話」. */
    note: Record<string, string>;
  };
}) {
  const { label, value, onChange, labels } = props;
  const trimmed = value.trim();
  const valueIsCustom = trimmed !== '' && !isAudioCppQwen3Voice(trimmed);
  const [custom, setCustom] = useState(valueIsCustom);
  // Settings arrive asynchronously, so a custom value can show up after the first render.
  useEffect(() => {
    if (valueIsCustom) setCustom(true);
  }, [valueIsCustom]);

  return (
    <div className="block text-sm text-text">
      <label className="block">
        {label}
        <select
          value={custom ? CUSTOM : trimmed.toLowerCase()}
          onChange={(e) => {
            const next = e.target.value;
            setCustom(next === CUSTOM);
            onChange(next === CUSTOM ? '' : next);
          }}
          className={INPUT_CLASS}
        >
          <option value="">{labels.inherit}</option>
          {AUDIOCPP_QWEN3_VOICES.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {`${voice.id}（${voice.gender === 'M' ? labels.male : labels.female}・${labels.note[voice.note] ?? voice.note}）`}
            </option>
          ))}
          <option value={CUSTOM}>{labels.custom}</option>
        </select>
      </label>
      {custom ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
          placeholder={labels.customPlaceholder}
        />
      ) : null}
      <span className="mt-1 block text-xs text-muted">{labels.hint}</span>
    </div>
  );
}
