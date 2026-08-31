import type { PdfListItem } from '../types';

export type ShareBadgeKind = 'public' | 'public_editable' | 'links' | 'users' | 'groups' | 'expired' | 'private';

export interface ShareBadge {
  kind: ShareBadgeKind;
  /** 有數量的徽章（links / users / groups / expired）才有值。 */
  count?: number;
}

/**
 * 決定一份簡報要顯示哪些分享徽章。
 *
 * 回傳 `null` 表示「不該渲染任何東西」，與回傳 `[]` 是兩回事：後端只把分享數字
 * 送給簡報擁有者，所以看不到數字就代表這不是我的簡報，別人的簡報分享給了誰不
 * 該出現在我的畫面上。數字是 0 才表示「確實沒有分享出去」，那才輪到
 * `showWhenPrivate` 決定要不要畫一個「未分享」。
 *
 * 過期連結排在最後：它描述的是清理狀態，不是「現在誰能開」。
 */
export function shareStatusBadges(
  pdf: Pick<PdfListItem, 'visibility' | 'share_link_count' | 'share_expired_link_count' | 'share_user_count' | 'share_group_count'>,
  options?: { showWhenPrivate?: boolean },
): ShareBadge[] | null {
  if (pdf.share_link_count === undefined) return null;

  const linkCount = pdf.share_link_count ?? 0;
  const expiredLinkCount = pdf.share_expired_link_count ?? 0;
  const userCount = pdf.share_user_count ?? 0;
  const groupCount = pdf.share_group_count ?? 0;
  const isPublic = pdf.visibility === 'public' || pdf.visibility === 'public_editable';

  const badges: ShareBadge[] = [];
  if (isPublic) badges.push({ kind: pdf.visibility === 'public_editable' ? 'public_editable' : 'public' });
  if (linkCount > 0) badges.push({ kind: 'links', count: linkCount });
  if (userCount > 0) badges.push({ kind: 'users', count: userCount });
  if (groupCount > 0) badges.push({ kind: 'groups', count: groupCount });

  if (badges.length === 0) {
    // An expired link is not a way in, so a deck whose only share has lapsed is
    // "not shared" - but say so alongside the expiry rather than hiding it.
    if (!options?.showWhenPrivate) return expiredLinkCount > 0 ? [{ kind: 'expired', count: expiredLinkCount }] : [];
    return [{ kind: 'private' }, ...(expiredLinkCount > 0 ? [{ kind: 'expired' as const, count: expiredLinkCount }] : [])];
  }

  if (expiredLinkCount > 0) badges.push({ kind: 'expired', count: expiredLinkCount });
  return badges;
}
