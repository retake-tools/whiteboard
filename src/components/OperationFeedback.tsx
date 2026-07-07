import { Check, Clipboard, X } from 'lucide-react';
import { useEffect, type ReactElement } from 'react';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export interface OperationToast {
  id: string;
  title: string;
  body?: string;
  tone?: 'success' | 'error';
}

export interface PromptPreview {
  title: string;
  prompt: string;
  copyKey?: string;
  executionId?: string;
  blockIds?: string[];
}

interface OperationFeedbackProps {
  promptPreview?: PromptPreview;
  toast?: OperationToast;
  copiedPromptKey?: string;
  onClosePromptPreview: () => void;
  onCloseToast: () => void;
  onCopyPrompt: () => void | Promise<void>;
}

export function OperationFeedback({
  copiedPromptKey,
  promptPreview,
  toast,
  onClosePromptPreview,
  onCloseToast,
  onCopyPrompt,
}: OperationFeedbackProps): ReactElement {
  const { t } = useI18n();
  const isPromptCopied = Boolean(promptPreview?.copyKey && promptPreview.copyKey === copiedPromptKey);

  useEffect(() => {
    if (!promptPreview) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClosePromptPreview();
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onClosePromptPreview, promptPreview]);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => {
      onCloseToast();
    }, toast.tone === 'error' ? 6500 : 4200);

    return () => window.clearTimeout(timer);
  }, [onCloseToast, toast]);

  return (
    <>
      {toast ? (
        <div className={`operation-toast ${toast.tone === 'error' ? 'is-error' : ''}`} role="status">
          <div>
            <strong>{toast.title}</strong>
            {toast.body ? <span>{toast.body}</span> : null}
          </div>
          <TooltipIconButton label={t('common.dismiss')} onClick={onCloseToast}>
            <X size={15} />
          </TooltipIconButton>
        </div>
      ) : null}

      {promptPreview ? (
        <section className="prompt-preview" aria-label={t('feedback.promptTitle')}>
          <header>
            <h2>{promptPreview.title}</h2>
            <div>
              <TooltipIconButton label={t(isPromptCopied ? 'feedback.copied' : 'feedback.copyPrompt')} onClick={onCopyPrompt}>
                {isPromptCopied ? <Check size={15} /> : <Clipboard size={15} />}
              </TooltipIconButton>
              <TooltipIconButton label={t('feedback.closePrompt')} onClick={onClosePromptPreview}>
                <X size={15} />
              </TooltipIconButton>
            </div>
          </header>
          <pre>{promptPreview.prompt}</pre>
        </section>
      ) : null}
    </>
  );
}
