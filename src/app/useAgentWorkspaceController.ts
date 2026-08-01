import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  activeBoardAgentSessions,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  archiveAgentSession,
  createAgentSession,
  ensureDefaultAgentSession,
  markAgentRuntimeFailure,
  runtimeBindingForSession,
  setAgentSessionRun,
  setAgentSessionWorkingOperation,
} from '../core/agentSession';
import { appendAgentRuntimeEvent, decideChangeProposal } from '../core/agentChangeApplication';
import type {
  AgentDraftAppliedEffect,
  AgentDraftLaunchTarget,
  AgentMessageContextRef,
} from '../core/agentSessionContracts';
import type { ComposerImageReferenceSetting } from '../core/referenceIntent';
import { loadBoardSnapshot } from '../core/boardStore';
import { requestAgentRuntimeTurn } from '../core/agentRuntimeClient';
import {
  currentExecutionProviderSettings,
  resolveAgentRuntimeConnectionPreference,
  resolveAgentExecutionConnection,
} from '../core/executionProviderPreferences';
import { reconcileAgentArtifactTarget } from '../core/agentArtifactTargetClient';
import type { PackageComposerMention } from '../core/packageComposer';
import type { BoardSnapshot } from '../core/types';
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
import { reconcileWorkflowArtifactGates } from '../core/workflowArtifactGateClient';
import { resolvedWorkflowUiDefinitionFor } from '../core/workflowRegistry';
import type { useI18n } from '../i18n';
import { textGenerationLabelsForSkill } from './skillTextLabels';
import type { ImageComposerWorkflowLayoutInput } from './imageComposerWorkflowLayout';

interface AgentWorkspaceControllerOptions {
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
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [isSending, setIsSending] = useState(false);
  const [launchingProposalId, setLaunchingProposalId] = useState<string>();
  const [focusedAgentRunId, setFocusedAgentRunId] = useState<string>();
  const [error, setError] = useState<string>();
  const inFlightRef = useRef(false);
  const launchInFlightRef = useRef(false);
  const sessions = activeBoardAgentSessions(snapshot);

  useEffect(() => {
    const currentStillExists = selectedSessionId
      ? sessions.some((session) => session.agentSessionId === selectedSessionId)
      : false;
    if (!currentStillExists) setSelectedSessionId(sessions[0]?.agentSessionId);
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    setSelectedSessionId(undefined);
    setFocusedAgentRunId(undefined);
    setLaunchingProposalId(undefined);
    setError(undefined);
  }, [snapshot.board.boardId, snapshot.project.projectId]);

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
    setError(undefined);
    return createdId;
  }

  function ensureDefaultSession(): string {
    const existing = sessions[0];
    if (existing) {
      setSelectedSessionId(existing.agentSessionId);
      setError(undefined);
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
    setError(undefined);
    return resolvedId;
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
    setError(undefined);
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
    setError(undefined);
  }

  function decideProposal(
    proposalId: string,
    expectedProposalVersion: number,
    decision: 'approve' | 'reject',
  ): void {
    try {
      let effect: AgentDraftAppliedEffect | undefined;
      const nextSnapshot = updateSnapshot((current) => {
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
        return current;
      }, { history: true, persist: true });
      if (effect) {
        setSelectedBlocks(nextSnapshot, [effect.primaryBlockId]);
        focusWorkflowBlocks(effect.createdBlockIds);
      }
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function focusProposalEffect(proposalId: string): void {
    const effect = snapshot.changeProposals?.find(
      (proposal) => proposal.proposalId === proposalId,
    )?.appliedEffect;
    if (!effect) return;
    setSelectedBlocks(snapshot, [effect.primaryBlockId]);
    focusWorkflowBlocks(effect.createdBlockIds);
  }

  async function launchProposal(
    proposalId: string,
    expectedProposalVersion: number,
    target: AgentDraftLaunchTarget,
    agentPresetEntryPointId?: string,
  ): Promise<void> {
    if (!selectedSessionId || launchInFlightRef.current) return;
    let command: { idempotencyKey: string } | undefined;
    launchInFlightRef.current = true;
    setLaunchingProposalId(proposalId);
    setError(undefined);
    try {
      const result = target.kind === 'goal'
        ? (() => {
            const goalCommand = buildGoalPlanDraftLaunchCommand({
              agentPresetEntryPointId,
              agentSessionId: selectedSessionId,
              expectedProposalVersion,
              proposalId,
            });
            command = goalCommand;
            return stageGoalPlanAgentLaunch(snapshotRef.current, goalCommand);
          })()
        : (() => {
            const entrypointCommand = buildPackageEntrypointDraftLaunchCommand({
              agentPresetEntryPointId,
              agentSessionId: selectedSessionId,
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
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      launchInFlightRef.current = false;
      setLaunchingProposalId(undefined);
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
    setSelectedSessionId(agentSessionId);
    setFocusedAgentRunId(agentRunId);
    setError(undefined);
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
  }): Promise<void> {
    if (inFlightRef.current) return;
    const agentSessionId = selectedSessionId ?? ensureDefaultSession();
    inFlightRef.current = true;
    setIsSending(true);
    setError(undefined);
    let sourceMessageId = '';
    let operationExecution: AgentOperationExecutionRequest | undefined;
    try {
      const contextRefs: AgentMessageContextRef[] = [
        {
          kind: 'agent_preferences',
          ...structuredClone(input.agentPreferences),
        },
        ...(input.entrypointId ? [{ kind: 'entrypoint' as const, entrypointId: input.entrypointId }] : []),
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
        return current;
      }, { syncFlow: false });
      await persistSnapshot(withRuntimeResult, { requireLocalApi: true });
      const executionRequest = operationExecution;
      if (executionRequest) {
        let operationBlockId = '';
        let operationScopeIds: string[] = [];
        const executionSnapshot = updateSnapshot((current) => {
          const staged = stageAgentOperationExecution(current, executionRequest, {
            connectionIdForCapability: (capabilityId, applicationSnapshot) =>
              resolveAgentExecutionConnection({
                capabilityId,
                explicitConnectionId: input.agentPreferences.connectionId,
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
    bindWorkingOperation,
    decideProposal,
    error,
    focusedAgentRunId,
    focusProposalEffect,
    focusProposalRun,
    ensureDefaultSession,
    isSending,
    launchProposal,
    launchingProposalId,
    newSession,
    selectAgentRun,
    selectedBinding,
    selectedSession,
    selectedSessionId,
    selectSession,
    sessions,
    submitMessage,
  };

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
