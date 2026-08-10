import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  activeBoardAgentSessions,
  agentSessionForRun,
  applyAuthorizedOperationSuggestion,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  archiveAgentSession,
  createAgentSession,
  ensureDefaultAgentSession,
  renameAgentSession,
  markAgentRuntimeFailure,
  runtimeBindingForSession,
  setAgentSessionRun,
  setAgentSessionWorkingOperation,
  createTypedEntrypointProposalForMessage,
} from '../core/agentSession';
import {
  appendAgentRuntimeEvent,
  applyWorkflowLaunchPreferences,
  decideChangeProposal,
} from '../core/agentChangeApplication';
import type {
  AgentDraftAppliedEffect,
  AgentDraftLaunchTarget,
  AgentMessageContextRef,
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
  stagePackageEntrypointAgentLaunch,
} from '../core/packageEntrypointAgentLaunchApplication';
import {
  buildGoalPlanDraftLaunchCommand,
  stageGoalPlanAgentLaunch,
} from '../core/goalPlanAgentLaunchApplication';
import {
  stageAgentOperationExecution,
  type AgentOperationExecutionRequest,
} from '../core/agentOperationExecution';
import {
  imageOperationDefaultPrompt,
  imageOperationTitle,
} from '../core/imageOperationText';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import { imageGenerateCapabilityId } from '../core/imageGenerateContracts';
import { reconcileWorkflowArtifactGates } from '../core/workflowArtifactGateClient';
import { resolvedWorkflowUiDefinitionFor, workflowDefinitionFor } from '../core/workflowRegistry';
import type { useI18n } from '../i18n';
import { textGenerationLabelsForSkill } from './skillTextLabels';
import type { ImageComposerWorkflowLayoutInput } from './imageComposerWorkflowLayout';
import {
  loadSelectedAgentSessionId,
  resolveSelectedAgentSessionId,
  saveSelectedAgentSessionId,
} from '../core/agentWorkspaceViewState';

interface AgentWorkspaceControllerOptions {
  centerBlockGroup: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  focusWorkflowBlocks: (blockIds: string[]) => void;
  layoutImageComposerWorkflow: (
    snapshot: BoardSnapshot,
    input: ImageComposerWorkflowLayoutInput,
  ) => void;
  locale: string;
  persistSnapshot: (
    snapshot: BoardSnapshot,
    options?: { requireLocalApi?: boolean },
  ) => Promise<void>;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  selectedBlockIdsRef: RefObject<string[]>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useAgentWorkspaceController(options: AgentWorkspaceControllerOptions) {
  const {
    centerBlockGroup,
    focusWorkflowBlocks,
    layoutImageComposerWorkflow,
    locale,
    persistSnapshot,
    selectedBlockIdsRef,
    setSelectedBlocks,
    snapshot,
    snapshotRef,
    t,
    updateSnapshot,
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

  function newSession(connectionId?: string, agentRunId?: string): string {
    let createdId = '';
    const connection = currentAgentConnection(connectionId);
    updateSnapshot((current) => {
      const created = createAgentSession(current, {
        agentRunId,
        connectionId: connection.connectionId,
        model: connection.modelId,
        runtimeKind: connection.runtimeKind,
      });
      createdId = created.session.agentSessionId;
      return current;
    }, { history: true, persist: true, syncFlow: false });
    setSelectedSessionId(createdId);
    setSessionError(createdId, undefined);
    return createdId;
  }

  function ensureDefaultSession(): string {
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
    let resolvedId = '';
    const connection = currentAgentConnection();
    updateSnapshot((current) => {
      const resolved = ensureDefaultAgentSession(current, {
        connectionId: connection.connectionId,
        model: connection.modelId,
        runtimeKind: connection.runtimeKind,
        title: t('agentWorkspace.defaultSession'),
      });
      resolvedId = resolved.session.agentSessionId;
      return current;
    }, { history: false, persist: true, syncFlow: false });
    setSelectedSessionId(resolvedId);
    setSessionError(resolvedId, undefined);
    return resolvedId;
  }

  function selectSession(agentSessionId: string): void {
    setSelectedSessionId(agentSessionId);
  }

  function renameSession(title: string): boolean {
    if (!selectedSessionId) return false;
    try {
      updateSnapshot((current) => {
        renameAgentSession(current, selectedSessionId, title);
        return current;
      }, { history: true, persist: true, syncFlow: false });
      setSessionError(selectedSessionId, undefined);
      return true;
    } catch (caught) {
      setSessionError(selectedSessionId, caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  }

  function selectAgentRun(agentRunId?: string): void {
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
    updateSnapshot((current) => {
      setAgentSessionRun(current, selectedSessionId, agentRunId);
      return current;
    }, { persist: true, syncFlow: false });
  }

  function focusAgentRun(agentRunId: string): void {
    const owner = agentSessionForRun(snapshotRef.current, agentRunId);
    if (owner) {
      setSelectedSessionId(owner.agentSessionId);
      setFocusedAgentRunId(agentRunId);
      setSessionError(owner.agentSessionId, undefined);
      return;
    }
    const agentSessionId = selectedSessionId ?? ensureDefaultSession();
    updateSnapshot((current) => {
      setAgentSessionRun(current, agentSessionId, agentRunId);
      return current;
    }, { persist: true, syncFlow: false });
    setSelectedSessionId(agentSessionId);
    setFocusedAgentRunId(agentRunId);
    setSessionError(agentSessionId, undefined);
  }

  function bindWorkingOperation(operationBlockId: string): void {
    const agentSessionId = selectedSessionId ?? ensureDefaultSession();
    updateSnapshot((current) => {
      setAgentSessionWorkingOperation(current, agentSessionId, {
        operationBlockId,
        source: 'user_explicit',
      });
      return current;
    }, { persist: true, syncFlow: false });
    setSelectedSessionId(agentSessionId);
    setSessionError(agentSessionId, undefined);
  }

  function archiveSession(): void {
    if (!selectedSessionId) return;
    let nextSelectedSessionId = '';
    const connection = currentAgentConnection();
    updateSnapshot((current) => {
      archiveAgentSession(current, selectedSessionId);
      const next = ensureDefaultAgentSession(current, {
        connectionId: connection.connectionId,
        model: connection.modelId,
        runtimeKind: connection.runtimeKind,
        title: t('agentWorkspace.defaultSession'),
      });
      nextSelectedSessionId = next.session.agentSessionId;
      return current;
    }, { history: true, persist: true, syncFlow: false });
    setSelectedSessionId(nextSelectedSessionId);
    setSessionError(nextSelectedSessionId, undefined);
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
    const proposalKind = snapshotRef.current.changeProposals?.find(
      (proposal) => proposal.proposalId === proposalId,
    )?.kind;
    if (!ownerSessionId || launchStateRef.current.inFlightSessionIds.has(ownerSessionId)) return;
    launchStateRef.current.inFlightSessionIds.add(ownerSessionId);
    setLaunchingProposal(ownerSessionId, proposalId);
    try {
      let effect: AgentDraftAppliedEffect | undefined;
      let appliedProposalVersion = 0;
      let proposalSessionId = ownerSessionId;
      const nextSnapshot = updateSnapshot((current) => {
        const proposal = current.changeProposals?.find(
          (candidate) => candidate.proposalId === proposalId,
        );
        if (decision === 'approve' && workflowPreferences && proposal) {
          applyWorkflowLaunchPreferences(proposal, workflowPreferences);
        }
        const result = decideChangeProposal(
          current,
          { decision, expectedProposalVersion, proposalId },
          {
            connectionIdForCapability: (capabilityId, applicationSnapshot) =>
              resolveAgentExecutionConnection({
                capabilityId,
                initialConnectionId: 'codex-app-server',
                projectId: applicationSnapshot.project.projectId,
              })?.connectionId,
            labelsForSkill: (skillId) => textGenerationLabelsForSkill(skillId, locale, t),
            outputPlaceholder: t('workflowDraft.outputPending'),
            workflowTitleForTarget: (target) =>
              resolvedWorkflowUiDefinitionFor(
                target.workflowDefinitionLock.workflowDefinitionId,
                locale,
              ).name,
          },
        );
        effect = result.proposal.appliedEffect;
        if (effect?.workflowGroupId) {
          centerBlockGroup(current, effect.createdBlockIds);
        }
        appliedProposalVersion = result.proposal.recordVersion;
        proposalSessionId = result.proposal.agentSessionId;
        return current;
      }, { history: true, persist: false });
      await persistSnapshot(nextSnapshot, { requireLocalApi: true });
      if (effect) {
        setSelectedBlocks(nextSnapshot, [effect.primaryBlockId]);
        focusWorkflowBlocks(agentDraftFocusBlockIds(nextSnapshot, effect));
      }
      if (
        decision === 'approve'
        && effect?.kind === 'package_entrypoint_draft'
        && effect.entrypointKind === 'workflow'
      ) {
        const command = buildPackageEntrypointDraftLaunchCommand({
          agentSessionId: proposalSessionId,
          expectedProposalVersion: appliedProposalVersion,
          proposalId,
          target: { kind: 'workflow_run' },
        });
        const launched = stagePackageEntrypointAgentLaunch(nextSnapshot, command);
        await persistSnapshot(launched.stagedSnapshot, { requireLocalApi: true });
        const authoritative = await reconcileDraftLaunchTarget(
          launched.stagedSnapshot,
          launched.effect.agentRunId,
          launched.effect.workflowRunId,
          { kind: 'workflow_run' },
        );
        publishLaunch(
          authoritative,
          launched.effect.agentRunId,
          launched.effect.agentSessionId,
        );
      } else if (
        decision === 'approve'
        && proposalKind === 'plan_skill'
        && effect?.kind === 'package_entrypoint_draft'
        && effect.entrypointKind === 'skill'
      ) {
        const command = buildPackageEntrypointDraftLaunchCommand({
          agentSessionId: proposalSessionId,
          expectedProposalVersion: appliedProposalVersion,
          proposalId,
          target: { kind: 'capability' },
        });
        const launched = stagePackageEntrypointAgentLaunch(nextSnapshot, command);
        await persistSnapshot(launched.stagedSnapshot, { requireLocalApi: true });
        const authoritative = await reconcileDraftLaunchTarget(
          launched.stagedSnapshot,
          launched.effect.agentRunId,
          launched.effect.workflowRunId,
          { kind: 'capability' },
        );
        publishLaunch(
          authoritative,
          launched.effect.agentRunId,
          launched.effect.agentSessionId,
        );
      } else if (
        decision === 'approve'
        && effect?.kind === 'goal_plan_draft'
      ) {
        const command = buildGoalPlanDraftLaunchCommand({
          agentSessionId: proposalSessionId,
          expectedProposalVersion: appliedProposalVersion,
          proposalId,
        });
        const launched = stageGoalPlanAgentLaunch(nextSnapshot, command);
        await persistSnapshot(launched.stagedSnapshot, { requireLocalApi: true });
        const authoritative = await reconcileDraftLaunchTarget(
          launched.stagedSnapshot,
          launched.effect.agentRunId,
          launched.effect.workflowRunId,
          { kind: 'goal' },
        );
        publishLaunch(
          authoritative,
          launched.effect.agentRunId,
          launched.effect.agentSessionId,
        );
      }
      setSessionError(ownerSessionId, undefined);
    } catch (caught) {
      setSessionError(ownerSessionId, caught instanceof Error ? caught.message : String(caught));
    } finally {
      launchStateRef.current.inFlightSessionIds.delete(ownerSessionId);
      setLaunchingProposal(ownerSessionId, undefined);
    }
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
    let command: { idempotencyKey: string } | undefined;
    launchStateRef.current.inFlightSessionIds.add(launchSessionId);
    setLaunchingProposal(launchSessionId, proposalId);
    setSessionError(launchSessionId, undefined);
    try {
      const result = target.kind === 'goal'
        ? (() => {
            const goalCommand = buildGoalPlanDraftLaunchCommand({
              agentPresetEntryPointId,
              agentSessionId: launchSessionId,
              expectedProposalVersion,
              proposalId,
            });
            command = goalCommand;
            return stageGoalPlanAgentLaunch(snapshotRef.current, goalCommand);
          })()
        : (() => {
            const entrypointCommand = buildPackageEntrypointDraftLaunchCommand({
              agentPresetEntryPointId,
              agentSessionId: launchSessionId,
              expectedProposalVersion,
              proposalId,
              target,
            });
            command = entrypointCommand;
            return stagePackageEntrypointAgentLaunch(
              snapshotRef.current,
              entrypointCommand,
            );
          })();
      await persistSnapshot(result.stagedSnapshot, { requireLocalApi: true });
      const authoritative = await reconcileDraftLaunchTarget(
        result.stagedSnapshot,
        result.effect.agentRunId,
        result.effect.workflowRunId,
        target,
      );
      publishLaunch(authoritative, result.effect.agentRunId, result.effect.agentSessionId);
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
          publishLaunch(authoritative, recovered.agentRunId, recovered.agentSessionId);
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

  function publishLaunch(
    nextSnapshot: BoardSnapshot,
    agentRunId: string,
    agentSessionId: string,
  ): void {
    if (
      snapshotRef.current.project.projectId !== nextSnapshot.project.projectId
      || snapshotRef.current.board.boardId !== nextSnapshot.board.boardId
    ) return;
    updateSnapshot(() => nextSnapshot, { history: true, persist: false });
    if (!launchStateRef.current.selectedSessionId || launchStateRef.current.selectedSessionId === agentSessionId) {
      setSelectedSessionId(agentSessionId);
      setFocusedAgentRunId(agentRunId);
    }
    setSessionError(agentSessionId, undefined);
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
    const agentSessionId = selectedSessionId ?? ensureDefaultSession();
    if (inFlightSessionIdsRef.current.has(agentSessionId)) return;
    inFlightSessionIdsRef.current.add(agentSessionId);
    setSessionSending(agentSessionId, true);
    setSessionError(agentSessionId, undefined);
    let sourceMessageId = '';
    let operationExecution: AgentOperationExecutionRequest | undefined;
    let requestedAgentRuntime = false;
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
      const withUserMessage = updateSnapshot((current) => {
        const message = appendAgentUserMessage(current, agentSessionId, {
          content: input.content,
          contextRefs,
        });
        sourceMessageId = message.agentMessageId;
        return current;
      }, { syncFlow: false });
      await persistSnapshot(withUserMessage, { requireLocalApi: true });
      if (input.suggestionAction?.operationBlockId) {
        let authorizedExecution: AgentOperationExecutionRequest | undefined;
        const withAuthorizedAction = updateSnapshot((current) => {
          const applied = applyAuthorizedOperationSuggestion(current, {
            agentSessionId,
            operationBlockId: input.suggestionAction!.operationBlockId!,
            sourceMessageId,
          });
          authorizedExecution = applied.operationExecution;
          return current;
        }, { syncFlow: false });
        await persistSnapshot(withAuthorizedAction, { requireLocalApi: true });
        await executeAgentOperationRequest(
          authorizedExecution,
          input.agentPreferences.connectionId,
        );
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
        let proposalId = '';
        let proposalVersion = 0;
        let appliedEffect: AgentDraftAppliedEffect | undefined;
        const appliedSnapshot = updateSnapshot((current) => {
          const proposal = createTypedEntrypointProposalForMessage(current, {
            agentSessionId,
            explanation: t('agentWorkspace.workflowDirectStartSummary'),
            sourceMessageId,
          });
          const invocation = proposal.proposedCommand.kind === 'package_entrypoint.instantiate'
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
          applyWorkflowLaunchPreferences(proposal, {
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
          });
          const decision = decideChangeProposal(
            current,
            {
              decision: 'approve',
              expectedProposalVersion: proposal.recordVersion,
              proposalId: proposal.proposalId,
            },
            {
              connectionIdForCapability: (capabilityId, applicationSnapshot) =>
                resolveAgentExecutionConnection({
                  capabilityId,
                  explicitConnectionId: input.agentPreferences.connectionId,
                  initialConnectionId: 'codex-app-server',
                  projectId: applicationSnapshot.project.projectId,
                })?.connectionId,
              labelsForSkill: (skillId) => textGenerationLabelsForSkill(skillId, locale, t),
              outputPlaceholder: t('workflowDraft.outputPending'),
              workflowTitleForTarget: (target) =>
                resolvedWorkflowUiDefinitionFor(
                  target.workflowDefinitionLock.workflowDefinitionId,
                  locale,
                ).name,
            },
          );
          proposalId = decision.proposal.proposalId;
          proposalVersion = decision.proposal.recordVersion;
          appliedEffect = decision.proposal.appliedEffect;
          if (appliedEffect?.workflowGroupId) {
            centerBlockGroup(current, appliedEffect.createdBlockIds);
          }
          return current;
        }, { history: true, syncFlow: true });
        await persistSnapshot(appliedSnapshot, { requireLocalApi: true });
        if (appliedEffect) {
          setSelectedBlocks(appliedSnapshot, [appliedEffect.primaryBlockId]);
          focusWorkflowBlocks(agentDraftFocusBlockIds(appliedSnapshot, appliedEffect));
        }
        const launchCommand = buildPackageEntrypointDraftLaunchCommand({
          agentSessionId,
          expectedProposalVersion: proposalVersion,
          proposalId,
          target: { kind: 'workflow_run' },
        });
        const launched = stagePackageEntrypointAgentLaunch(
          appliedSnapshot,
          launchCommand,
        );
        await persistSnapshot(launched.stagedSnapshot, { requireLocalApi: true });
        const authoritative = await reconcileDraftLaunchTarget(
          launched.stagedSnapshot,
          launched.effect.agentRunId,
          launched.effect.workflowRunId,
          { kind: 'workflow_run' },
        );
        publishLaunch(
          authoritative,
          launched.effect.agentRunId,
          launched.effect.agentSessionId,
        );
        return;
      }
      requestedAgentRuntime = true;
      const runtimeResult = await requestAgentRuntimeTurn({
        agentSessionId,
        boardId: withUserMessage.board.boardId,
        projectId: withUserMessage.project.projectId,
        sourceMessageId,
      }, async (event) => {
        const withEvent = updateSnapshot((current) => {
          appendAgentRuntimeEvent(current, { event, sourceMessageId });
          return current;
        }, { syncFlow: false });
        await persistSnapshot(withEvent, { requireLocalApi: true });
      });
      let automaticGoalProposal: { proposalId: string; recordVersion: number } | undefined;
      const withRuntimeResult = updateSnapshot((current) => {
        const applied = applyAgentRuntimeTurn(current, {
          agentSessionId,
          decision: runtimeResult.decision,
          externalThreadId: runtimeResult.externalThreadId,
          runtimeModel: runtimeResult.model,
          runtimeTurnId: runtimeResult.runtimeTurnId,
          sourceMessageId,
        });
        operationExecution = applied.operationExecution;
        if (
          input.suggestionAction
          && runtimeResult.decision.kind === 'goal_plan_proposal'
          && runtimeResult.decision.coverage === 'full'
          && applied.proposal?.proposedCommand.kind === 'goal_plan.instantiate'
        ) {
          automaticGoalProposal = {
            proposalId: applied.proposal.proposalId,
            recordVersion: applied.proposal.recordVersion,
          };
        }
        return current;
      }, { syncFlow: false });
      await persistSnapshot(withRuntimeResult, { requireLocalApi: true });
      if (automaticGoalProposal) {
        await decideProposal(
          automaticGoalProposal.proposalId,
          automaticGoalProposal.recordVersion,
          'approve',
        );
        return;
      }
      await executeAgentOperationRequest(
        operationExecution,
        input.agentPreferences.connectionId,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSessionError(agentSessionId, agentRuntimeFailureUserMessage(locale));
      if (
        requestedAgentRuntime
        && snapshotRef.current?.agentSessions?.some((session) => session.agentSessionId === agentSessionId)
      ) {
        const failed = updateSnapshot((current) => {
          markAgentRuntimeFailure(current, agentSessionId, message);
          return current;
        }, { syncFlow: false });
        await persistSnapshot(failed).catch(() => undefined);
      }
    } finally {
      inFlightSessionIdsRef.current.delete(agentSessionId);
      setSessionSending(agentSessionId, false);
    }
  }

  async function executeAgentOperationRequest(
    executionRequest: AgentOperationExecutionRequest | undefined,
    explicitConnectionId?: string,
  ): Promise<void> {
    if (!executionRequest) return;
    let operationBlockId = '';
    let operationScopeIds: string[] = [];
    const executionSnapshot = updateSnapshot((current) => {
      const staged = stageAgentOperationExecution(current, executionRequest, {
        connectionIdForCapability: (capabilityId, applicationSnapshot) =>
          resolveAgentExecutionConnection({
            capabilityId,
            explicitConnectionId,
            initialConnectionId: 'codex-app-server',
            projectId: applicationSnapshot.project.projectId,
          })?.connectionId,
        operationTitle: imageOperationTitle('generate_image', t),
        imageToImageOperationTitle: imageOperationTitle('generate_image', t),
        imageToImagePromptPlaceholder: imageOperationDefaultPrompt('quick_edit', t),
        operationTitleForCapability: (capabilityId) => {
          if (capabilityId === 'image.generate') {
            return imageOperationTitle('generate_image', t);
          }
          return capabilityDefinitionFor(capabilityId).displayName;
        },
        promptPlaceholder: imageOperationDefaultPrompt('generate_image', t),
        promptTitle: t('operationToolbar.prompt'),
      });
      operationBlockId = staged.receipt.operationBlockId;
      const attachmentBlockIds = agentMessageAttachmentBlockIds(executionRequest);
      if (
        staged.receipt.action === 'created'
        && staged.receipt.promptBlockId
        && attachmentBlockIds.length > 0
      ) {
        layoutImageComposerWorkflow(staged.stagedSnapshot, {
          operationBlockId: staged.receipt.operationBlockId,
          referenceBlockIds: attachmentBlockIds,
          textBlockId: staged.receipt.promptBlockId,
        });
      }
      operationScopeIds = [
        ...attachmentBlockIds,
        ...(staged.receipt.createdBlockIds.length > 0
          ? staged.receipt.createdBlockIds
          : [staged.receipt.operationBlockId]),
      ];
      return staged.stagedSnapshot;
    }, { history: true, syncFlow: true });
    await persistSnapshot(executionSnapshot, { requireLocalApi: true });
    if (operationScopeIds.length > 0) {
      setSelectedBlocks(executionSnapshot, operationScopeIds);
    }
    window.dispatchEvent(new CustomEvent('retake:run-operation', {
      detail: {
        blockId: operationBlockId,
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

function agentRuntimeFailureUserMessage(locale: string): string {
  return locale.toLowerCase().startsWith('zh')
    ? '这次没有完成，但现有内容已经保留。你可以直接重试；如果仍然失败，请检查 Agent 连接。'
    : 'This attempt did not finish, but your existing work is safe. Try again, and check the Agent connection if it keeps failing.';
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

function agentMessageAttachmentBlockIds(
  request: AgentOperationExecutionRequest,
): string[] {
  if (request.kind !== 'create_execute') return [];
  const imageInputs = request.decision.imageInputs?.length
    ? request.decision.imageInputs
    : request.decision.sourceImageBlockId && request.decision.sourceBinding
      ? [{
          bindingSource: request.decision.sourceBinding,
          blockId: request.decision.sourceImageBlockId,
        }]
      : [];
  return imageInputs
    .filter((input) => input.bindingSource === 'message_attachment')
    .map((input) => input.blockId);
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
  snapshot: BoardSnapshot,
  agentRunId: string,
  workflowRunId: string | undefined,
  target: AgentDraftLaunchTarget,
): Promise<BoardSnapshot> {
  if (
    target.kind === 'workflow_slice'
    && (target.until.kind === 'artifact' || target.until.kind === 'stage')
  ) {
    return reconcileAgentArtifactTarget({
      agentRunId,
      boardId: snapshot.board.boardId,
      projectId: snapshot.project.projectId,
    });
  }
  if (target.kind === 'workflow_slice' && target.until.kind === 'gate') {
    return reconcileWorkflowArtifactGates({
      boardId: snapshot.board.boardId,
      projectId: snapshot.project.projectId,
      workflowRunId,
    });
  }
  return snapshot;
}
