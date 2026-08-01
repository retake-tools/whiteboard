import { Bot, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { AgentSessionRecord } from '../core/agentSessionContracts';
import { useI18n } from '../i18n';
import { AgentRuntimeNewSessionMenu } from './AgentRuntimeNewSessionMenu';
import { AgentSessionHistoryMenu } from './AgentSessionHistoryMenu';
import { TooltipIconButton } from './Tooltip';

export function AgentWorkspaceHeader({
  onArchiveSession,
  onClose,
  onCreateSession,
  onRenameSession,
  onSelectSession,
  projectId,
  runtimeLabel,
  selectedSession,
  sessions,
}: {
  onArchiveSession: () => void;
  onClose: () => void;
  onCreateSession: (connectionId?: string) => void;
  onRenameSession: (title: string) => boolean;
  onSelectSession: (agentSessionId: string) => void;
  projectId: string;
  runtimeLabel?: string;
  selectedSession?: AgentSessionRecord;
  sessions: AgentSessionRecord[];
}): ReactElement {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(selectedSession?.title ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const ignoreBlurRef = useRef(false);
  const title = selectedSession?.title ?? t('agentWorkspace.defaultSession');

  useEffect(() => {
    setDraft(selectedSession?.title ?? '');
    setEditing(false);
  }, [selectedSession?.agentSessionId, selectedSession?.title]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function startEditing(): void {
    if (!selectedSession) return;
    ignoreBlurRef.current = false;
    setDraft(selectedSession.title);
    setEditing(true);
  }

  function commit(): void {
    if (!selectedSession) return;
    const normalized = draft.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      setDraft(selectedSession.title);
      setEditing(false);
      return;
    }
    if (normalized === selectedSession.title || onRenameSession(normalized)) {
      setEditing(false);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    ignoreBlurRef.current = true;
    setDraft(selectedSession?.title ?? '');
    setEditing(false);
  }

  return (
    <header>
      <div className="agent-workspace-heading">
        <div className="agent-workspace-name-row">
          <Bot size={16} />
          {editing ? (
            <input
              ref={inputRef}
              aria-label={t('agentWorkspace.renameSession')}
              className="agent-workspace-name-input"
              maxLength={80}
              value={draft}
              onBlur={() => {
                if (ignoreBlurRef.current) {
                  ignoreBlurRef.current = false;
                  return;
                }
                commit();
              }}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={onEditorKeyDown}
            />
          ) : (
            <button
              type="button"
              className="agent-workspace-name"
              disabled={!selectedSession}
              title={t('agentWorkspace.renameSessionHint')}
              onDoubleClick={startEditing}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== 'F2') return;
                event.preventDefault();
                startEditing();
              }}
            >
              {title}
            </button>
          )}
        </div>
        {runtimeLabel ? (
          <small className="agent-workspace-runtime-label">{runtimeLabel}</small>
        ) : null}
      </div>
      <div className="agent-workspace-header-actions">
        <AgentSessionHistoryMenu
          selectedSession={selectedSession}
          sessions={sessions}
          onArchiveSession={onArchiveSession}
          onSelectSession={onSelectSession}
        />
        <AgentRuntimeNewSessionMenu
          onCreateSession={onCreateSession}
          projectId={projectId}
        />
        <TooltipIconButton
          className="icon-button"
          label={t('context.close')}
          onClick={onClose}
        >
          <X size={15} />
        </TooltipIconButton>
      </div>
    </header>
  );
}
