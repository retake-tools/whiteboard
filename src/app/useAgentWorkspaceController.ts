import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  activeBoardAgentSessions,
  agentSessionForRun,
  runtimeBindingForSession,
} from '../core/agentSession';
import type {
  AgentDraftAppliedEffect,
  AgentDraftLaunchTarget,
  AgentMessageContextRef,
  AgentRuntimeKind,
  AgentRuntimeTurnResult,
  GoalPlanDraftLaunchCommand,
  PackageEntrypointDraftLaunchCommand,
  WorkflowLaunchPreferences,
} from '../core/agentSessionContracts';
import type { WorkflowExecutionMode } from '../components/UnifiedComposerProvider';
import type { ComposerImageReferenceSetting } from '../core/referenceIntent';
import { loadBoardSnapshot } from '../core/boardStore';
import { requestAgentRuntimeTurn } from '../core/agentRuntimeClient';
import { assertAgentRunCanBeSupersededForLaunch } from '../core/agentRuntime';
import {
  currentExecutionProviderSettings,
  resolveAgentRuntimeConnectionPreference,
  resolveAgentExecutionConnection,
} from '../core/executionProviderPreferences';
import { reconcileAgentArtifactTarget } from '../core/agentArtifactTargetClient';
import type { PackageComposerMention } from '../core/packageComposer';
import type { BoardSnapshot } from '../core/types';
import { createFlowNodes } from '../core/flowProjection';
import {
  buildPackageEntrypointDraftLaunchCommand,
} from '../core/packageEntrypointAgentLaunchApplication';
import {
  buildGoalPlanDraftLaunchCommand,
} from '../core/goalPlanAgentLaunchApplication';
import {
  imageOperationDefaultPrompt,
  imageOperationTitle,
} from '../core/imageOperationText';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import { imageGenerateCapabilityId } from '../core/imageGenerateContracts';
import { reconcileWorkflowArtifactGates } from '../core/workflowArtifactGateClient';
import { workflowDefinitionFor } from '../core/workflowRegistry';
import type { useI18n } from '../i18n';
import { textGenerationLabelsForSkill } from './skillTextLabels';
import {
  loadSelectedAgentSessionId,
  resolveSelectedAgentSessionId,
  saveSelectedAgentSessionId,
} from '../core/agentWorkspaceViewState';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';
import { createAgentDraftPresentation } from './agentDraftPresentation';

interface AgentWorkspaceControllerOptions {
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  focusWorkflowBlocks: (blockIds: string[]) => void;
  getViewportCenter: () => { x: number; y: number };
  locale: string;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  selectedBlockIdsRef: RefObject<string[]>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useAgentWorkspaceController(options: AgentWorkspaceControllerOptions) {
  const {
    adoptDurableSnapshot,
    focusWorkflowBlocks,
    getViewportCenter,
    locale,
    runProductCommand,
    selectedBlockIdsRef,
    setSelectedBlocks,
    snapshot,
    snapshotRef,
    t,
  } = options;
  const agentWorkspaceBoardKey = `${snapshot.project.projectId}:${snapshot.board.boardId}`;
  const [selectedSessionIdsByBoard, setSelectedSessionIdsByBoard] = useState<Record<string, string>>(() => {
    const savedSessionId = loadSelectedAgentSessionId(
      snapshot.project.projectId,
      snapshot.board.boardId,
    );
    return savedSessionId ? { [agentWorkspaceBoardKey]: savedSessionId } : {};
  });
  const selectedSessionId = selectedSessionIdsByBoard[agentWorkspaceBoardKey];
  const [sendingSessionIds, setSendingSessionIds] = useState<Set<string>>(() => new Set());
  const [launchingProposalBySession, setLaunchingProposalBySession] = useState<Record<string, string>>({});
  const [focusedAgentRunId, setFocusedAgentRunId] = useState<string>();
  const [errorsBySession, setErrorsBySession] = useState<Record<string, string | undefined>>({});
  const inFlightSessionIdsRef = useRef(new Set<string>());
  const launchStateRef = useRef({
    inFlightSessionIds: new Set<string>(),
    selectedSessionId,
  });
  const sessions = activeBoardAgentSessions(snapshot);
  launchStateRef.current.selectedSessionId = selectedSessionId;

  useEffect(() => {
    const currentStillExists = selectedSessionId
      ? sessions.some((session) => session.agentSessionId === selectedSessionId)
      : false;
    if (currentStillExists) return;
    const savedSessionId = loadSelectedAgentSessionId(
      snapshot.project.projectId,
      snapshot.board.boardId,
    );
    const nextSessionId = resolveSelectedAgentSessionId(
      sessions.map((session) => session.agentSessionId),
      selectedSessionId,
      savedSessionId,
    );
    if (selectedSessionId !== nextSessionId) {
      setSelectedSessionId(nextSessionId);
    } else if (!nextSessionId && savedSessionId) {
      saveSelectedAgentSessionId(snapshot.project.projectId, snapshot.board.boardId, undefined);
    }
  }, [selectedSessionId, sessions, snapshot.board.boardId, snapshot.project.projectId]);

  useEffect(() => {
    setFocusedAgentRunId(undefined);
    setLaunchingProposalBySession({});
    setErrorsBySession({});
    setSendingSessionIds(new Set());
    inFlightSessionIdsRef.current.clear();
    launchStateRef.current.inFlightSessionIds.clear();
  }, [snapshot.board.boardId, snapshot.project.projectId]);

  function setSelectedSessionId(agentSessionId: string | undefined): void {
    setSelectedSessionIdsByBoard((current) => {
      if (current[agentWorkspaceBoardKey] === agentSessionId) return current;
      const next = { ...current };
      if (agentSessionId) next[agentWorkspaceBoardKey] = agentSessionId;
      else delete next[agentWorkspaceBoardKey];
      return next;
    });
    saveSelectedAgentSessionId(
      snapshot.project.projectId,
      snapshot.board.boardId,
      agentSessionId,
    );
  }

  async function newSession(connectionId?: string, agentRunId?: string): Promise<string> {
    const connection = currentAgentConnection(connectionId);
    const created = await requireProductCommands(runProductCommand)(
      (commands) => commands.agentWorkspace.createSession({
        agentRunId,
        connection: agentWorkspaceConnection(connection),
      }),
      { history: true, syncFlow: false },
    );
    setSelectedSessionId(created.agentSessionId);
    setSessionError(created.agentSessionId, undefined);
    return created.agentSessionId;
  }

  async function ensureDefaultSession(): Promise<string> {
    const existingSessionId = resolveSelectedAgentSessionId(
      sessions.map((session) => session.agentSessionId),
      selectedSessionId,
    );
    const existing = sessions.find((session) => session.agentSessionId === existingSessionId);
    if (existing) {
      setSelectedSessionId(existing.agentSessionId);
      setSessionError(existing.agentSessionId, undefined);
      return existing.agentSessionId;
    }
    const connection = currentAgentConnection();
    const resolved = await requireProductCommands(runProductCommand)(
      (commands) => commands.agentWorkspace.ensureDefaultSession({
        connection: agentWorkspaceConnection(connection),
        title: t('agentWorkspace.defaultSession'),
      }),
      { syncFlow: false },
    );
    setSelectedSessionId(resolved.agentSessionId);
    setSessionError(resolved.agentSessionId, undefined);
    return resolved.agentSessionId;
  }

  function selectSession(agentSessionId: string): void {
    setSelectedSessionId(agentSessionId);
  }

  async function renameSession(title: string): Promise<boolean> {
    if (!selectedSessionId) return false;
    try {
      await requireProductCommands(runProductCommand)(
        (commands) => commands.agentWorkspace.renameSession({
          agentSessionId: selectedSessionId,
          title,
        }),
        { history: true, syncFlow: false },
      );
      setSessionError(selectedSessionId, undefined);
      return true;
    } catch (caught) {
      setSessionError(selectedSessionId, caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  }

  async function selectAgentRun(agentRunId?: string): Promise<void> {
    if (!selectedSessionId) return;
    if (agentRunId) {
      const owner = agentSessionForRun(snapshotRef.current, agentRunId);
      if (owner && owner.agentSessionId !== selectedSessionId) {
        setSelectedSessionId(owner.agentSessionId);
        setFocusedAgentRunId(agentRunId);
        setSessionError(owner.agentSessionId, undefined);
        return;
      }
    }
    await requireProductCommands(runProductCommand)(
      (commands) => commands.agentWorkspace.bindRun({
        agentRunId,
        agentSessionId: selectedSessionId,
      }),
      { syncFlow: false },
    );
  }

  async function focusAgentRun(agentRunId: string): Promise<void> {
    const owner = agentSessionForRun(snapshotRef.current, agentRunId);
    if (owner) {
      setSelectedSessionId(owner.agentSessionId);
      setFocusedAgentRunId(agentRunId);
      setSessionError(owner.agentSessionId, undefined);
      return;
    }
    const agentSessionId = selectedSessionId ?? await ensureDefaultSession();
    await requireProductCommands(runProductCommand)(
      (commands) => commands.agentWorkspace.bindRun({ agentRunId, agentSessionId }),
      { syncFlow: false },
    );
    setSelectedSessionId(agentSessionId);
    setFocusedAgentRunId(agentRunId);
    setSessionError(agentSessionId, undefined);
  }

  async function bindWorkingOperation(operationBlockId: string): Promise<void> {
    const agentSessionId = selectedSessionId ?? await ensureDefaultSession();
    await requireProductCommands(runProductCommand)(
      (commands) => commands.agentWorkspace.bindWorkingOperation({
        agentSessionId,
        operationBlockId,
      }),
      { syncFlow: false },
    );
    setSelectedSessionId(agentSessionId);
    setSessionError(agentSessionId, undefined);
  }

  async function archiveSession(): Promise<void> {
    if (!selectedSessionId) return;
    const connection = currentAgentConnection();
    const archived = await requireProductCommands(runProductCommand)(
      (commands) => commands.agentWorkspace.archiveSession({
        agentSessionId: selectedSessionId,
        defaultConnection: agentWorkspaceConnection(connection),
        defaultTitle: t('agentWorkspace.defaultSession'),
      }),
      { history: true, syncFlow: false },
    );
    setSelectedSessionId(archived.selectedSessionId);
    setSessionError(archived.selectedSessionId, undefined);
  }

  async function decideProposal(
    proposalId: string,
    expectedProposalVersion: number,
    decision: 'approve' | 'reject',
    workflowPreferences?: WorkflowLaunchPreferences,
  ): Promise<void> {
    const ownerSessionId = snapshotRef.current.changeProposals?.find(
      (proposal) => proposal.proposalId === proposalId,
    )?.agentSessionId;
    if (!ownerSessionId || launchStateRef.current.inFlightSessionIds.has(ownerSessionId)) return;
    launchStateRef.current.inFlightSessionIds.add(ownerSessionId);
    setLaunchingProposal(ownerSessionId, proposalId);
    try {
      const decided = await decideProposalCommand({
        decision,
        expectedProposalVersion,
        proposalId,
        workflowPreferences,
      });
      const effect = decided.appliedEffect;
      if (effect) {
        setSelectedBlocks(snapshotRef.current, [effect.primaryBlockId]);
        focusWorkflowBlocks(agentDraftFocusBlockIds(snapshotRef.current, effect));
      }
      if (
        decision === 'approve'
        && effect?.kind === 'package_entrypoint_draft'
        && effect.entrypointKind === 'workflow'
      ) {
        const command = buildPackageEntrypointDraftLaunchCommand({
          agentSessionId: decided.agentSessionId,
          expectedProposalVersion: decided.proposalVersion,
          proposalId,
          target: { kind: 'workflow_run' },
        });
        await launchDraftCommand(command, { kind: 'workflow_run' });
      } else if (
        decision === 'approve'
        && decided.proposalKind === 'plan_skill'
        && effect?.kind === 'package_entrypoint_draft'
        && effect.entrypointKind === 'skill'
      ) {
        const command = buildPackageEntrypointDraftLaunchCommand({
          agentSessionId: decided.agentSessionId,
          expectedProposalVersion: decided.proposalVersion,
          proposalId,
          target: { kind: 'capability' },
        });
        await launchDraftCommand(command, { kind: 'capability' });
      } else if (
        decision === 'approve'
        && effect?.kind === 'goal_plan_draft'
      ) {
        const command = buildGoalPlanDraftLaunchCommand({
          agentSessionId: decided.agentSessionId,
          expectedProposalVersion: decided.proposalVersion,
          proposalId,
        });
        await launchDraftCommand(command, { kind: 'goal' });
      }
      setSessionError(ownerSessionId, undefined);
    } catch (caught) {
      setSessionError(ownerSessionId, caught instanceof Error ? caught.message : String(caught));
    } finally {
      launchStateRef.current.inFlightSessionIds.delete(ownerSessionId);
      setLaunchingProposal(ownerSessionId, undefined);
    }
  }

  async function decideProposalCommand(input: {
    decision: 'approve' | 'reject';
    expectedProposalVersion: number;
    explicitConnectionId?: string;
    proposalId: string;
    workflowPreferences?: WorkflowLaunchPreferences;
  }) {
    return requireProductCommands(runProductCommand)(
      (commands) => commands.agentWorkspace.decideProposal({
        decision: input.decision,
        expectedProposalVersion: input.expectedProposalVersion,
        presentation: createAgentDraftPresentation({
          explicitConnectionId: input.explicitConnectionId,
          locale,
          placementCenter: getViewportCenter(),
          proposalId: input.proposalId,
          snapshot: snapshotRef.current,
          t,
        }),
        proposalId: input.proposalId,
        workflowPreferences: input.workflowPreferences,
      }),
      { history: true },
    );
  }

  function focusProposalEffect(proposalId: string): void {
    const effect = snapshot.changeProposals?.find(
      (proposal) => proposal.proposalId === proposalId,
    )?.appliedEffect;
    if (!effect) return;
    setSelectedBlocks(snapshot, [effect.primaryBlockId]);
    focusWorkflowBlocks(agentDraftFocusBlockIds(snapshot, effect));
  }

  async function launchProposal(
    proposalId: string,
    expectedProposalVersion: number,
    target: AgentDraftLaunchTarget,
    agentPresetEntryPointId?: string,
  ): Promise<void> {
    if (!selectedSessionId || launchStateRef.current.inFlightSessionIds.has(selectedSessionId)) return;
    const launchSessionId = selectedSessionId;
    let command: GoalPlanDraftLaunchCommand | PackageEntrypointDraftLaunchCommand | undefined;
    launchStateRef.current.inFlightSessionIds.add(launchSessionId);
    setLaunchingProposal(launchSessionId, proposalId);
    setSessionError(launchSessionId, undefined);
    try {
      command = target.kind === 'goal'
        ? buildGoalPlanDraftLaunchCommand({
            agentPresetEntryPointId,
            agentSessionId: launchSessionId,
            expectedProposalVersion,
            proposalId,
          })
        : buildPackageEntrypointDraftLaunchCommand({
            agentPresetEntryPointId,
            agentSessionId: launchSessionId,
            expectedProposalVersion,
            proposalId,
            target,
          });
      await launchDraftCommand(command, target);
    } catch (caught) {
      const scope = snapshotRef.current;
      try {
        const authoritative = await loadBoardSnapshot({
          boardId: scope.board.boardId,
          projectId: scope.project.projectId,
        });
        const idempotencyKey = command?.idempotencyKey;
        const recovered = idempotencyKey ? authoritative.changeProposals?.find(
          (proposal) =>
            proposal.proposalId === proposalId
            && proposal.draftLaunchEffect?.idempotencyKey === idempotencyKey,
        )?.draftLaunchEffect : undefined;
        if (recovered) {
          if (isCurrentBoardScope(authoritative.project.projectId, authoritative.board.boardId)) {
            adoptDurableSnapshot(authoritative);
            focusLaunch(recovered.agentRunId, recovered.agentSessionId);
          }
          return;
        }
      } catch {
        // Preserve the original launch error when authoritative recovery is unavailable.
      }
      setSessionError(launchSessionId, caught instanceof Error ? caught.message : String(caught));
    } finally {
      launchStateRef.current.inFlightSessionIds.delete(launchSessionId);
      setLaunchingProposal(launchSessionId, undefined);
    }
  }

  function focusLaunch(agentRunId: string, agentSessionId: string): void {
    if (!launchStateRef.current.selectedSessionId || launchStateRef.current.selectedSessionId === agentSessionId) {
      setSelectedSessionId(agentSessionId);
      setFocusedAgentRunId(agentRunId);
    }
    setSessionError(agentSessionId, undefined);
  }

  async function launchDraftCommand(
    command: GoalPlanDraftLaunchCommand | PackageEntrypointDraftLaunchCommand,
    target: AgentDraftLaunchTarget,
  ): Promise<void> {
    const launched = await requireProductCommands(runProductCommand)(
      (commands) => commands.agentWorkspace.launchDraft({ command }),
      { history: true },
    );
    const authoritative = await reconcileDraftLaunchTarget({
      agentRunId: launched.agentRunId,
      boardId: launched.boardId,
      projectId: launched.projectId,
      target,
      workflowRunId: launched.workflowRunId,
    });
    if (!isCurrentBoardScope(launched.projectId, launched.boardId)) return;
    if (authoritative) adoptDurableSnapshot(authoritative);
    focusLaunch(launched.agentRunId, launched.agentSessionId);
  }

  function isCurrentBoardScope(projectId: string, boardId: string): boolean {
    return snapshotRef.current.project.projectId === projectId
      && snapshotRef.current.board.boardId === boardId;
  }

  function focusProposalRun(proposalId: string): void {
    const effect = snapshot.changeProposals?.find(
      (proposal) => proposal.proposalId === proposalId,
    )?.draftLaunchEffect;
    if (!effect) return;
    setSelectedSessionId(effect.agentSessionId);
    setFocusedAgentRunId(effect.agentRunId);
  }
  async function submitMessage(input: {
    agentPreferences: {
      aspectRatioPreset?: string;
      connectionId?: string;
      outputType: 'auto' | 'image' | 'video';
      targetResolution?: string;
      variationCount?: 1 | 2 | 3 | 4;
    };
    content: string;
    entrypointId?: string;
    imageReferenceSettings: Record<string, ComposerImageReferenceSetting>;
    inlineValues: Extract<AgentMessageContextRef, { kind: 'inline' }>[];
    mentions: PackageComposerMention[];
    parameters: Record<string, unknown>;
    suggestionAction?: {
      operationBlockId?: string;
      sourceMessageId: string;
    };
    workflowExecutionMode?: WorkflowExecutionMode;
  }): Promise<void> {
    const agentSessionId = selectedSessionId ?? await ensureDefaultSession();
    if (inFlightSessionIdsRef.current.has(agentSessionId)) return;
    inFlightSessionIdsRef.current.add(agentSessionId);
    setSessionSending(agentSessionId, true);
    setSessionError(agentSessionId, undefined);
    let sourceMessageId = '';
    let requestedAgentRuntime = false;
    let receivedAgentRuntimeResult = false;
    let operationApplicationAttempted = false;
    let runtimeResult: AgentRuntimeTurnResult | undefined;
    try {
      const contextRefs: AgentMessageContextRef[] = [
        {
          kind: 'agent_preferences',
          ...structuredClone(input.agentPreferences),
        },
        ...(input.entrypointId ? [{ kind: 'entrypoint' as const, entrypointId: input.entrypointId }] : []),
        ...(input.workflowExecutionMode
          ? [{ kind: 'workflow_interaction_mode' as const, mode: input.workflowExecutionMode }]
          : []),
        ...(input.suggestionAction ? [{
          action: 'run' as const,
          kind: 'agent_suggestion_action' as const,
          sourceMessageId: input.suggestionAction.sourceMessageId,
        }] : []),
        ...(input.suggestionAction?.operationBlockId ? [{
          kind: 'operation' as const,
          operationBlockId: input.suggestionAction.operationBlockId,
        }] : []),
        ...canvasImageSelectionRefs(snapshotRef.current, selectedBlockIdsRef.current),
        ...Object.entries(input.imageReferenceSettings)
          .filter(([, setting]) => setting.mode !== 'auto')
          .map(([mentionId, setting]) => ({
            instruction: setting.instruction,
            kind: 'image_reference_setting' as const,
            mentionId,
            mode: setting.mode,
          })),
        ...input.inlineValues,
        ...input.mentions,
        ...(Object.keys(input.parameters).length > 0
          ? [{ kind: 'parameters' as const, value: structuredClone(input.parameters) }]
          : []),
      ];
      const appendedMessage = await requireProductCommands(runProductCommand)(
        (commands) => commands.agentWorkspace.appendMessage({
          agentSessionId,
          content: input.content,
          contextRefs,
        }),
        { syncFlow: false },
      );
      sourceMessageId = appendedMessage.agentMessageId;
      if (input.suggestionAction?.operationBlockId) {
        operationApplicationAttempted = true;
        const authorized = await requireProductCommands(runProductCommand)(
          (commands) => commands.agentWorkspace.authorizeOperationSuggestion({
            agentSessionId,
            operationBlockId: input.suggestionAction!.operationBlockId!,
            presentation: agentOperationPresentation(
              undefined,
              input.agentPreferences.connectionId,
            ),
            sourceMessageId,
          }),
          { history: true, syncFlow: true },
        );
        revealStagedAgentOperation(authorized);
        return;
      }
      if (input.workflowExecutionMode) {
        const workflowInteractionMode = input.workflowExecutionMode;
        const launchSession = (snapshotRef.current.agentSessions ?? []).find(
          (session) => session.agentSessionId === agentSessionId,
        );
        assertAgentRunCanBeSupersededForLaunch(
          snapshotRef.current,
          launchSession?.activeAgentRunId,
        );
        const createdProposal = await requireProductCommands(runProductCommand)(
          (commands) => commands.agentWorkspace.createEntrypointProposal({
            agentSessionId,
            explanation: t('agentWorkspace.workflowDirectStartSummary'),
            sourceMessageId,
          }),
          { history: true, syncFlow: false },
        );
        const proposalId = createdProposal.proposalId;
        const proposal = snapshotRef.current.changeProposals?.find(
          (candidate) => candidate.proposalId === proposalId,
        );
        const invocation = proposal?.proposedCommand.kind === 'package_entrypoint.instantiate'
          ? proposal.proposedCommand.invocation
          : undefined;
        const workflowDefinition = invocation?.targetLock.entrypointKind === 'workflow'
          ? workflowDefinitionFor(
              invocation.targetLock.workflowDefinitionLock.workflowDefinitionId,
            )
          : undefined;
        const conceptStep = workflowDefinition?.steps.find((step) => (
          step.capabilityLock.capabilityId === imageGenerateCapabilityId
          && step.outputAcceptancePolicy === 'manual_single'
        ));
        const workflowPreferences: WorkflowLaunchPreferences = {
          ...(workflowDefinition?.steps.some(
            (step) => step.capabilityLock.capabilityId === imageGenerateCapabilityId,
          ) ? {
              aspectRatioPreset: input.agentPreferences.aspectRatioPreset,
              connectionId: input.agentPreferences.connectionId,
              targetResolution: input.agentPreferences.targetResolution,
            } : {}),
          ...(conceptStep && input.agentPreferences.variationCount
            ? {
                conceptStepId: conceptStep.stepId,
                conceptVariationCount: input.agentPreferences.variationCount,
              }
            : {}),
          interactionMode: workflowInteractionMode,
        };
        const decided = await decideProposalCommand({
          decision: 'approve',
          expectedProposalVersion: createdProposal.proposalVersion,
          explicitConnectionId: input.agentPreferences.connectionId,
          proposalId,
          workflowPreferences,
        });
        const appliedEffect = decided.appliedEffect;
        if (appliedEffect) {
          setSelectedBlocks(snapshotRef.current, [appliedEffect.primaryBlockId]);
          focusWorkflowBlocks(agentDraftFocusBlockIds(snapshotRef.current, appliedEffect));
        }
        const launchCommand = buildPackageEntrypointDraftLaunchCommand({
          agentSessionId,
          expectedProposalVersion: decided.proposalVersion,
          proposalId,
          target: { kind: 'workflow_run' },
        });
        await launchDraftCommand(launchCommand, { kind: 'workflow_run' });
        return;
      }
      requestedAgentRuntime = true;
      const completedRuntimeResult = await requestAgentRuntimeTurn({
        agentSessionId,
        boardId: appendedMessage.boardId,
        projectId: appendedMessage.projectId,
        sourceMessageId,
      }, async (event) => {
        await requireProductCommands(runProductCommand)(
          (commands) => commands.agentWorkspace.appendRuntimeEvent({ event, sourceMessageId }),
          { syncFlow: false },
        );
      });
      runtimeResult = completedRuntimeResult;
      receivedAgentRuntimeResult = true;
      operationApplicationAttempted = completedRuntimeResult.decision.kind === 'operation_create_execute'
        || completedRuntimeResult.decision.kind === 'operation_execute';
      const capabilityId = completedRuntimeResult.decision.kind === 'operation_create_execute'
        ? completedRuntimeResult.decision.capabilityId
        : undefined;
      const applied = await requireProductCommands(runProductCommand)(
        (commands) => commands.agentWorkspace.applyRuntimeTurn({
          agentSessionId,
          decision: completedRuntimeResult.decision,
          externalThreadId: completedRuntimeResult.externalThreadId,
          operationPresentation: agentOperationPresentation(
            capabilityId,
            input.agentPreferences.connectionId,
          ),
          runtimeModel: completedRuntimeResult.model,
          runtimeTurnId: completedRuntimeResult.runtimeTurnId,
          sourceMessageId,
        }),
        operationApplicationAttempted
          ? { history: true, syncFlow: true }
          : { syncFlow: false },
      );
      if (
        input.suggestionAction
        && completedRuntimeResult.decision.kind === 'goal_plan_proposal'
        && completedRuntimeResult.decision.coverage === 'full'
        && applied.proposal?.proposedCommandKind === 'goal_plan.instantiate'
      ) {
        await decideProposal(
          applied.proposal.proposalId,
          applied.proposal.proposalVersion,
          'approve',
        );
        return;
      }
      if (applied.operationStage) revealStagedAgentOperation(applied.operationStage);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const canRecoverInChat = Boolean(
        sourceMessageId
        && (requestedAgentRuntime || operationApplicationAttempted)
        && snapshotRef.current?.agentSessions?.some(
          (session) => session.agentSessionId === agentSessionId,
        ),
      );
      if (canRecoverInChat) {
        const kind = receivedAgentRuntimeResult || operationApplicationAttempted
          ? 'operation_application' as const
          : 'runtime_unavailable' as const;
        const recovery = agentRuntimeRecoveryCopy(locale, kind);
        const recorded = await requireProductCommands(runProductCommand)(
          (commands) => commands.agentWorkspace.recordRuntimeRecovery({
            agentSessionId,
            content: recovery.content,
            error: message,
            ...(runtimeResult ? {
              externalThreadId: runtimeResult.externalThreadId,
              runtimeModel: runtimeResult.model,
              runtimeTurnId: runtimeResult.runtimeTurnId,
            } : {}),
            kind,
            sourceMessageId,
            suggestions: recovery.suggestions,
          }),
          { syncFlow: false },
        ).then(() => true).catch(() => false);
        if (recorded) setSessionError(agentSessionId, undefined);
        else setSessionError(agentSessionId, agentRuntimeRecoveryPersistenceError(locale));
      } else {
        setSessionError(agentSessionId, agentRuntimeRecoveryPersistenceError(locale));
      }
    } finally {
      inFlightSessionIdsRef.current.delete(agentSessionId);
      setSessionSending(agentSessionId, false);
    }
  }

  function agentOperationPresentation(
    capabilityId: string | undefined,
    explicitConnectionId?: string,
  ) {
    const operationTitle = capabilityId && capabilityId !== imageGenerateCapabilityId
      ? capabilityDefinitionFor(capabilityId).displayName
      : imageOperationTitle('generate_image', t);
    return {
      connectionId: capabilityId
        ? resolveAgentExecutionConnection({
            capabilityId,
            explicitConnectionId,
            initialConnectionId: 'codex-app-server',
            projectId: snapshotRef.current.project.projectId,
          })?.connectionId
        : undefined,
      imageToImagePromptPlaceholder: imageOperationDefaultPrompt('quick_edit', t),
      operationTitle,
      placementCenter: getViewportCenter(),
      promptPlaceholder: imageOperationDefaultPrompt('generate_image', t),
      promptTitle: t('operationToolbar.prompt'),
    };
  }

  function revealStagedAgentOperation(staged: {
    operationBlockId: string;
    operationScopeIds: string[];
  }): void {
    if (staged.operationScopeIds.length > 0) {
      setSelectedBlocks(snapshotRef.current, staged.operationScopeIds);
    }
    window.dispatchEvent(new CustomEvent('retake:run-operation', {
      detail: {
        blockId: staged.operationBlockId,
        queuedConfigurationStale: false,
        revealOnStart: true,
      },
    }));
  }

  const selectedSession = sessions.find((session) => session.agentSessionId === selectedSessionId);
  const isSending = selectedSessionId ? sendingSessionIds.has(selectedSessionId) : false;
  const launchingProposalId = selectedSessionId
    ? launchingProposalBySession[selectedSessionId]
    : undefined;
  const error = selectedSessionId ? errorsBySession[selectedSessionId] : undefined;
  const selectedBinding = selectedSession
    ? runtimeBindingForSession(snapshot, selectedSession.agentSessionId)
    : undefined;

  return {
    archiveSession,
    bindWorkingOperation,
    decideProposal,
    error,
    focusedAgentRunId,
    focusAgentRun,
    focusProposalEffect,
    focusProposalRun,
    ensureDefaultSession,
    isSending,
    launchProposal,
    launchingProposalId,
    newSession,
    renameSession,
    selectAgentRun,
    selectedBinding,
    selectedSession,
    selectedSessionId,
    selectSession,
    sessions,
    submitMessage,
  };

  function setSessionSending(agentSessionId: string, sending: boolean): void {
    setSendingSessionIds((current) => {
      const next = new Set(current);
      if (sending) next.add(agentSessionId);
      else next.delete(agentSessionId);
      return next;
    });
  }

  function setLaunchingProposal(agentSessionId: string, proposalId?: string): void {
    setLaunchingProposalBySession((current) => {
      if (proposalId) return { ...current, [agentSessionId]: proposalId };
      const next = { ...current };
      delete next[agentSessionId];
      return next;
    });
  }

  function setSessionError(agentSessionId: string, message?: string): void {
    setErrorsBySession((current) => ({ ...current, [agentSessionId]: message }));
  }

  function currentAgentConnection(explicitConnectionId?: string) {
    const settings = currentExecutionProviderSettings();
    const resolved = resolveAgentRuntimeConnectionPreference({
      explicitConnectionId,
      projectId: snapshot.project.projectId,
      settings,
    });
    return {
      connectionId: resolved.connectionId,
      modelId: resolved.connection?.modelId
        ?? (resolved.connectionId === 'codex-app-server' ? 'gpt-5.6-sol' : 'unavailable'),
      runtimeKind: (resolved.connection?.connectorId ?? resolved.connectionId) === 'codex-app-server'
        ? 'codex_app_server' as const
        : 'direct_api' as const,
    };
  }
}

function agentWorkspaceConnection(connection: {
  connectionId: string;
  modelId: string;
  runtimeKind: AgentRuntimeKind;
}) {
  return {
    connectionId: connection.connectionId,
    model: connection.modelId,
    runtimeKind: connection.runtimeKind,
  };
}
function requireProductCommands(
  runProductCommand: AgentWorkspaceControllerOptions['runProductCommand'],
): NonNullable<AgentWorkspaceControllerOptions['runProductCommand']> {
  if (!runProductCommand) {
    throw new Error('Whiteboard Agent Workspace command facade is unavailable.');
  }
  return runProductCommand;
}
function agentRuntimeRecoveryCopy(
  locale: string,
  kind: 'operation_application' | 'runtime_unavailable',
): { content: string; suggestions: string[] } {
  if (locale.toLowerCase().startsWith('zh')) {
    return kind === 'operation_application'
      ? {
          content: '我已经理解你的要求，但这次没有把修改安全地应用到当前操作，因此没有开始新的执行，现有内容已保留。你可以选择重试这次修改，或保留现有结果并继续当前步骤。',
          suggestions: ['重试这次修改', '保留现有结果并继续当前步骤'],
        }
      : {
          content: '我现在没能完成这次请求，现有内容没有改变。你可以选择重试刚才的请求，或先保留现有内容。',
          suggestions: ['重试刚才的请求', '保留现有内容'],
        };
  }
  return kind === 'operation_application'
    ? {
        content: 'I understood your request, but could not safely apply it to the current Operation, so no new execution was started and your existing work is unchanged. You can retry the change or keep the current result and continue.',
        suggestions: ['Retry this change', 'Keep the current result and continue'],
      }
    : {
        content: 'I could not complete this request, and your existing work is unchanged. You can retry the request or keep the current content.',
        suggestions: ['Retry the last request', 'Keep the current content'],
      };
}

function agentRuntimeRecoveryPersistenceError(locale: string): string {
  return locale.toLowerCase().startsWith('zh')
    ? '这次回复无法保存到 Chat，但现有内容没有改变。'
    : 'The recovery reply could not be saved to Chat, but your existing work is unchanged.';
}

function agentDraftFocusBlockIds(
  snapshot: BoardSnapshot,
  effect: AgentDraftAppliedEffect,
): string[] {
  if (!effect.workflowGroupId) return effect.createdBlockIds;
  const created = new Set(effect.createdBlockIds);
  const visibleChildren = createFlowNodes(snapshot, { projectionMode: 'creative' })
    .filter((node) => created.has(node.id) && node.id !== effect.workflowGroupId)
    .map((node) => node.id);
  return visibleChildren.length > 0 ? visibleChildren : [effect.primaryBlockId];
}

function canvasImageSelectionRefs(
  snapshot: BoardSnapshot,
  selectedBlockIds: readonly string[],
): Extract<AgentMessageContextRef, { kind: 'canvas_image_selection' }>[] {
  const imageBlockIds = selectedBlockIds.filter((blockId) =>
    snapshot.blocks.some(
      (block) =>
        block.blockId === blockId
        && block.type === 'image'
        && typeof block.data.assetId === 'string',
    ));
  return imageBlockIds.length > 0
    ? [{ imageBlockIds, kind: 'canvas_image_selection' }]
    : [];
}

async function reconcileDraftLaunchTarget(
  input: {
    agentRunId: string;
    boardId: string;
    projectId: string;
    target: AgentDraftLaunchTarget;
    workflowRunId?: string;
  },
): Promise<BoardSnapshot | undefined> {
  if (
    input.target.kind === 'workflow_slice'
    && (input.target.until.kind === 'artifact' || input.target.until.kind === 'stage')
  ) {
    return reconcileAgentArtifactTarget({
      agentRunId: input.agentRunId,
      boardId: input.boardId,
      projectId: input.projectId,
    });
  }
  if (input.target.kind === 'workflow_slice' && input.target.until.kind === 'gate') {
    return reconcileWorkflowArtifactGates({
      boardId: input.boardId,
      projectId: input.projectId,
      workflowRunId: input.workflowRunId,
    });
  }
  return undefined;
}
