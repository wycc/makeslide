import { useEffect, useState } from 'react';

import { fetchInstalledAudioCppModels, type InstalledAudioCppModel } from '../../lib/api/system';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted';

/** Sentinel for "type a path" — cannot collide with a real path, which never starts with a space. */
const CUSTOM = ' custom';

/**
 * The audio.cpp model setting as a menu of what is actually installed on the server's machine.
 *
 * A typed path had to be absolute, had to be a directory for Qwen3-TTS but a file for BreezeTTS 2,
 * and was only proven wrong by a failed synthesis. The server reads audio.cpp's own catalog and
 * reports exactly the packages whose files are present, with the right value for each — so picking
 * one is the whole configuration, and it sets the family too: a model and a family that disagree
 * fail on the first segment.
 *
 * 「自訂路徑」 stays for anything the catalog does not know (a model built by hand, a family the
 * catalog does not describe), and is what the field falls back to when the list cannot be read.
 */
export function AudioCppModelField(props: {
  label: string;
  value: string;
  onPick: (picked: { model: string; family?: string }) => void;
  labels: {
    custom: string;
    customPlaceholder: string;
    hint: string;
    loading: string;
    /** Nothing installed, or the list could not be read — the text box is all there is. */
    none: string;
  };
}) {
  const { label, value, onPick, labels } = props;
  const [models, setModels] = useState<InstalledAudioCppModel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchInstalledAudioCppModels()
      .then((result) => {
        if (!cancelled) setModels(result.models);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = value.trim();
  const known = models?.find((m) => m.path === trimmed) ?? null;
  // A stored path that is not in the list is shown as typed, never swapped for a menu entry.
  const showCustom = custom || (trimmed !== '' && models !== null && !known);
  const noList = failed || (models !== null && models.length === 0);

  const textBox = (
    <input
      value={value}
      onChange={(e) => onPick({ model: e.target.value })}
      className={INPUT_CLASS}
      placeholder={labels.customPlaceholder}
    />
  );

  if (noList) {
    return (
      <label className="block text-sm text-text sm:col-span-2">
        {label}
        {textBox}
        <span className="mt-1 block text-xs text-muted">{labels.none}</span>
      </label>
    );
  }

  // Grouped by family, in the order the server reported them.
  const families: Array<{ name: string; items: InstalledAudioCppModel[] }> = [];
  for (const model of models ?? []) {
    const group = families.find((g) => g.name === model.familyName);
    if (group) group.items.push(model);
    else families.push({ name: model.familyName, items: [model] });
  }

  return (
    <div className="block text-sm text-text sm:col-span-2">
      <label className="block">
        {label}
        <select
          value={models === null ? '' : showCustom ? CUSTOM : known?.path ?? ''}
          disabled={models === null}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            const picked = models?.find((m) => m.path === next);
            if (picked) onPick({ model: picked.path, family: picked.family });
          }}
          className={INPUT_CLASS}
        >
          {models === null ? <option value="">{labels.loading}</option> : null}
          {models !== null && !trimmed && !showCustom ? <option value="">—</option> : null}
          {families.map((group) => (
            <optgroup key={group.name} label={group.name}>
              {group.items.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={CUSTOM}>{labels.custom}</option>
        </select>
      </label>
      {showCustom ? textBox : null}
      <span className="mt-1 block text-xs text-muted">{labels.hint}</span>
    </div>
  );
}
