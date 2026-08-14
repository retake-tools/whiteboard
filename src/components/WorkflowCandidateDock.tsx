import { Check, File, FileText, Film, Image as ImageIcon } from 'lucide-react';
import { memo, type ReactElement } from 'react';
import { getAssetPreviewUrl } from '../core/assetStore';
import type { AgentRunRecord } from '../core/agentRuntimeContracts';
import type { BlockRecord, BoardSnapshot } from '../core/types';
import type { WorkflowStepRunRecord } from '../core/workflowRuntimeContracts';
import { useI18n } from '../i18n';

interface WorkflowCandidateDockProps {
  agentRun?: AgentRunRecord;
  onAcceptCandidate: (
    stepRunId: string,
    assetId: string,
    expectedStepRunVersion: number,
  ) => void | Promise<void>;
  onOpenCandidateDetails: (blockId: string) => void;
  onSelectBlock: (blockId: string) => void;
  selectedBlockId?: string;
  snapshot: BoardSnapshot;
}

export const WorkflowCandidateDock = memo(function WorkflowCandidateDock({
  agentRun,
  onAcceptCandidate,
  onOpenCandidateDetails,
  onSelectBlock,
  selectedBlockId,
  snapshot,
}: WorkflowCandidateDockProps): ReactElement | null {
  const { locale } = useI18n();
  const decision = workflowCandidateDecision(snapshot, agentRun);
  if (!decision || decision.candidates.length === 0) return null;
  const selectedCandidate = decision.candidates.find(
    (candidate) => candidate.block.blockId === selectedBlockId,
  );

  return (
    <section
      className="generation-candidate-dock workflow-candidate-dock"
      aria-label={locale === 'zh' ? 'Workflow 候选结果' : 'Workflow candidates'}
    >
      <header>
        <div>
          <strong>{decision.label}</strong>
          <small>{locale === 'zh' ? '选择一个结果后继续 Workflow' : 'Choose a result to continue the Workflow'}</small>
        </div>
        <span>{decision.candidates.length}</span>
      </header>
      <div className="generation-candidate-strip">
        {decision.candidates.map((candidate, index) => {
          const selected = candidate.block.blockId === selectedBlockId;
          return (
            <button
              key={candidate.assetId}
              type="button"
              className={selected ? 'is-previewing' : undefined}
              aria-pressed={selected}
              onClick={() => onSelectBlock(candidate.block.blockId)}
              onDoubleClick={(event) => {
                event.preventDefault();
                onOpenCandidateDetails(candidate.block.blockId);
              }}
            >
              <span className="generation-candidate-preview">
                {candidate.previewUrl && candidate.kind === 'image' ? (
                  <img src={candidate.previewUrl} alt="" />
                ) : (
                  <span aria-hidden="true">{assetKindIcon(candidate.kind)}</span>
                )}
              </span>
              <span className="generation-candidate-label">
                {locale === 'zh' ? `候选 ${index + 1}` : `Candidate ${index + 1}`}
              </span>
              {selected ? (
                <span className="generation-candidate-previewing">
                  <Check size={10} />
                  {locale === 'zh' ? '预览中' : 'Previewing'}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <footer>
        <small>
          {locale === 'zh'
            ? '单击预览，双击查看详情；“选用并继续”才会写入当前 StepRun。'
            : 'Click to preview, double-click for details; continue writes to the current StepRun.'}
        </small>
        <button
          type="button"
          disabled={!selectedCandidate}
          onClick={() => selectedCandidate
            ? void onAcceptCandidate(
                decision.step.stepRunId,
                selectedCandidate.assetId,
                decision.step.recordVersion,
              )
            : undefined}
        >
          <Check size={14} />
          {locale === 'zh' ? '选用并继续' : 'Use and continue'}
        </button>
      </footer>
    </section>
  );
});

export interface WorkflowCandidateDecision {
  candidates: Array<{
    assetId: string;
    block: BlockRecord;
    kind: string;
    previewUrl?: string;
  }>;
  label: string;
  step: WorkflowStepRunRecord;
}

export function workflowCandidateDecision(
  snapshot: BoardSnapshot,
  agentRun?: AgentRunRecord,
): WorkflowCandidateDecision | undefined {
  if (!agentRun || agentRun.target.kind === 'capability') return undefined;
  const workflowRunId = agentRun.target.workflowRunId;
  const workflowRun = snapshot.workflowRuns?.find(
    (candidate) => candidate.workflowRunId === workflowRunId,
  );
  const waitingStep = workflowRun?.stepRunIds
    .map((stepRunId) => snapshot.workflowStepRuns?.find((step) => step.stepRunId === stepRunId))
    .find((step): step is WorkflowStepRunRecord => (
      step?.status === 'waiting_selection'
      && step.outputAcceptancePolicy !== 'automatic'
      && step.outputAssetIds.length > 0
    ));
  if (!waitingStep) return undefined;
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const assetById = new Map(snapshot.assets.map((asset) => [asset.assetId, asset]));
  const candidates = waitingStep.outputAssetIds.flatMap((assetId) => {
    const asset = assetById.get(assetId);
    if (!asset) return [];
    const block = waitingStep.outputBlockIds
      .map((blockId) => blockById.get(blockId))
      .find((candidate) => candidate?.data.assetId === assetId)
      ?? snapshot.blocks.find((candidate) => candidate.data.assetId === assetId);
    if (!block) return [];
    return [{
      assetId,
      block,
      kind: asset.kind,
      previewUrl: getAssetPreviewUrl(snapshot.assets, assetId),
    }];
  });
  const operation = blockById.get(waitingStep.operationBlockId);
  return {
    candidates,
    label: operation?.data.title?.trim() || waitingStep.stepId,
    step: waitingStep,
  };
}

function assetKindIcon(kind: string): ReactElement {
  if (kind === 'document') return <FileText size={22} />;
  if (kind === 'video') return <Film size={22} />;
  if (kind === 'image') return <ImageIcon size={22} />;
  return <File size={22} />;
}
