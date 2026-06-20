import type { CSSProperties } from 'react';

export const WRAPPING_OVERLAY_TEXT_STYLE = {
  minWidth: 0,
  minHeight: 0,
  lineHeight: 1.35,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
} satisfies Pick<CSSProperties, 'minWidth' | 'minHeight' | 'lineHeight' | 'whiteSpace' | 'overflowWrap' | 'wordBreak'>;
