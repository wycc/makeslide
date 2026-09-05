import type { PdfListItem } from '../types';
import { useI18n } from '../i18n';
import { shareStatusBadges, type ShareBadge } from './shareStatusBadges';

interface ShareStatusBadgesProps {
  pdf: PdfListItem;
  /**
   * 沒有任何分享時是否顯示「未分享」。列表檢視一行一份簡報，畫一個灰徽章能讓
   * 「已檢查過、確實沒分享」與「這欄沒東西」分得開；卡片檢視空間較擠，預設留白。
   */
  showWhenPrivate?: boolean;
  className?: string;
}

const BADGE_BASE = 'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] leading-none';

const BADGE_STYLES: Record<ShareBadge['kind'], string> = {
  public: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  public_editable: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  links: 'border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300',
  users: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  groups: 'border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300',
  expired: 'border-border text-muted',
  private: 'border-border text-muted',
};

const BADGE_ICONS: Record<ShareBadge['kind'], string> = {
  public: '🌐',
  public_editable: '🌐',
  links: '🔗',
  users: '👤',
  groups: '👥',
  expired: '⌛',
  private: '🔒',
};

const LABEL_KEYS = {
  public: 'share.status.public',
  public_editable: 'share.status.publicEditable',
  links: 'share.status.links',
  users: 'share.status.users',
  groups: 'share.status.groups',
  expired: 'share.status.expiredLinks',
  private: 'share.status.private',
} as const;

const TITLE_KEYS = {
  public: 'share.status.publicTitle',
  public_editable: 'share.status.publicEditableTitle',
  links: 'share.status.linksTitle',
  users: 'share.status.usersTitle',
  groups: 'share.status.groupsTitle',
  expired: 'share.status.expiredLinksTitle',
  private: 'share.status.privateTitle',
} as const;

/**
 * 一份簡報對外的分享狀況：公開程度、有效的分享連結、被個別授權的使用者與群組。
 * 要顯示什麼由 `shareStatusBadges()` 決定（含「別人的簡報就不顯示」那條規則）。
 */
export default function ShareStatusBadges({ pdf, showWhenPrivate = false, className }: ShareStatusBadgesProps) {
  const { t } = useI18n();
  const badges = shareStatusBadges(pdf, { showWhenPrivate });
  if (!badges || badges.length === 0) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      {badges.map((badge) => {
        const label = t(LABEL_KEYS[badge.kind]).replace('{count}', String(badge.count ?? 0));
        const title = t(TITLE_KEYS[badge.kind]).replace('{count}', String(badge.count ?? 0));
        return (
          <span key={badge.kind} className={`${BADGE_BASE} ${BADGE_STYLES[badge.kind]}`} title={title}>
            {BADGE_ICONS[badge.kind]} {label}
          </span>
        );
      })}
    </span>
  );
}
