import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { useOverlayDismiss } from './useOverlayDismiss';

/**
 * 上傳 PDF 前的設定對話框。
 *
 * 這兩個設定原本是按鈕下方展開的一小條 inline 區塊，有兩個問題：
 *
 * 1. **順序是反的。** 點「簡報逐頁處理」會**立刻**開啟檔案選擇器，所以主持模式必須在
 *    點下去之前就先設好——而它就擺在旁邊，看起來像是之後才要決定的東西。現在改成
 *    兩個都先選、最後才選檔案。
 * 2. **沒有空間解釋。** 「簡報逐頁處理」與「一般文件 AI 分頁」原本是兩顆光禿禿的按鈕，
 *    而它們決定的是 pipeline 要不要幫你重新分頁——這個差別值得一句說明。
 */

export type PdfImportMode = 'slides' | 'document';
export type HostMode = 'solo' | 'dual';

interface UploadPdfDialogProps {
  importMode: PdfImportMode;
  hostMode: HostMode;
  onImportModeChange: (mode: PdfImportMode) => void;
  onHostModeChange: (mode: HostMode) => void;
  onPickFile: () => void;
  onClose: () => void;
}

export default function UploadPdfDialog({
  importMode,
  hostMode,
  onImportModeChange,
  onHostModeChange,
  onPickFile,
  onClose,
}: UploadPdfDialogProps): JSX.Element {
  const { t } = useI18n();
  const { onBackdropClick } = useOverlayDismiss(onClose);

  /*
    掛到 document.body，不能留在原地 render。
    這個對話框是從首頁 header 裡的按鈕開出來的，而 header 有 `backdrop-blur`——
    `backdrop-filter` 會建立 containing block，於是 `position: fixed` 不再相對於視窗，
    而是相對於那個只有約 70px 高的 header：遮罩只蓋住頂端一條，對話框自己也被裁成一條。
    症狀看起來像「對話框位置不對」，實際上是定位基準被祖先偷換了。

    靠上對齊而不是垂直置中，並讓遮罩可捲動：內容比視窗高時（矮視窗、瀏覽器縮放），
    置中會把標題往視窗外推，而外層不能捲就救不回來。
  */
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/75 p-4 pt-16 sm:pt-24"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-pdf-dialog-title"
        className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 text-text shadow-2xl"
      >
        <h2 id="upload-pdf-dialog-title" className="text-lg font-semibold">
          {t('upload.uploadPdf')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('upload.dialogDescription')}</p>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">{t('upload.pdfContent')}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([
              { value: 'slides', label: t('upload.modeSlides'), hint: t('upload.modeSlidesHint') },
              { value: 'document', label: t('upload.modeDocument'), hint: t('upload.modeDocumentHint') },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onImportModeChange(option.value)}
                aria-pressed={importMode === option.value}
                className={`rounded-lg border p-3 text-left transition ${
                  importMode === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-bg hover:border-primary/50'
                }`}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-1 block text-xs text-muted">{option.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">{t('upload.hostModeLabel')}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([
              { value: 'solo', label: t('upload.hostModeSolo'), hint: t('upload.hostModeSoloHint') },
              { value: 'dual', label: t('upload.hostModeDual'), hint: t('upload.hostModeDualHint') },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onHostModeChange(option.value)}
                aria-pressed={hostMode === option.value}
                className={`rounded-lg border p-3 text-left transition ${
                  hostMode === option.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-bg hover:border-primary/50'
                }`}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-1 block text-xs text-muted">{option.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text transition hover:bg-border hover:text-bg dark:text-white"
          >
            {t('upload.dialogCancel')}
          </button>
          <button
            type="button"
            onClick={onPickFile}
            className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-400"
          >
            {t('upload.dialogPickFile')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
