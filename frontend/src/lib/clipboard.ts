export type ClipboardCopyMethod = 'clipboard-api' | 'exec-command';

export interface ClipboardCopyResult {
  ok: boolean;
  method?: ClipboardCopyMethod;
  error?: string;
}

interface ClipboardNavigatorLike {
  clipboard?: {
    writeText?: (text: string) => Promise<void>;
  };
}

interface ClipboardDocumentLike {
  body?: {
    appendChild: (node: HTMLTextAreaElement) => unknown;
    removeChild: (node: HTMLTextAreaElement) => unknown;
  };
  createElement?: (tagName: 'textarea') => HTMLTextAreaElement;
  execCommand?: (commandId: 'copy') => boolean;
}

interface CopyTextToClipboardOptions {
  navigator?: ClipboardNavigatorLike;
  document?: ClipboardDocumentLike;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Clipboard copy failed';
}

export function canUseExecCommandFallback(documentLike: ClipboardDocumentLike | undefined): boolean {
  return Boolean(
    documentLike?.body &&
    typeof documentLike.createElement === 'function' &&
    typeof documentLike.execCommand === 'function',
  );
}

export function copyTextWithExecCommand(
  text: string,
  documentLike: ClipboardDocumentLike | undefined = typeof document === 'undefined' ? undefined : document,
): boolean {
  if (!canUseExecCommandFallback(documentLike)) return false;

  const doc = documentLike as Required<Pick<ClipboardDocumentLike, 'body' | 'createElement' | 'execCommand'>>;
  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  doc.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    doc.body.removeChild(textarea);
  }
}

export async function copyTextToClipboard(
  text: string,
  options: CopyTextToClipboardOptions = {},
): Promise<ClipboardCopyResult> {
  const navigatorLike = options.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);
  const documentLike = options.document ?? (typeof document === 'undefined' ? undefined : document);

  let clipboardError: unknown;
  const writeText = navigatorLike?.clipboard?.writeText;
  if (typeof writeText === 'function') {
    try {
      await writeText.call(navigatorLike?.clipboard, text);
      return { ok: true, method: 'clipboard-api' };
    } catch (err) {
      clipboardError = err;
    }
  }

  if (copyTextWithExecCommand(text, documentLike)) {
    return { ok: true, method: 'exec-command' };
  }

  return { ok: false, error: errorToMessage(clipboardError) };
}
