// Build a QR-code image URL (via api.qrserver.com) that encodes the given data string.
// Used to render a scannable code so an audience can open a share link on their phones.
export function buildJoinQrImageUrl(data: string, size = 520): string {
  const dimension = Math.max(1, Math.floor(size));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${dimension}x${dimension}&data=${encodeURIComponent(data)}`;
}
