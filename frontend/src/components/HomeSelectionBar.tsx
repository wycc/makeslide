import { useState } from 'react';
import { useI18n } from '../i18n';
import Menu from './Menu';

/**
 * 選取簡報後出現的操作列（contextual bar）。
 *
 * 這些動作原本是一排 chips，掛在篩選卡片的底部——也就是**離被選取的卡片最遠**的位置：
 * 使用者往下捲去勾選，再往上捲回去找操作，操作完又要捲回去確認。改成 sticky 的一列
 * 貼在清單上緣後，選取與操作永遠在同一個視野裡。
 *
 * 只在有選取時出現，所以平常不佔版面，也不必用顏色去喊「我是批次操作」。
 */

interface HomeSelectionBarProps {
  selectedCount: number;
  categories: string[];
  onClear: () => void;
  onDelete: () => void;
  onCreateCollection: () => void;
  onMoveCategory: (category: string) => void;
  onSetTags: (tags: string) => void;
  deleting: boolean;
  collecting: boolean;
  moving: boolean;
  tagging: boolean;
}

export default function HomeSelectionBar({
  selectedCount,
  categories,
  onClear,
  onDelete,
  onCreateCollection,
  onMoveCategory,
  onSetTags,
  deleting,
  collecting,
  moving,
  tagging,
}: HomeSelectionBarProps): JSX.Element | null {
  const { t } = useI18n();
  const [tagInput, setTagInput] = useState('');

  if (selectedCount <= 0) return null;

  const busy = deleting || collecting || moving || tagging;

  return (
    <div
      // role/aria-label 讓這一列在輔助技術裡是一個具名的操作群組，而不是一堆散落的按鈕；
      // 也讓測試能把「刪除」限定在這裡——卡片上也有一顆同名的。
      role="toolbar"
      aria-label={t('home.selection.toolbar')}
      // aria-live 讓螢幕閱讀器在進入選取模式時知道多了一列操作，而不是默默出現。
      aria-live="polite"
      className="sticky top-0 z-30 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-surface/95 px-3 py-2 shadow-sm backdrop-blur"
    >
      <button
        type="button"
        onClick={onClear}
        aria-label={t('home.selection.clear')}
        title={t('home.selection.clear')}
        className="rounded-md px-2 py-1 text-sm text-muted transition hover:bg-border hover:text-text"
      >
        ✕
      </button>
      <span className="text-sm font-medium text-text">
        {t('home.selection.count').replace('{n}', String(selectedCount))}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCreateCollection}
          disabled={busy}
          title={t('home.batchCreateCollectionHint')}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text transition hover:bg-border hover:text-bg disabled:opacity-50 dark:text-white"
        >
          {collecting ? '…' : t('home.selection.createCollection')}
        </button>

        <Menu
          label={t('home.batchMoveToCategory')}
          trigger={<span>{moving ? '…' : `${t('home.selection.moveTo')} ▾`}</span>}
          items={categories.map((c) => ({
            key: c,
            label: c || t('home.listUncategorized'),
            onSelect: () => onMoveCategory(c),
            disabled: moving,
          }))}
        />

        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagInput.trim()) {
              onSetTags(tagInput);
              setTagInput('');
            }
          }}
          disabled={tagging}
          placeholder={tagging ? '…' : t('home.batchSetTags')}
          aria-label={t('home.batchSetTags')}
          className="w-32 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text outline-none transition focus:border-primary disabled:opacity-50"
        />

        {/* 刪除放在最後且用警示色：它是這一列唯一不可復原的動作。 */}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
        >
          {deleting ? '…' : t('home.selection.delete')}
        </button>
      </div>
    </div>
  );
}
