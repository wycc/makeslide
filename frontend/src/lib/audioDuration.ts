export function formatAudioDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  const twoDigits = (value: number) => String(value).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${twoDigits(minutes)}:${twoDigits(remainingSeconds)}`;
  }

  return `${minutes}:${twoDigits(remainingSeconds)}`;
}
