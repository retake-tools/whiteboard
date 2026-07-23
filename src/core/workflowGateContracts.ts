import type { WorkflowGateDefinitionLock } from './workflowRuntimeContracts';

export type WorkflowGateEvaluationStatus = 'waiting_approval' | 'passed' | 'failed';
export type WorkflowGateFreshness = 'current' | 'outdated';
export type WorkflowApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'outdated';
export type WorkflowApprovalDecisionValue = 'approve' | 'reject';

export interface WorkflowGateEvaluationRecord {
  approvalRequestId: string;
  boardId: string;
  createdAt: string;
  freshness: WorkflowGateFreshness;
  gateDefinitionLock: WorkflowGateDefinitionLock;
  subjectArtifactId?: string;
  subjectArtifactRevisionId?: string;
  gateEvaluationId: string;
  gateId: string;
  projectId: string;
  recordVersion: number;
  status: WorkflowGateEvaluationStatus;
  subjectAssetIds: string[];
  subjectExecutionIds: string[];
  subjectFingerprint: string;
  updatedAt: string;
  workflowRunId: string;
}

export interface WorkflowApprovalRequestRecord {
  approvalRequestId: string;
  boardId: string;
  createdAt: string;
  gateEvaluationId: string;
  projectId: string;
  recordVersion: number;
  requestedAt: string;
  status: WorkflowApprovalRequestStatus;
  subjectArtifactId?: string;
  subjectArtifactRevisionId?: string;
  subjectAssetIds: string[];
  subjectExecutionIds: string[];
  subjectFingerprint: string;
  updatedAt: string;
  workflowRunId: string;
}

export interface WorkflowApprovalDecisionRecord {
  approvalDecisionId: string;
  approvalRequestId: string;
  boardId: string;
  decidedAt: string;
  decidedBy: {
    actorId: 'user_local';
    actorType: 'user';
  };
  decision: WorkflowApprovalDecisionValue;
  expectedApprovalRequestVersion: number;
  gateEvaluationId: string;
  projectId: string;
  reason?: string;
  recordVersion: 1;
  subjectArtifactId?: string;
  subjectArtifactRevisionId?: string;
  subjectAssetIds: string[];
  subjectExecutionIds: string[];
  subjectFingerprint: string;
  workflowRunId: string;
}
