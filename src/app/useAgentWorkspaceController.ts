import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  activeBoardAgentSessions,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  archiveAgentSession,
  createAgentSession,
  markAgentRuntimeFailure,
  rejectChangeProposal,
  runtimeBindingForSession,
  setAgentSessionRun,
} from '../core/agentSession';
import type { AgentMessageContextRef } from '../core/agentSessionContracts';
import { requestAgentRuntimeTurn } from '../core/agentRuntimeClient';
import { currentExecutionProviderSettings } from '../core/executionProviderPreferences';
import type { PackageComposerMention } from '../core/packageComposer';
import type { BoardSnapshot } from '../core/types';

interface AgentWorkspaceControllerOptions {
  persistSnapshot: (
    snapshot: BoardSnapshot,
    options?: { requireLocalApi?: boolean },
  ) => Promise<void>;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useAgentWorkspaceController(options: AgentWorkspaceControllerOptions) {
  const { persistSnapshot, snapshot, snapshotRef, updateSnapshot } = options;
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const inFlightRef = useRef(false);
  const sessions = activeBoardAgentSessions(snapshot);

  useEffect(() => {
    const currentStillExists = selectedSessionId
      ? sessions.some((session) => session.agentSessionId === selectedSessionId)
      : false;
    if (!currentStillExists) setSelectedSessionId(sessions[0]?.agentSessionId);
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    setSelectedSessionId(undefined);
    setError(undefined);
  }, [snapshot.board.boardId, snapshot.project.projectId]);

  function newSession(agentRunId?: string): string {
    let createdId = '';
    const settings = currentExecutionProviderSettings();
    const connection = settings?.connections.find((candidate) => candidate.connectionId === 'codex-app-server');
    updateSnapshot((current) => {
      const created = createAgentSession(current, {
        agentRunId,
        connectionId: connection?.connectionId,
        model: connection?.modelId,
      });
      createdId = created.session.agentSessionId;
      return current;
    }, { history: true, persist: true, syncFlow: false });
    setSelectedSessionId(createdId);
    setError(undefined);
    return createdId;
  }

  function selectSession(agentSessionId: string): void {
    setSelectedSessionId(agentSessionId);
    setError(undefined);
  }

  function selectAgentRun(agentRunId?: string): void {
    if (!selectedSessionId) return;
    updateSnapshot((current) => {
      setAgentSessionRun(current, selectedSessionId, agentRunId);
      return current;
    }, { persist: true, syncFlow: false });
  }

  function archiveSession(): void {
    if (!selectedSessionId) return;
    updateSnapshot((current) => {
      archiveAgentSession(current, selectedSessionId);
      return current;
    }, { history: true, persist: true, syncFlow: false });
    setSelectedSessionId(undefined);
  }

  function rejectProposal(proposalId: string): void {
    updateSnapshot((current) => {
      rejectChangeProposal(current, proposalId);
      return current;
    }, { persist: true, syncFlow: false });
  }

  async function submitMessage(input: {
    content: string;
    entrypointId?: string;
    mentions: PackageComposerMention[];
  }): Promise<void> {
    if (inFlightRef.current) return;
    const agentSessionId = selectedSessionId ?? newSession();
    inFlightRef.current = true;
    setIsSending(true);
    setError(undefined);
    let sourceMessageId = '';
    try {
      const contextRefs: AgentMessageContextRef[] = [
        ...(input.entrypointId ? [{ kind: 'entrypoint' as const, entrypointId: input.entrypointId }] : []),
        ...input.mentions,
      ];
      const withUserMessage = updateSnapshot((current) => {
        const message = appendAgentUserMessage(current, agentSessionId, {
          content: input.content,
          contextRefs,
        });
        sourceMessageId = message.agentMessageId;
        return current;
      }, { syncFlow: false });
      await persistSnapshot(withUserMessage, { requireLocalApi: true });
      const runtimeResult = await requestAgentRuntimeTurn({
        agentSessionId,
        boardId: withUserMessage.board.boardId,
        projectId: withUserMessage.project.projectId,
        sourceMessageId,
      });
      const withRuntimeResult = updateSnapshot((current) => {
        applyAgentRuntimeTurn(current, {
          agentSessionId,
          decision: runtimeResult.decision,
          externalThreadId: runtimeResult.externalThreadId,
          runtimeModel: runtimeResult.model,
          runtimeTurnId: runtimeResult.runtimeTurnId,
          sourceMessageId,
        });
        return current;
      }, { syncFlow: false });
      await persistSnapshot(withRuntimeResult, { requireLocalApi: true });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      if (snapshotRef.current?.agentSessions?.some((session) => session.agentSessionId === agentSessionId)) {
        const failed = updateSnapshot((current) => {
          markAgentRuntimeFailure(current, agentSessionId, message);
          return current;
        }, { syncFlow: false });
        await persistSnapshot(failed).catch(() => undefined);
      }
    } finally {
      inFlightRef.current = false;
      setIsSending(false);
    }
  }

  const selectedSession = sessions.find((session) => session.agentSessionId === selectedSessionId);
  const selectedBinding = selectedSession
    ? runtimeBindingForSession(snapshot, selectedSession.agentSessionId)
    : undefined;

  return {
    archiveSession,
    error,
    isSending,
    newSession,
    rejectProposal,
    selectAgentRun,
    selectedBinding,
    selectedSession,
    selectedSessionId,
    selectSession,
    sessions,
    submitMessage,
  };
}
