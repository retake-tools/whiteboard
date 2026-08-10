import type { AgentRunRecord } from './agentRuntimeContracts';
import type { AgentMessageRecord } from './agentSessionContracts';
import type { WorkflowRunExperienceItemView } from './workflowRunExperience';
import type { WorkflowStepRunRecord } from './workflowRuntimeContracts';

export type AgentConversationTimelineItem =
  | {
      agentRunId: string;
      interventionKind: 'approval' | 'attention';
      itemId: string;
      kind: 'intervention';
      occurredAt: string;
    }
  | {
      itemId: string;
      kind: 'message';
      messageId: string;
      occurredAt: string;
    }
  | {
      itemId: string;
      kind: 'workflow_step';
      occurredAt: string;
      stepRunId: string;
    };

export function agentConversationTimeline(input: {
  intervention?: {
    agentRunId: string;
    kind: 'approval' | 'attention';
    occurredAt: string;
  };
  messages: readonly AgentMessageRecord[];
  run?: WorkflowRunExperienceItemView;
  stepRuns: readonly WorkflowStepRunRecord[];
}): AgentConversationTimelineItem[] {
  const stepRunById = new Map(input.stepRuns.map((step) => [step.stepRunId, step]));
  const messageItems: AgentConversationTimelineItem[] = input.messages.map((message) => ({
    itemId: `message:${message.agentMessageId}`,
    kind: 'message',
    messageId: message.agentMessageId,
    occurredAt: message.createdAt,
  }));
  const stepItems: AgentConversationTimelineItem[] = input.run?.steps.flatMap((step) => {
    if (step.status === 'pending' || step.status === 'blocked') return [];
    const stepRun = stepRunById.get(step.stepRunId);
    if (!stepRun) return [];
    return [{
      itemId: `workflow-step:${step.stepRunId}:${stepRun.recordVersion}`,
      kind: 'workflow_step' as const,
      occurredAt: stepRun.updatedAt,
      stepRunId: step.stepRunId,
    }];
  }) ?? [];
  const interventionItems: AgentConversationTimelineItem[] = input.intervention
    ? [{
        agentRunId: input.intervention.agentRunId,
        interventionKind: input.intervention.kind,
        itemId: `intervention:${input.intervention.agentRunId}:${input.intervention.kind}`,
        kind: 'intervention',
        occurredAt: input.intervention.occurredAt,
      }]
    : [];

  return [...messageItems, ...stepItems, ...interventionItems].sort((left, right) => (
    left.occurredAt.localeCompare(right.occurredAt)
    || timelineKindOrder(left.kind) - timelineKindOrder(right.kind)
    || left.itemId.localeCompare(right.itemId)
  ));
}

export function workflowTaskSummary(
  messages: readonly AgentMessageRecord[],
  activeRun?: AgentRunRecord,
): string | undefined {
  if (!activeRun || activeRun.target.kind === 'capability') return undefined;
  const matchingMessage = findLastMessage(messages, (message) => (
    message.role === 'user'
    && message.contextRefs.some((ref) => (
      ref.kind === 'entrypoint'
      && (!activeRun.entrypointId || ref.entrypointId === activeRun.entrypointId)
    ))
  ));
  const fallbackMessage = findLastMessage(messages, (message) => message.role === 'user');
  const content = (matchingMessage ?? fallbackMessage)?.content.replace(/\s+/g, ' ').trim();
  if (!content) return undefined;
  return content.length > 72 ? `${content.slice(0, 71)}…` : content;
}

function findLastMessage(
  messages: readonly AgentMessageRecord[],
  predicate: (message: AgentMessageRecord) => boolean,
): AgentMessageRecord | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (predicate(message)) return message;
  }
  return undefined;
}

function timelineKindOrder(kind: AgentConversationTimelineItem['kind']): number {
  if (kind === 'message') return 0;
  return kind === 'workflow_step' ? 1 : 2;
}
