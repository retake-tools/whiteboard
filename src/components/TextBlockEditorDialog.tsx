import { FileText, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { blockLockedByGroup } from '../core/grouping';
import type { BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import './text-block-editor-dialog.css';

export function TextBlockEditorDialog({
  snapshot,
}: {
  snapshot: BoardSnapshot;
}): ReactElement | null {
  const { t } = useI18n();
  const [blockId, setBlockId] = useState<string>();
  const [initialBody, setInitialBody] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeBlock = blockId
    ? snapshot.blocks.find(
        (block) => block.blockId === blockId && block.type === 'text',
      )
    : undefined;
  const isDirty = draftBody !== initialBody;
  const isReadOnly = activeBlock
    ? blockLockedByGroup(snapshot, activeBlock.blockId)
    : true;

  function close(): void {
    setBlockId(undefined);
    setInitialBody('');
    setDraftBody('');
  }

  function save(): void {
    if (!activeBlock || isReadOnly) return;
    if (isDirty) {
      window.dispatchEvent(new CustomEvent('retake:update-text-block', {
        detail: { blockId: activeBlock.blockId, body: draftBody },
      }));
    }
    close();
  }

  useEffect(() => {
    function open(event: Event): void {
      const nextBlockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!nextBlockId) return;
      const block = snapshot.blocks.find(
        (candidate) => candidate.blockId === nextBlockId && candidate.type === 'text',
      );
      if (!block) return;
      const body = typeof block.data.body === 'string' ? block.data.body : '';
      setBlockId(block.blockId);
      setInitialBody(body);
      setDraftBody(body);
    }
    window.addEventListener('retake:open-text-block-editor', open);
    return () => window.removeEventListener('retake:open-text-block-editor', open);
  }, [snapshot.blocks]);

  useEffect(() => {
    if (!blockId) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape' && !isDirty) close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [blockId, isDirty]);

  useEffect(() => {
    close();
  }, [snapshot.board.boardId, snapshot.project.projectId]);

  if (!activeBlock) return null;

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    event.stopPropagation();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      save();
    }
  }

  return (
    <div
      className="text-block-editor-layer"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !isDirty) close();
      }}
    >
      <section
        aria-labelledby="text-block-editor-title"
        aria-modal="true"
        className="text-block-editor-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span><FileText size={14} />{t('textEditor.eyebrow')}</span>
            <h2 id="text-block-editor-title">
              {typeof activeBlock.data.title === 'string'
                ? activeBlock.data.title
                : t('textEditor.title')}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t('textEditor.close')}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        <textarea
          ref={textareaRef}
          aria-label={t('textEditor.body')}
          readOnly={isReadOnly}
          value={draftBody}
          onChange={(event) => setDraftBody(event.currentTarget.value)}
          onKeyDown={onEditorKeyDown}
        />
        <footer>
          <span>{isDirty ? t('textEditor.unsaved') : t('textEditor.saved')}</span>
          <div>
            <button type="button" onClick={close}>{t('textEditor.cancel')}</button>
            <button
              type="button"
              className="is-primary"
              disabled={isReadOnly || !isDirty}
              onClick={save}
            >
              {t('textEditor.save')}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
