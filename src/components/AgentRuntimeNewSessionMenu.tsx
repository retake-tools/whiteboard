import { Bot, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  currentExecutionProviderSettings,
  readyAgentRuntimeConnections,
  resolveAgentRuntimeConnectionPreference,
} from '../core/executionProviderPreferences';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export function AgentRuntimeNewSessionMenu({
  onCreateSession,
  projectId,
}: {
  onCreateSession: (connectionId?: string) => void;
  projectId: string;
}): ReactElement {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const settings = currentExecutionProviderSettings();
  const defaultRuntime = resolveAgentRuntimeConnectionPreference({ projectId, settings });
  const connections = readyAgentRuntimeConnections(settings);

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

  function createSession(connectionId?: string): void {
    onCreateSession(connectionId);
    setIsOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div ref={rootRef} className="agent-runtime-new-session">
      <TooltipIconButton
        buttonRef={triggerRef}
        className="icon-button"
        isPressed={isOpen}
        label={t('agentWorkspace.newSession')}
        onClick={() => setIsOpen((current) => !current)}
      >
        <Plus size={15} />
      </TooltipIconButton>
      {isOpen ? (
        <section
          className="agent-runtime-new-session-popover"
          aria-label={t('agentWorkspace.chooseRuntime')}
        >
          <header>
            <strong>{t('agentWorkspace.newSession')}</strong>
            <span>{t('agentWorkspace.chooseRuntime')}</span>
          </header>
          <div>
            <button
              type="button"
              disabled={!defaultRuntime.isUsable}
              onClick={() => createSession()}
            >
              <Bot size={15} />
              <span>
                <strong>{t('agentWorkspace.useDefaultRuntime')}</strong>
                <small>{runtimeConnectionLabel(defaultRuntime.connection, defaultRuntime.connectionId)}</small>
              </span>
            </button>
            {connections.map((connection) => (
              <button
                key={connection.connectionId}
                type="button"
                onClick={() => createSession(connection.connectionId)}
              >
                <Bot size={15} />
                <span>
                  <strong>{connection.displayName}</strong>
                  <small>{connection.modelId}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function runtimeConnectionLabel(
  connection: ReturnType<typeof readyAgentRuntimeConnections>[number] | undefined,
  connectionId: string,
): string {
  if (!connection) return connectionId;
  return `${connection.displayName}${connection.modelId ? ` · ${connection.modelId}` : ''}`;
}
