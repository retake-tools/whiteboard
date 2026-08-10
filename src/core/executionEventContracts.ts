export type ExecutionProgressPhase =
  | 'board_writing'
  | 'provider_generating'
  | 'provider_starting'
  | 'result_importing';

export interface ExecutionProgressEvent {
  type: 'execution.progress';
  current?: number;
  message?: string;
  phase?: ExecutionProgressPhase;
  total?: number;
}
