import {
  appendAgentUserMessage,
  archiveAgentSession,
  createAgentSession,
  createTypedEntrypointProposalForMessage,
  ensureDefaultAgentSession,
  renameAgentSession,
  setAgentSessionRun,
  setAgentSessionWorkingOperation,
} from '../../core/agentSession';
import {
  applyWorkflowLaunchPreferences,
  decideChangeProposal,
} from '../../core/agentChangeApplication';
import type {
  AgentDraftAppliedEffect,
  AgentMessageContextRef,
  AgentRuntimeKind,
  ChangeProposalKind,
  GoalPlanDraftLaunchCommand,
  PackageEntrypointDraftLaunchCommand,
  WorkflowLaunchPreferences,
} from '../../core/agentSessionContracts';
import { stageGoalPlanAgentLaunch } from '../../core/goalPlanAgentLaunchApplication';
import { stagePackageEntrypointAgentLaunch } from '../../core/packageEntrypointAgentLaunchApplication';
import type { TextGenerationLabels } from '../../core/textOperations';
import type { BoardSnapshot } from '../../core/types';
import { nowIso } from '../../core/id';
import { moveBlockGroupToNearestFreeArea } from '../../core/workflowPlacement';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';
import {
  createWhiteboardAgentWorkspaceRuntimeCommands,
  type WhiteboardAgentWorkspaceRuntimeCommandsV1,
} from './whiteboardAgentWorkspaceRuntimeCommands';

export interface WhiteboardAgentWorkspaceConnectionV1 {
  connectionId: string;
  model: string;
  runtimeKind: AgentRuntimeKind;
}

export interface WhiteboardAgentDraftPresentationV1 {
  connectionIdsByCapability: Readonly<Record<string, string | undefined>>;
  labelsBySkillId: Readonly<Record<string, TextGenerationLabels>>;
  outputPlaceholder: string;
  placementCenter: { x: number; y: number };
  workflowTitle?: string;
}

export interface WhiteboardAgentWorkspaceCommandsV1
  extends WhiteboardAgentWorkspaceRuntimeCommandsV1 {
  appendMessage(input: {
    agentSessionId: string;
    content: string;
    contextRefs: AgentMessageContextRef[];
  }): Promise<{
    agentMessageId: string;
    boardId: string;
    projectId: string;
  }>;
  archiveSession(input: {
    agentSessionId: string;
    defaultConnection: WhiteboardAgentWorkspaceConnectionV1;
    defaultTitle: string;
  }): Promise<{ archivedSessionId: string; selectedSessionId: string }>;
  bindRun(input: {
    agentRunId?: string;
    agentSessionId: string;
  }): Promise<{ agentSessionId: string }>;
  bindWorkingOperation(input: {
    agentSessionId: string;
    operationBlockId: string;
  }): Promise<{ agentSessionId: string; operationBlockId: string }>;
  createSession(input: {
    agentRunId?: string;
    connection: WhiteboardAgentWorkspaceConnectionV1;
  }): Promise<{ agentSessionId: string }>;
  createEntrypointProposal(input: {
    agentSessionId: string;
    explanation: string;
    sourceMessageId: string;
  }): Promise<{
    committed: boolean;
    proposalId: string;
    proposalVersion: number;
  }>;
  decideProposal(input: {
    decision: 'approve' | 'reject';
    expectedProposalVersion: number;
    presentation: WhiteboardAgentDraftPresentationV1;
    proposalId: string;
    workflowPreferences?: WorkflowLaunchPreferences;
  }): Promise<{
    agentSessionId: string;
    appliedEffect?: AgentDraftAppliedEffect;
    committed: boolean;
    proposalKind: ChangeProposalKind;
    proposalVersion: number;
  }>;
  ensureDefaultSession(input: {
    connection: WhiteboardAgentWorkspaceConnectionV1;
    title: string;
  }): Promise<{ agentSessionId: string; committed: boolean; created: boolean }>;
  launchDraft(input: {
    command: GoalPlanDraftLaunchCommand | PackageEntrypointDraftLaunchCommand;
  }): Promise<{
    agentRunId: string;
    agentSessionId: string;
    boardId: string;
    committed: boolean;
    idempotencyKey: string;
    projectId: string;
    workflowRunId?: string;
  }>;
  renameSession(input: {
    agentSessionId: string;
    title: string;
  }): Promise<{ agentSessionId: string; committed: boolean }>;
}

export function createWhiteboardAgentWorkspaceCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardAgentWorkspaceCommandsV1 {
  return Object.freeze({
    ...createWhiteboardAgentWorkspaceRuntimeCommands(transactions),
    async appendMessage(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['appendMessage']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const message = appendAgentUserMessage(snapshot, input.agentSessionId, {
          content: input.content,
          contextRefs: input.contextRefs,
        });
        return {
          agentMessageId: message.agentMessageId,
          boardId: message.boardId,
          projectId: message.projectId,
        };
      });
      return transaction.result;
    },
    async archiveSession(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['archiveSession']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        archiveAgentSession(snapshot, input.agentSessionId);
        const next = ensureDefaultAgentSession(snapshot, {
          ...input.defaultConnection,
          title: input.defaultTitle,
        });
        return {
          archivedSessionId: input.agentSessionId,
          selectedSessionId: next.session.agentSessionId,
        };
      });
      return transaction.result;
    },
    async bindRun(input: Parameters<WhiteboardAgentWorkspaceCommandsV1['bindRun']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const session = setAgentSessionRun(
          snapshot,
          input.agentSessionId,
          input.agentRunId,
        );
        return { agentSessionId: session.agentSessionId };
      });
      return transaction.result;
    },
    async bindWorkingOperation(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['bindWorkingOperation']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const session = setAgentSessionWorkingOperation(snapshot, input.agentSessionId, {
          operationBlockId: input.operationBlockId,
          source: 'user_explicit',
        });
        return {
          agentSessionId: session.agentSessionId,
          operationBlockId: input.operationBlockId,
        };
      });
      return transaction.result;
    },
    async createSession(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['createSession']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const created = createAgentSession(snapshot, {
          agentRunId: input.agentRunId,
          ...input.connection,
        });
        return { agentSessionId: created.session.agentSessionId };
      });
      return transaction.result;
    },
    async createEntrypointProposal(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['createEntrypointProposal']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const existing = snapshot.changeProposals?.find(
          (proposal) => proposal.sourceMessageId === input.sourceMessageId,
        );
        if (existing) {
          if (
            existing.agentSessionId !== input.agentSessionId
            || existing.kind !== 'instantiate_entrypoint'
            || existing.proposedCommand.kind !== 'package_entrypoint.instantiate'
          ) throw new Error('Agent message is already bound to another Change Proposal.');
          return {
            changed: false,
            result: {
              proposalId: existing.proposalId,
              proposalVersion: existing.recordVersion,
            },
          };
        }
        const proposal = createTypedEntrypointProposalForMessage(snapshot, input);
        return {
          changed: true,
          result: {
            proposalId: proposal.proposalId,
            proposalVersion: proposal.recordVersion,
          },
        };
      });
      return {
        ...transaction.result,
        committed: transaction.committed,
      };
    },
    async decideProposal(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['decideProposal']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const proposal = snapshot.changeProposals?.find(
          (candidate) => candidate.proposalId === input.proposalId,
        );
        const previousVersion = proposal?.recordVersion;
        if (
          input.decision === 'approve'
          && input.workflowPreferences
          && proposal?.status === 'awaiting_decision'
        ) {
          applyWorkflowLaunchPreferences(proposal, input.workflowPreferences);
        }
        const decided = decideChangeProposal(
          snapshot,
          {
            decision: input.decision,
            expectedProposalVersion: input.expectedProposalVersion,
            proposalId: input.proposalId,
          },
          {
            connectionIdForCapability: (capabilityId) => (
              input.presentation.connectionIdsByCapability[capabilityId]
            ),
            labelsForSkill: (skillId) => labelsForDraft(input.presentation, skillId),
            outputPlaceholder: input.presentation.outputPlaceholder,
            workflowTitleForTarget: () => input.presentation.workflowTitle
              ?? 'Workflow Draft',
          },
        );
        const changed = decided.proposal.recordVersion !== previousVersion;
        if (changed && decided.proposal.appliedEffect?.workflowGroupId) {
          placeDraftAtCenter(
            snapshot,
            decided.proposal.appliedEffect.createdBlockIds,
            input.presentation.placementCenter,
          );
        }
        return {
          changed,
          result: {
            agentSessionId: decided.proposal.agentSessionId,
            appliedEffect: decided.proposal.appliedEffect
              ? structuredClone(decided.proposal.appliedEffect)
              : undefined,
            proposalKind: decided.proposal.kind,
            proposalVersion: decided.proposal.recordVersion,
          },
        };
      });
      return {
        ...transaction.result,
        committed: transaction.committed,
      };
    },
    async ensureDefaultSession(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['ensureDefaultSession']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const resolved = ensureDefaultAgentSession(snapshot, {
          ...input.connection,
          title: input.title,
        });
        return {
          changed: resolved.created,
          result: {
            agentSessionId: resolved.session.agentSessionId,
            created: resolved.created,
          },
        };
      });
      return {
        ...transaction.result,
        committed: transaction.committed,
      };
    },
    async launchDraft(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['launchDraft']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const proposal = snapshot.changeProposals?.find(
          (candidate) => candidate.proposalId === input.command.proposalId,
        );
        const changed = !proposal?.draftLaunchEffect;
        const launched = input.command.kind === 'goal_plan_draft.launch_agent'
          ? stageGoalPlanAgentLaunch(snapshot, input.command)
          : stagePackageEntrypointAgentLaunch(snapshot, input.command);
        if (changed) adoptStagedSnapshot(snapshot, launched.stagedSnapshot);
        return {
          changed,
          result: {
            agentRunId: launched.effect.agentRunId,
            agentSessionId: launched.effect.agentSessionId,
            boardId: snapshot.board.boardId,
            idempotencyKey: launched.effect.idempotencyKey,
            projectId: snapshot.project.projectId,
            workflowRunId: launched.effect.workflowRunId,
          },
        };
      });
      return {
        ...transaction.result,
        committed: transaction.committed,
      };
    },
    async renameSession(
      input: Parameters<WhiteboardAgentWorkspaceCommandsV1['renameSession']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const current = snapshot.agentSessions?.find(
          (session) => session.agentSessionId === input.agentSessionId,
        );
        const previousVersion = current?.recordVersion;
        const session = renameAgentSession(snapshot, input.agentSessionId, input.title);
        return {
          changed: session.recordVersion !== previousVersion,
          result: { agentSessionId: session.agentSessionId },
        };
      });
      return {
        ...transaction.result,
        committed: transaction.committed,
      };
    },
  });
}

function adoptStagedSnapshot(target: BoardSnapshot, staged: BoardSnapshot): void {
  Object.assign(target, staged);
}

function labelsForDraft(
  presentation: WhiteboardAgentDraftPresentationV1,
  skillId: string,
): TextGenerationLabels {
  const labels = presentation.labelsBySkillId[skillId];
  if (!labels) throw new Error(`Agent Draft labels are missing for Skill: ${skillId}`);
  return structuredClone(labels);
}

function placeDraftAtCenter(
  snapshot: BoardSnapshot,
  blockIds: readonly string[],
  center: { x: number; y: number },
): void {
  const blocks = blockIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .filter((block): block is BoardSnapshot['blocks'][number] => Boolean(block));
  if (blocks.length === 0) return;
  const minX = Math.min(...blocks.map((block) => block.position.x));
  const minY = Math.min(...blocks.map((block) => block.position.y));
  const maxX = Math.max(...blocks.map((block) => block.position.x + block.size.width));
  const maxY = Math.max(...blocks.map((block) => block.position.y + block.size.height));
  const deltaX = center.x - (minX + maxX) / 2;
  const deltaY = center.y - (minY + maxY) / 2;
  const updatedAt = nowIso();
  for (const block of blocks) {
    block.position = { x: block.position.x + deltaX, y: block.position.y + deltaY };
    block.updatedAt = updatedAt;
  }
  moveBlockGroupToNearestFreeArea(snapshot, blocks, center);
}
