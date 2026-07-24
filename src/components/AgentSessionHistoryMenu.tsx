import { Archive, Check, History, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { AgentSessionRecord } from '../core/agentSessionContracts';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export function AgentSessionHistoryMenu({
  onArchiveSession,
  onSelectSession,
  selectedSession,
  sessions,
}: {
  onArchiveSession: () => void;
  onSelectSession: (agentSessionId: string) => void;
  selectedSession?: AgentSessionRecord;
  sessions: AgentSessionRecord[];
}): ReactElement {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return sessions;
    return sessions.filter((session) => session.title.toLocaleLowerCase().includes(normalized));
  }, [query, sessions]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
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
        className="icon-button"
        isPressed={isOpen}
        label={t('agentWorkspace.history')}
        onClick={() => {
          setIsOpen((current) => !current);
          setQuery('');
        }}
      >
        <History size={15} />
      </TooltipIconButton>
      {isOpen ? (
        <section className="agent-session-history-popover" aria-label={t('agentWorkspace.history')}>
          <header>
            <strong>{t('agentWorkspace.history')}</strong>
            <span>{sessions.length}</span>
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
            {filteredSessions.map((session) => (
              <button
                key={session.agentSessionId}
                type="button"
                className={session.agentSessionId === selectedSession?.agentSessionId ? 'is-active' : ''}
                onClick={() => {
                  onSelectSession(session.agentSessionId);
                  setIsOpen(false);
                }}
              >
                <span>
                  <strong>{session.title}</strong>
                  <small>{formatSessionTime(session.updatedAt)}</small>
                </span>
                {session.agentSessionId === selectedSession?.agentSessionId ? <Check size={14} /> : null}
              </button>
            ))}
            {filteredSessions.length === 0 ? <p>{t('agentWorkspace.noMatchingSessions')}</p> : null}
          </div>
          <footer>
            <button
              type="button"
              disabled={!selectedSession}
              onClick={() => {
                onArchiveSession();
                setIsOpen(false);
              }}
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
