import { X } from 'lucide-react';
import { useEffect, type ReactElement } from 'react';
import type { BlockRecord, BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import {
  ExecutionDetailContent,
  getExecutionDetailContextForBlock,
  type ExecutionDetailCopySource,
} from './ExecutionDetailContent';
import { TooltipIconButton } from './Tooltip';

interface CopyPromptInput {
  blockIds?: string[];
  copyKey: string;
  executionId?: string;
  prompt: string;
  source: ExecutionDetailCopySource;
}

interface ExecutionInspectorProps {
  copiedPromptKey?: string;
  selectedBlock?: BlockRecord;
  snapshot: BoardSnapshot;
  onClose: () => void;
  onCopyPrompt: (input: CopyPromptInput) => void | Promise<void>;
}

export function ExecutionInspector({
  copiedPromptKey,
  onClose,
  selectedBlock,
  snapshot,
  onCopyPrompt,
}: ExecutionInspectorProps): ReactElement | null {
  const { t } = useI18n();
  const context = selectedBlock ? getExecutionDetailContextForBlock(snapshot, selectedBlock) : undefined;
  const isOpen = Boolean(selectedBlock && context);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.execution-image-lightbox')) return;
      event.stopImmediatePropagation();
      onClose();
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [isOpen, onClose]);

  if (!selectedBlock || !context) return null;

  return (
    <aside className="execution-inspector" aria-label={t('inspector.title')}>
      <header>
        <div>
          <span>{t('inspector.title')}</span>
          <strong>{selectedBlock.data.title}</strong>
        </div>
        <TooltipIconButton label={t('inspector.close')} onClick={onClose}>
          <X size={15} />
        </TooltipIconButton>
      </header>

      <ExecutionDetailContent
        context={context}
        copiedPromptKey={copiedPromptKey}
        copyKey={`inspector:${context.execution.executionId}`}
        copySource="execution_inspector"
        onCopyPrompt={onCopyPrompt}
      />
    </aside>
  );
}
