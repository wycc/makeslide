import { useEffect, useRef, useState } from 'react';

import { AUDIOCPP_QWEN3_VOICES, AUDIOCPP_VOICE_DESIGN, isAudioCppQwen3Voice, isAudioCppVoiceDesign } from '../../lib/ttsVoices';
import { freezeDesignedVoice, setAudioCppVoiceRefTranscript, uploadAudioCppVoiceRef } from '../../lib/api/system';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted disabled:bg-border/40 disabled:text-muted';

/** Sentinel for the "type it yourself" option — cannot collide with a speaker id or a path. */
const CUSTOM = ' custom';

/**
 * Voice picker for audio.cpp: the nine packaged Qwen3-TTS speakers as a menu, plus the two ways to
 * get a voice that is not on any list — design one from the 人設 text, or clone one from a clip.
 *
 * A plain dropdown would be wrong on its own, because this field legitimately takes things that
 * are not in any list: a path to a reference clip (voice cloning), or a built-in id from a
 * different model family. So the list covers what is actually pickable and 「自訂」 covers the
 * rest.
 *
 * Each of the three answers runs on a **different Qwen3 model package** (CustomVoice / VoiceDesign
 * / Base); the backend derives which one from this value, so picking a voice here is the whole
 * configuration — there is no second field to keep in sync.
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
  /**
   * The 人設 currently in the neighbouring box. Voice Design generates the voice from it, so
   * freezing that voice needs the text as typed, not the saved copy.
   */
  persona: string;
  labels: {
    inherit: string;
    male: string;
    female: string;
    custom: string;
    customPlaceholder: string;
    hint: string;
    /** Short language/dialect tag per voice, e.g. 「國語」/「北京話」. */
    note: Record<string, string>;
    /** VoiceDesign: the option itself, and what it needs to work (a non-empty persona). */
    voiceDesign: string;
    voiceDesignHint: string;
    /** Freezing a designed voice into a reference clip, so a deck stops drifting page to page. */
    freeze: string;
    freezing: string;
    freezeHint: string;
    freezeDone: (seconds: number) => string;
    /** Upload control for the reference clip that voice cloning needs. */
    upload: string;
    uploading: string;
    uploadHint: string;
    uploadDone: (seconds: number) => string;
    /** The clip's transcript — required by Qwen3 cloning, pre-filled by Whisper when available. */
    transcript: string;
    transcriptPlaceholder: string;
    transcriptHint: string;
    transcriptSaved: string;
  };
}) {
  const { label, value, onChange, persona, labels } = props;
  const trimmed = value.trim();
  const isDesign = isAudioCppVoiceDesign(trimmed);
  const valueIsCustom = trimmed !== '' && !isDesign && !isAudioCppQwen3Voice(trimmed);
  const [custom, setCustom] = useState(valueIsCustom);
  // Settings arrive asynchronously, so a custom value can show up after the first render.
  useEffect(() => {
    if (valueIsCustom) setCustom(true);
  }, [valueIsCustom]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadedSeconds, setUploadedSeconds] = useState<number | null>(null);
  const [transcript, setTranscript] = useState('');
  const [transcriptSaved, setTranscriptSaved] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [frozenSeconds, setFrozenSeconds] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const selected = custom ? CUSTOM : isDesign ? AUDIOCPP_VOICE_DESIGN : trimmed.toLowerCase();

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const saved = await uploadAudioCppVoiceRef(file);
      setUploadedSeconds(saved.seconds);
      setTranscript(saved.transcript);
      setTranscriptSaved(false);
      // The stored value is the server's path, not the file name: the engine opens this later,
      // from a different process, long after the browser's File object is gone.
      onChange(saved.path);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      // Let the same file be picked again after a failure — without this the input keeps the old
      // value and the change event never fires.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="block text-sm text-text">
      <label className="block">
        {label}
        <select
          value={selected}
          onChange={(e) => {
            const next = e.target.value;
            setCustom(next === CUSTOM);
            setUploadError('');
            setUploadedSeconds(null);
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
          <option value={AUDIOCPP_VOICE_DESIGN}>{labels.voiceDesign}</option>
          <option value={CUSTOM}>{labels.custom}</option>
        </select>
      </label>
      {isDesign ? (
        <>
          <span className="mt-1 block text-xs text-muted">{labels.voiceDesignHint}</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={freezing || !persona.trim()}
              onClick={() => {
                setFreezing(true);
                setUploadError('');
                void freezeDesignedVoice(persona)
                  .then((saved) => {
                    setFrozenSeconds(saved.seconds);
                    setUploadedSeconds(saved.seconds);
                    setTranscript(saved.transcript);
                    // Switching the field to the clip is the point: it moves synthesis off
                    // VoiceDesign and onto cloning, which is what stops the drift.
                    setCustom(true);
                    onChange(saved.path);
                  })
                  .catch((err: unknown) => setUploadError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setFreezing(false));
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
            >
              {freezing ? labels.freezing : labels.freeze}
            </button>
            {frozenSeconds != null ? <span className="text-xs text-muted">{labels.freezeDone(frozenSeconds)}</span> : null}
          </div>
          <span className="mt-1 block text-xs text-muted">{labels.freezeHint}</span>
          {uploadError ? <span className="mt-1 block text-xs text-red-500">{uploadError}</span> : null}
        </>
      ) : null}
      {custom ? (
        <>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={INPUT_CLASS}
            placeholder={labels.customPlaceholder}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
            >
              {uploading ? labels.uploading : labels.upload}
            </button>
            {uploadedSeconds != null ? (
              <span className="text-xs text-muted">{labels.uploadDone(uploadedSeconds)}</span>
            ) : null}
          </div>
          <span className="mt-1 block text-xs text-muted">{labels.uploadHint}</span>
          {uploadError ? <span className="mt-1 block text-xs text-red-500">{uploadError}</span> : null}
          {uploadedSeconds != null ? (
            <label className="mt-2 block text-xs text-muted">
              {labels.transcript}
              <textarea
                value={transcript}
                onChange={(e) => {
                  setTranscript(e.target.value);
                  setTranscriptSaved(false);
                }}
                // Saved on blur rather than per keystroke: the clip already exists on the server,
                // so this is a correction to a stored file, not part of the settings form.
                onBlur={() => {
                  void setAudioCppVoiceRefTranscript(trimmed, transcript)
                    .then(() => setTranscriptSaved(true))
                    .catch((err: unknown) => setUploadError(err instanceof Error ? err.message : String(err)));
                }}
                rows={2}
                className={INPUT_CLASS}
                placeholder={labels.transcriptPlaceholder}
              />
              <span className="mt-1 block">{transcriptSaved ? labels.transcriptSaved : labels.transcriptHint}</span>
            </label>
          ) : null}
        </>
      ) : null}
      <span className="mt-1 block text-xs text-muted">{labels.hint}</span>
    </div>
  );
}
