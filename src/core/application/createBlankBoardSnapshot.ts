import { createId, nowIso } from '../id';
import type { BoardSnapshot, ProjectRecord } from '../types';

export function createBlankBoardSnapshot(input: {
  boardId?: string;
  boardName: string;
  project?: ProjectRecord;
  projectId?: string;
  projectName: string;
}): BoardSnapshot {
  const createdAt = nowIso();
  const projectId = input.project?.projectId ?? input.projectId ?? createId('project');
  const boardId = input.boardId ?? createId('board');
  const project: ProjectRecord = input.project
    ? {
        ...structuredClone(input.project),
        defaultBoardId: input.project.defaultBoardId || boardId,
        updatedAt: createdAt,
      }
    : {
        createdAt,
        defaultBoardId: boardId,
        name: requiredName(input.projectName, 'Project'),
        projectId,
        updatedAt: createdAt,
      };

  return {
    agentMessages: [],
    agentRuntimeBindings: [],
    agentRuntimeEvents: [],
    agentRuns: [],
    agentSessions: [],
    assets: [],
    blocks: [],
    board: {
      background: { kind: 'default' },
      boardId,
      createdAt,
      name: requiredName(input.boardName, 'Board'),
      projectId,
      updatedAt: createdAt,
    },
    changeDecisions: [],
    changeProposals: [],
    edges: [],
    executions: [],
    executionOutputSelections: [],
    historyEvents: [],
    layers: [{
      boardId,
      id: 'layer_default',
      locked: false,
      name: 'Default layer',
      order: 0,
      visible: true,
    }],
    project,
    schemaVersion: 1,
    workflowApprovalDecisions: [],
    workflowApprovalRequests: [],
    workflowGateEvaluations: [],
    workflowRuns: [],
    workflowStepRuns: [],
  };
}

function requiredName(value: string, fallback: string): string {
  return value.trim() || fallback;
}
