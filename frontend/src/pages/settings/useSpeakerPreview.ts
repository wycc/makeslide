import { useCallback, useEffect, useRef, useState } from 'react';

import { previewSpeakerVoice } from '../../lib/api/system';

export type PreviewProvider = 'openai' | 'gemini' | 'openrouter' | 'audiocpp';

/** Identifies which of the eight persona fields a preview belongs to, e.g. `gemini:1`. */
export type SpeakerPreviewKey = `${PreviewProvider}:${'1' | '2'}`;

export interface SpeakerPreviewState {
  /** The field currently synthesizing or playing; null when idle. */
  activeKey: SpeakerPreviewKey | null;
  /** Whether the clip is still being synthesized (as opposed to already playing). */
  loading: boolean;
  /** Failure text for the field that failed, cleared as soon as another preview starts. */
  error: { key: SpeakerPreviewKey; message: string } | null;
  play: (
    key: SpeakerPreviewKey,
    params: { provider: PreviewProvider; speaker: '1' | '2'; voice: string; persona: string },
  ) => void;
  stop: () => void;
}

/**
 * Plays the fixed preview line for one speaker, one clip at a time.
 *
 * Only one preview may sound at once — the point is to compare personas, and two clips talking
 * over each other tells you nothing. Starting a new one stops whatever is playing.
 *
 * Every blob URL is revoked once its clip settles; a preview is regenerated on each click (the
 * persona in the box may have just changed), so holding them would leak one object URL per press.
 */
export function useSpeakerPreview(): SpeakerPreviewState {
  const [activeKey, setActiveKey] = useState<SpeakerPreviewKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ key: SpeakerPreviewKey; message: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  // Guards against a slow request finishing after the user started another one (or navigated
  // away): only the newest request may touch state or start playing.
  const requestRef = useRef(0);

  const release = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    release();
    setActiveKey(null);
    setLoading(false);
  }, [release]);

  useEffect(() => release, [release]);

  const play = useCallback<SpeakerPreviewState['play']>((key, params) => {
    requestRef.current += 1;
    const token = requestRef.current;
    release();
    setError(null);
    setActiveKey(key);
    setLoading(true);
    void (async () => {
      try {
        const url = await previewSpeakerVoice(params);
        if (token !== requestRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        const settle = () => {
          if (token !== requestRef.current) return;
          release();
          setActiveKey(null);
        };
        audio.onended = settle;
        audio.onerror = settle;
        setLoading(false);
        await audio.play();
      } catch (err) {
        if (token !== requestRef.current) return;
        release();
        setActiveKey(null);
        setLoading(false);
        setError({ key, message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [release]);

  return { activeKey, loading, error, play, stop };
}
