import { Activity, Archive, Check, ListTodo, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { AgentSessionRecord } from '../core/agentSessionContracts';
import { agentTaskOverviewForBoard } from '../core/agentTaskOverview';
import type { AgentRunStatus } from '../core/agentRuntimeContracts';
import type { BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export function AgentSessionHistoryMenu({
  onArchiveSession,
  onSelectSession,
  selectedSession,
  sessions,
  snapshot,
}: {
  onArchiveSession: () => Promise<void>;
  onSelectSession: (agentSessionId: string) => void;
  selectedSession?: AgentSessionRecord;
  sessions: AgentSessionRecord[];
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tasks = useMemo(
    () => agentTaskOverviewForBoard(snapshot, sessions),
    [sessions, snapshot.agentRuns, snapshot.blocks, snapshot.workflowRuns, snapshot.workflowStepRuns],
  );
  const activeTaskCount = tasks.filter((item) => item.isActive).length;
  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return tasks;
    return tasks.filter((item) =>
      [item.session.title, item.taskTitle, item.currentStepTitle]
        .some((value) => value?.toLocaleLowerCase().includes(normalized)),
    );
  }, [query, tasks]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="agent-session-history">
      <TooltipIconButton
        buttonRef={triggerRef}
        className="icon-button"
        isPressed={isOpen}
        label={t('agentWorkspace.taskOverview')}
        onClick={() => {
          setIsOpen((current) => !current);
          setQuery('');
        }}
      >
        <ListTodo size={15} />
        {activeTaskCount > 0 ? <span className="agent-task-count">{activeTaskCount}</span> : null}
      </TooltipIconButton>
      {isOpen ? (
        <section className="agent-session-history-popover" aria-label={t('agentWorkspace.taskOverview')}>
          <header>
            <strong>{t('agentWorkspace.taskOverview')}</strong>
            <span>{t('agentWorkspace.activeTaskCount').replace('{count}', String(activeTaskCount))}</span>
          </header>
          <label>
            <Search size={14} />
            <input
              autoFocus
              aria-label={t('agentWorkspace.searchSessions')}
              placeholder={t('agentWorkspace.searchSessions')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="agent-session-history-list">
            {filteredTasks.map((item) => (
              <button
                key={item.session.agentSessionId}
                type="button"
                className={item.session.agentSessionId === selectedSession?.agentSessionId ? 'is-active' : ''}
                onClick={() => {
                  onSelectSession(item.session.agentSessionId);
                  setIsOpen(false);
                  requestAnimationFrame(() => triggerRef.current?.focus());
                }}
              >
                <span>
                  <span className="agent-task-title-row">
                    <strong>{item.session.title}</strong>
                    {item.runStatus ? (
                      <em className={item.isActive ? 'is-running' : ''}>
                        {t(agentRunStatusKey(item.runStatus))}
                      </em>
                    ) : null}
                  </span>
                  <small>{item.taskTitle ?? t('agentWorkspace.noTask')}</small>
                  {item.currentStepTitle ? (
                    <small className="agent-task-step">
                      <Activity size={10} />
                      {item.currentStepTitle}
                      {item.totalSteps ? ` · ${item.completedSteps ?? 0}/${item.totalSteps}` : ''}
                    </small>
                  ) : <small>{formatSessionTime(item.session.updatedAt)}</small>}
                </span>
                {item.session.agentSessionId === selectedSession?.agentSessionId ? <Check size={14} /> : null}
              </button>
            ))}
            {filteredTasks.length === 0 ? <p>{t('agentWorkspace.noMatchingSessions')}</p> : null}
          </div>
          <footer>
            <button
              type="button"
              disabled={!selectedSession}
              onClick={() => void (async () => {
                await onArchiveSession();
                setIsOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              })()}
            >
              <Archive size={14} />
              {t('agentWorkspace.archiveSession')}
            </button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}

function agentRunStatusKey(status: AgentRunStatus) {
  return `agentRuntime.status.${status}` as const;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });
}
