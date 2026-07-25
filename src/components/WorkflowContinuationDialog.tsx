import { ArrowRight, GitBranch, Loader2, TriangleAlert, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { loadProjectArtifactAuthority } from '../core/artifactLibraryClient';
import type { BoardSnapshot } from '../core/types';
import {
  resolveWorkflowContinuation,
  type WorkflowContinuationBlockedReason,
  type WorkflowContinuationCandidate,
  type WorkflowContinuationGateStatus,
  type WorkflowContinuationResolution,
} from '../core/workflowContinuation';
import { workflowUiDefinitionFor } from '../core/workflowRegistry';
import { useI18n, type TranslationKey } from '../i18n';
import { useUnifiedComposerDraft } from './UnifiedComposerProvider';

interface WorkflowContinuationDialogProps {
  onPrepareComposer: () => void;
  snapshot: BoardSnapshot;
}

export function WorkflowContinuationDialog({
  onPrepareComposer,
  snapshot,
}: WorkflowContinuationDialogProps): ReactElement | null {
  const { t } = useI18n();
  const { isDirty, startWorkflowContinuation } = useUnifiedComposerDraft();
  const [sourceBlockId, setSourceBlockId] = useState<string>();
  const [resolution, setResolution] = useState<WorkflowContinuationResolution>();
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [replacementCandidateId, setReplacementCandidateId] = useState<string>();
  const requestVersionRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  async function refresh(blockId: string): Promise<WorkflowContinuationResolution | undefined> {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setIsLoading(true);
    setLoadError(undefined);
    try {
      const currentSnapshot = snapshotRef.current;
      const authority = await loadProjectArtifactAuthority(currentSnapshot.project.projectId);
      const next = resolveWorkflowContinuation(currentSnapshot, authority, blockId);
      if (requestVersionRef.current !== requestVersion) return undefined;
      setResolution(next);
      return next;
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) return undefined;
      setResolution(undefined);
      setLoadError(error instanceof Error ? error.message : t('workflowContinuation.loadFailed'));
      return undefined;
    } finally {
      if (requestVersionRef.current === requestVersion) setIsLoading(false);
    }
  }

  function close(): void {
    requestVersionRef.current += 1;
    setSourceBlockId(undefined);
    setResolution(undefined);
    setLoadError(undefined);
    setReplacementCandidateId(undefined);
    setIsLoading(false);
  }

  useEffect(() => {
    const open = (event: Event) => {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      setSourceBlockId(blockId);
      setReplacementCandidateId(undefined);
      void refresh(blockId);
    };
    window.addEventListener('retake:open-workflow-continuation', open);
    return () => window.removeEventListener('retake:open-workflow-continuation', open);
  }, []);

  useEffect(() => {
    if (!sourceBlockId) return;
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sourceBlockId]);

  useEffect(() => close(), [snapshot.board.boardId, snapshot.project.projectId]);

  if (!sourceBlockId) return null;
  const activeSourceBlockId = sourceBlockId;

  async function choose(candidate: WorkflowContinuationCandidate): Promise<void> {
    if (isDirty && replacementCandidateId !== candidate.candidateId) {
      setReplacementCandidateId(candidate.candidateId);
      return;
    }
    const latest = await refresh(activeSourceBlockId);
    if (!latest || latest.status !== 'ready') return;
    const currentCandidate = latest.candidates.find(
      (item) => item.candidateId === candidate.candidateId,
    );
    if (!currentCandidate) return;
    startWorkflowContinuation({
      entrypointId: currentCandidate.entrypointId,
      inlineValuesBySlot: currentCandidate.inlineValuesBySlot,
      mentions: [currentCandidate.mention],
    });
    onPrepareComposer();
    close();
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('retake:focus-unified-composer'));
    });
  }

  const sourceBlock = snapshot.blocks.find((block) => block.blockId === sourceBlockId);
  return (
    <div
      className="workflow-continuation-layer"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        aria-labelledby="workflow-continuation-title"
        aria-modal="true"
        className="workflow-continuation-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span className="workflow-continuation-eyebrow">
              <GitBranch size={14} />
              {t('workflowContinuation.eyebrow')}
            </span>
            <h2 id="workflow-continuation-title">{t('workflowContinuation.title')}</h2>
            <p>{t('workflowContinuation.description')}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={t('workflowContinuation.close')}
            className="workflow-continuation-close"
            onClick={close}
          >
            <X size={17} />
          </button>
        </header>

        <div className="workflow-continuation-source">
          <strong>{sourceBlock?.data.title ?? sourceBlockId}</strong>
          {resolution?.source ? (
            <>
              <span>{resolution.source.artifactType}</span>
              <code>{shortId(resolution.source.artifactRevisionId)}</code>
              <span>{t(gateStatusKey(resolution.source.gateStatus))}</span>
            </>
          ) : null}
        </div>

        {isLoading ? (
          <div className="workflow-continuation-state" role="status">
            <Loader2 className="workflow-continuation-spinner" size={20} />
            <span>{t('workflowContinuation.loading')}</span>
          </div>
        ) : loadError ? (
          <div className="workflow-continuation-state is-error" role="alert">
            <TriangleAlert size={20} />
            <span>{loadError}</span>
          </div>
        ) : resolution?.status === 'blocked' ? (
          <div className="workflow-continuation-state is-blocked" role="status">
            <TriangleAlert size={20} />
            <div>
              <strong>{t('workflowContinuation.blocked')}</strong>
              <p>{t(blockedReasonKey(resolution.blockedReason))}</p>
            </div>
          </div>
        ) : resolution?.status === 'ready' && resolution.candidates.length === 0 ? (
          <div className="workflow-continuation-state" role="status">
            <GitBranch size={20} />
            <div>
              <strong>{t('workflowContinuation.noCandidates')}</strong>
              <p>{t('workflowContinuation.noCandidatesBody')}</p>
            </div>
          </div>
        ) : resolution?.status === 'ready' ? (
          <div className="workflow-continuation-candidates">
            {resolution.candidates.map((candidate) => {
              const confirmsReplacement = isDirty
                && replacementCandidateId === candidate.candidateId;
              const workflowUi = workflowUiDefinitionFor(candidate.workflowDefinitionId);
              return (
                <article key={candidate.candidateId}>
                  <div>
                    <div className="workflow-continuation-candidate-heading">
                      <strong>{t(workflowUi.nameKey)}</strong>
                      {candidate.recommended ? (
                        <span>{t('workflowContinuation.recommended')}</span>
                      ) : null}
                    </div>
                    <p>{t(workflowUi.descriptionKey)}</p>
                    <dl>
                      <div>
                        <dt>{t('workflowContinuation.inputSlot')}</dt>
                        <dd><code>{candidate.inputSlotId}</code></dd>
                      </div>
                      <div>
                        <dt>{t('workflowContinuation.package')}</dt>
                        <dd>{candidate.packageId}</dd>
                      </div>
                      <div>
                        <dt>{t('workflowContinuation.missingInputs')}</dt>
                        <dd>{candidate.missingRequiredSlotIds.length > 0
                          ? candidate.missingRequiredSlotIds.join(', ')
                          : t('workflowContinuation.none')}</dd>
                      </div>
                    </dl>
                    {confirmsReplacement ? (
                      <p className="workflow-continuation-replace-warning" role="alert">
                        {t('workflowContinuation.replaceWarning')}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => void choose(candidate)}
                  >
                    {t(confirmsReplacement
                      ? 'workflowContinuation.replaceAndContinue'
                      : 'workflowContinuation.continue')}
                    <ArrowRight size={15} />
                  </button>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function gateStatusKey(status: WorkflowContinuationGateStatus): TranslationKey {
  if (status === 'passed') return 'workflowContinuation.gatePassed';
  if (status === 'waiting_approval') return 'workflowContinuation.gateWaiting';
  if (status === 'rejected') return 'workflowContinuation.gateRejected';
  if (status === 'outdated') return 'workflowContinuation.gateOutdated';
  return 'workflowContinuation.gateNotRequired';
}

function blockedReasonKey(reason: WorkflowContinuationBlockedReason): TranslationKey {
  const keys: Record<WorkflowContinuationBlockedReason, TranslationKey> = {
    artifact_not_found: 'workflowContinuation.artifactNotFound',
    artifact_outdated: 'workflowContinuation.artifactOutdated',
    artifact_pin_incomplete: 'workflowContinuation.artifactPinIncomplete',
    gate_outdated: 'workflowContinuation.gateOutdatedBody',
    gate_rejected: 'workflowContinuation.gateRejectedBody',
    gate_waiting_approval: 'workflowContinuation.gateWaitingBody',
    source_missing: 'workflowContinuation.sourceMissing',
  };
  return keys[reason];
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-7)}` : value;
}
