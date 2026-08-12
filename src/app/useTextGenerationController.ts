import type { RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import { isTextDocumentCapability } from '../core/capabilityRegistry';
import { loadProjectArtifactAuthority } from '../core/artifactLibraryClient';
import { loadBoardSnapshot } from '../core/boardStore';
import { appendDocumentStream, beginDocumentStream } from '../core/documentStreamStore';
import { subscribeExecutionEvents } from '../core/executionEventClient';
import { generationPreparationCapabilityId } from '../core/generationPreparationContracts';
import { blockLockedByGroup } from '../core/grouping';
import type { ResolvedPackageComposerInvocation } from '../core/packageComposer';
import type { ResolvedPackageEntryPointTarget } from '../core/packageRegistry';
import { startTextGeneration } from '../core/textGenerationClient';
import type { TextGenerationLabels } from '../core/textOperations';
import type { BlockRecord, BoardSnapshot } from '../core/types';
import type { CanvasHostScopeV1 } from '../host-kit';
import type { useI18n } from '../i18n';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';
import { textGenerationLabelsForSkill } from './skillTextLabels';

interface TextGenerationControllerOptions {
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  focusWorkflowBlocks: (blockIds: string[]) => void;
  getViewportCenter: () => { x: number; y: number };
  locale: string;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  selectedBlockIdsRef: RefObject<string[]>;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useTextGenerationController(options: TextGenerationControllerOptions) {
  const {
    adoptDurableSnapshot,
    focusWorkflowBlocks,
    getViewportCenter,
    locale,
    runProductCommand,
    setOperationToast,
    setSelectedBlocks,
    selectedBlockIdsRef,
    snapshotRef,
    t,
  } = options;

  async function createTextGenerationDraft(): Promise<void> {
    const draft = await requireProductCommands(runProductCommand)(
      (commands) => commands.operationDraft.createText({
        labels: labels(),
        placementCenter: getViewportCenter(),
      }),
      { history: true },
    );
    selectAndFocus(draft.blockIds);
  }

  async function createSkillDraft(
    target: Extract<ResolvedPackageEntryPointTarget, { kind: 'skill' }>,
    composer?: ResolvedPackageComposerInvocation,
  ): Promise<void> {
    const capabilityId = target.capabilityLock.capabilityId;
    const skillId = target.entrypoint.ref.skillId;
    const unitId = inlineString(composer, 'unit_id');
    const draft = await requireProductCommands(runProductCommand)(
      (commands) => commands.operationDraft.createSkill({
        capabilityId,
        explicitInputBindings: composer?.invocation.mentions.map((mention) => mention.kind === 'block'
          ? { kind: 'block' as const, blockId: mention.blockId, inputSlotId: mention.slotId }
          : { kind: 'asset' as const, assetId: mention.assetId, inputSlotId: mention.slotId }),
        initialText: composer?.instructionSlotId && composer.invocation.instruction
          ? { body: composer.invocation.instruction, inputSlotId: composer.instructionSlotId }
          : undefined,
        labels: textGenerationLabelsForSkill(skillId, locale, t),
        packageContext: {
          entrypointId: target.entrypoint.entrypointId,
          packageLock: target.packageLock,
        },
        parameters: composer?.invocation.parameters,
        placementCenter: getViewportCenter(),
        referenceManifest: inlineValue(composer, 'reference_manifest'),
        selectedBlockIds: composer ? [] : selectedBlockIdsRef.current,
        skillId,
        unitId,
      }),
      { history: true },
    );
    selectAndFocus(draft.blockIds);
  }

  async function startTextGenerationOperation(block: BlockRecord): Promise<void> {
    if (
      block.type !== 'operation'
      || !isTextDocumentCapability(currentCapabilityId(block))
      || blockLockedByGroup(snapshotRef.current, block.blockId)
    ) return;
    let executionId = '';
    const initialScope = scopeFor(snapshotRef.current);
    const capabilityId = currentCapabilityId(block);
    try {
      const artifactLibrary = capabilityId === generationPreparationCapabilityId
        ? await loadProjectArtifactAuthority(initialScope.projectId)
        : undefined;
      const queued = await requireProductCommands(runProductCommand)(
        (commands) => commands.textGeneration.queue({
          artifactLibrary,
          connectionUnavailableMessage: t('feedback.connectionUnavailable'),
          expectedScope: initialScope,
          labels: labelsForOperation(block),
          operationBlockId: block.blockId,
        }),
        { history: true },
      );
      executionId = queued.executionId;
      beginDocumentStream(queued.resultBlockId);
      let finishStream: ((snapshot: BoardSnapshot) => void) | undefined;
      let failStream: ((error: Error) => void) | undefined;
      const streamCompletion = new Promise<BoardSnapshot>((resolve, reject) => {
        finishStream = resolve;
        failStream = reject;
      });
      const unsubscribe = subscribeExecutionEvents({
        ...queued.scope,
        executionId,
        onError: () => failStream?.(new Error('Execution event stream disconnected.')),
        onEvent: (event) => {
          if (event.type === 'text.delta') {
            appendDocumentStream(event.resultBlockId, event.delta);
          } else if (event.type === 'execution.snapshot') {
            finishStream?.(event.snapshot);
          } else if (event.type === 'execution.failed') {
            if (event.snapshot) adoptIfCurrent(event.snapshot);
            failStream?.(new Error(event.errorMessage));
          }
        },
      });
      try {
        const started = await startTextGeneration({
          ...queued.scope,
          executionId,
          connectionId: queued.connectionId,
        });
        adoptIfCurrent(started.snapshot);
        if (isCurrentScope(queued.scope)) {
          setSelectedBlocks(snapshotRef.current, [queued.resultBlockId]);
        }
        setOperationToast({
          id: executionId,
          title: t(feedbackTitleKey(queued.capabilityId, 'started')),
          tone: 'success',
        });
        try {
          const completedSnapshot = await streamCompletion;
          adoptIfCurrent(completedSnapshot);
          showTextExecutionResult(executionId, completedSnapshot);
        } catch {
          await pollTextExecution(executionId, queued.scope);
        }
      } finally {
        unsubscribe();
      }
    } catch (error) {
      setOperationToast({
        id: executionId || `text-generation:${block.blockId}`,
        title: t(feedbackTitleKey(capabilityId, 'failed')),
        body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
        tone: 'error',
      });
    }
  }

  async function pollTextExecution(
    executionId: string,
    scope: CanvasHostScopeV1,
  ): Promise<void> {
    while (true) {
      await delay(1_000);
      const latest = await loadBoardSnapshot(scope);
      const execution = latest.executions.find((candidate) => candidate.executionId === executionId);
      adoptIfCurrent(latest);
      if (!execution) throw new Error(`Text execution disappeared while waiting: ${executionId}`);
      if (execution.status === 'queued' || execution.status === 'running') continue;
      showTextExecutionResult(executionId, latest);
      return;
    }
  }

  function adoptIfCurrent(snapshot: BoardSnapshot): boolean {
    if (!isCurrentScope(scopeFor(snapshot))) return false;
    adoptDurableSnapshot(snapshot);
    return true;
  }

  function isCurrentScope(scope: CanvasHostScopeV1): boolean {
    return snapshotRef.current.project.projectId === scope.projectId
      && snapshotRef.current.board.boardId === scope.boardId;
  }

  function selectAndFocus(blockIds: string[]): void {
    if (blockIds.length === 0) return;
    setSelectedBlocks(snapshotRef.current, blockIds);
    focusWorkflowBlocks(blockIds);
  }

  function showTextExecutionResult(executionId: string, snapshot: BoardSnapshot): void {
    const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
    if (!execution) return;
    setOperationToast({
      id: executionId,
      title: t(feedbackTitleKey(
        execution.capabilityId,
        execution.status === 'succeeded' ? 'completed' : 'failed',
      )),
      body: execution.status === 'failed' ? execution.errorMessage : undefined,
      tone: execution.status === 'succeeded' ? 'success' : 'error',
    });
  }

  function labels(): TextGenerationLabels {
    return {
      operationTitle: t('operation.generateText.title'),
      promptPlaceholder: t('operationToolbar.promptPlaceholder'),
      promptTitle: t('operationToolbar.prompt'),
      resultTitle: t('operation.generateText.title'),
      waitingBody: t('resultStatus.queued'),
    };
  }

  function labelsForOperation(operation: BlockRecord): TextGenerationLabels {
    return typeof operation.data.skillId === 'string'
      ? textGenerationLabelsForSkill(operation.data.skillId, locale, t)
      : labels();
  }

  return { createSkillDraft, createTextGenerationDraft, startTextGenerationOperation };
}

function currentCapabilityId(block: BlockRecord): string {
  return typeof block.data.capabilityId === 'string' ? block.data.capabilityId : 'text.generate';
}

function feedbackTitleKey(
  capabilityId: string,
  state: 'started' | 'completed' | 'failed',
):
  | 'feedback.textGenerationStarted'
  | 'feedback.textGenerationCompleted'
  | 'feedback.textGenerationFailed'
  | 'feedback.screenplayStarted'
  | 'feedback.screenplayCompleted'
  | 'feedback.screenplayFailed' {
  if (!capabilityId.startsWith('story.screenplay.')) {
    if (state === 'started') return 'feedback.textGenerationStarted';
    if (state === 'completed') return 'feedback.textGenerationCompleted';
    return 'feedback.textGenerationFailed';
  }
  if (state === 'started') return 'feedback.screenplayStarted';
  if (state === 'completed') return 'feedback.screenplayCompleted';
  return 'feedback.screenplayFailed';
}

function inlineValue(
  composer: ResolvedPackageComposerInvocation | undefined,
  slotId: string,
): unknown {
  return composer?.invocation.inlineValues?.find((value) => value.slotId === slotId)?.value;
}

function inlineString(
  composer: ResolvedPackageComposerInvocation | undefined,
  slotId: string,
): string | undefined {
  const value = inlineValue(composer, slotId);
  return typeof value === 'string' ? value : undefined;
}

function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}

function requireProductCommands(
  runProductCommand: TextGenerationControllerOptions['runProductCommand'],
): NonNullable<TextGenerationControllerOptions['runProductCommand']> {
  if (!runProductCommand) {
    throw new Error('Whiteboard Text generation command facade is unavailable.');
  }
  return runProductCommand;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
