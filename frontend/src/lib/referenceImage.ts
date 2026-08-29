/**
 * Turning a pasted or picked image file into something small enough to send.
 *
 * A screenshot straight off a modern display is several megabytes, and every attached image is
 * re-sent with each turn of the conversation — so they are downscaled and re-encoded in the browser
 * rather than shipped as-is. The model only needs to read the layout, not the pixels.
 */

/** Longest edge, in pixels, kept after downscaling. Enough to read a diagram's labels. */
export const REFERENCE_IMAGE_MAX_EDGE = 1280;
/** JPEG quality for the re-encode. */
const REFERENCE_IMAGE_QUALITY = 0.85;

/** Formats the vision models accept, matching the backend's `IMAGE_DATA_URL_PATTERN`. */
const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** True when this file is an image we can attach. */
export function isSupportedReferenceImage(file: File): boolean {
  return SUPPORTED_TYPES.includes(file.type);
}

/** The scaled size for `width`x`height`, never enlarging an image that is already small. */
export function scaledImageSize(
  width: number,
  height: number,
  maxEdge = REFERENCE_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > maxEdge)) return { width, height };
  const scale = maxEdge / longest;
  // At least 1px on each axis: a very wide, very short image would otherwise scale to zero height
  // and produce a blank canvas.
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Reads an image file and returns a downscaled `data:` URL.
 *
 * Rejects if the file isn't a supported image or the browser cannot decode it — a caller should
 * report that rather than attach something the model will refuse.
 */
export async function fileToReferenceImageDataUrl(file: File): Promise<string> {
  if (!isSupportedReferenceImage(file)) {
    throw new Error(`Unsupported image type: ${file.type || 'unknown'}`);
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const { width, height } = scaledImageSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    // A transparent PNG re-encoded as JPEG turns black; fill white so a diagram with a transparent
    // background stays readable.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', REFERENCE_IMAGE_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode image'));
    image.src = src;
  });
}

/** Image files carried by a paste or drop, in the order the browser reports them. */
export function imageFilesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  // `files` covers both a pasted screenshot and a drag from the file manager; `items` alone misses
  // some browsers' drop payloads.
  return Array.from(data.files).filter(isSupportedReferenceImage);
}
