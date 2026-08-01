import { Handle, NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { ArrowRight, Bot, Check, ChevronDown, Clock, Expand, FileText, GripVertical, ImageIcon, Info, Layers3, LockKeyhole, Play, Plus, RefreshCw, Trash2, Video } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { schemaForCapability } from '../core/capabilities';
import type { SwitchableOperationMode } from '../core/imageOperations';
import { operationDisplayState } from '../core/operationDisplay';
import { pluginCapabilityDefinitionFor } from '../core/pluginCapabilityDefinitions';
import { managedResultStatusMessageKey } from '../core/resultStatus';
import { storyboardSheetCapabilityId } from '../core/storyboardSheetContracts';
import { generationPreparationCapabilityId } from '../core/generationPreparationContracts';
import type { BlockData, BlockType, ExecutionConfigurationChangeKind, RetakeNode } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from '../components/Tooltip';
import { PluginBlockRendererSlot } from '../components/PluginBlockRendererHost';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { DocumentBlockBody } from './DocumentBlockBody';
import { OperationInlineControls } from './OperationInlineControls';
import { VideoBlockBody } from './VideoBlockBody';

const iconByType = {
  text: FileText,
  document: FileText,
  image: ImageIcon,
  video: Video,
  operation: Play,
  group: Layers3,
} satisfies Record<BlockType, typeof FileText>;

export function BlockNode({ data, id, type, selected }: NodeProps<RetakeNode>): ReactElement {
  const { t } = useI18n();
  const blockType = (type ?? 'text') as BlockType;
  const Icon = iconByType[blockType];
  const status = visibleBlockStatus(data as BlockData);
  const operationDisplay = blockType === 'operation' ? operationDisplayState(data as BlockData) : undefined;
  const showStatusBorder = blockType !== 'operation' && status;
  const hasImagePreview = blockType === 'image' && typeof (data as BlockData).previewUrl === 'string';
  const title = displayBlockTitle(data as BlockData, blockType, t);
  const isLocalCanvasOperation = blockType === 'operation' && data.adapter === 'local_canvas';
  const isStoryboardSheetOperation = blockType === 'operation' && data.capabilityId === storyboardSheetCapabilityId;
  const isGenerationPreparationOperation = blockType === 'operation'
    && data.capabilityId === generationPreparationCapabilityId;
  const isPluginOwnedOperation = blockType === 'operation'
    && typeof data.capabilityId === 'string'
    && (
      data.capabilityId === 'image.annotation_edit'
      || pluginCapabilityDefinitionFor(data.capabilityId) !== undefined
    );
  const hasWorkflowContinuation = blockType !== 'operation'
    && typeof data.artifactId === 'string'
    && typeof data.artifactRevisionId === 'string'
    && typeof data.artifactType === 'string';
  const [isHeadingHovered, setIsHeadingHovered] = useState(false);

  if (blockType === 'group') {
    const color = typeof data.groupColor === 'string' ? data.groupColor : 'neutral';
    const memberCount = typeof data.groupMemberCount === 'number' ? data.groupMemberCount : 0;
    const executionSummary = groupExecutionSummary(data as BlockData, t);
    return (
      <div className={`group-node is-${color} ${selected ? 'is-selected' : ''} ${data.groupCollapsed ? 'is-collapsed' : ''} ${data.groupDropTarget ? 'is-drop-target' : ''} ${data.groupDropDetach ? 'is-drop-detach' : ''} ${data.groupScopeSelected ? 'is-group-scope-selected' : ''} ${isHeadingHovered ? 'is-heading-hovered' : ''}`}>
        <NodeResizer
          isVisible={selected && !data.groupCollapsed && !data.groupContentLocked && !data.groupPositionLocked}
          minWidth={typeof data.groupMinWidth === 'number' ? data.groupMinWidth : 260}
          minHeight={typeof data.groupMinHeight === 'number' ? data.groupMinHeight : 180}
          onResizeEnd={(_event, params) => dispatchResizeGroup(id, params)}
        />
        <div
          className="group-title"
          onPointerEnter={() => setIsHeadingHovered(true)}
          onPointerLeave={() => setIsHeadingHovered(false)}
        >
          <Icon size={16} />
          <span>{title}</span>
          {data.groupPositionLocked || data.groupContentsLocked || data.groupContentLocked ? <LockKeyhole size={12} /> : null}
          <small>{executionSummary ? `${executionSummary} · ` : ''}{memberCount} {t('group.items')}</small>
        </div>
        {data.groupCollapsed ? (
          <div className="group-collapsed-summary">
            <span>{data.groupMediaCount ?? 0} {t('group.media')}</span>
            {(data.groupRunningCount ?? 0) > 0 ? <span className="is-running">{data.groupRunningCount} {t('status.running')}</span> : null}
            {(data.groupFailedCount ?? 0) > 0 ? <span className="is-failed">{data.groupFailedCount} {t('status.failed')}</span> : null}
          </div>
        ) : null}
        <Handle className="group-proxy-handle" type="target" position={Position.Left} isConnectable={false} />
        <Handle className="group-proxy-handle" type="source" position={Position.Right} isConnectable={false} />
      </div>
    );
  }

  if (blockType === 'operation' && data.operationCompact) {
    const resultCount = typeof data.operationCompactResultCount === 'number'
      ? data.operationCompactResultCount
      : 0;
    const changeLabel = data.operationQueuedConfigurationStale
      ? t('operationStatus.executionContentUpdated')
      : (data.operationChangeCount ?? 0) > 0
        ? `${data.operationChangeCount} ${t('operationStatus.changes')}`
        : undefined;
    return (
      <div
        className={`operation-compact-node${changeLabel ? ' has-change' : ''}`}
        aria-label={`${title} · ${t('status.succeeded')} · ${resultCount} ${t('group.items')}${changeLabel ? ` · ${changeLabel}` : ''}`}
        title={`${title} · ${resultCount} ${t('group.items')}${changeLabel ? ` · ${changeLabel}` : ''}`}
      >
        <Handle type="target" position={Position.Left} />
        <span className="operation-compact-status">
          {changeLabel ? <Clock size={14} /> : <Check size={14} />}
        </span>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  return (
    <div
      className={[
        'block-node',
        `block-node-${blockType}`,
        hasImagePreview ? 'has-media-preview' : '',
        showStatusBorder ? `has-status-${status}` : '',
        selected ? 'is-selected' : '',
        data.groupScopeSelected ? 'is-group-scope-selected' : '',
        data.groupContentLocked ? 'is-group-content-locked' : '',
        isHeadingHovered ? 'is-heading-hovered' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDoubleClick={(event) => {
        const target = event.target instanceof Element ? event.target : undefined;
        if (target && isInteractiveDoubleClickTarget(target)) return;
        if (blockType === 'image' && isImageDetailGestureTarget(target)) {
          dispatchOpenExecutionInspector(id);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        window.dispatchEvent(new CustomEvent('retake:select-connected-workflow', { detail: { blockId: id } }));
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Handle type="target" position={Position.Left} />
      {blockType === 'operation'
        && !isLocalCanvasOperation
        && !isStoryboardSheetOperation
        && !isGenerationPreparationOperation
        && !isPluginOwnedOperation
        ? <OperationInputQuickAdd data={data as BlockData} operationBlockId={id} />
        : null}
      <div
        className="block-heading"
        onPointerEnter={() => setIsHeadingHovered(true)}
        onPointerLeave={() => setIsHeadingHovered(false)}
      >
        {blockType === 'text' || blockType === 'operation'
          ? <GripVertical className="block-heading-drag-handle" size={13} />
          : null}
        <Icon size={16} />
        <span>{title}</span>
        {blockType === 'image'
          && typeof data.assetId === 'string'
          && hasExecutionDetails(data as BlockData) ? (
            <TooltipIconButton
              className="block-heading-agent-button nodrag nopan"
              disabled={data.groupContentLocked === true}
              label={t('block.image.useInAgent')}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                dispatchUseImageInAgent(id);
              }}
            >
              <Bot size={14} />
            </TooltipIconButton>
          ) : null}
        {blockType === 'operation'
          && !isLocalCanvasOperation
          && !isStoryboardSheetOperation
          && !isGenerationPreparationOperation
          && !isPluginOwnedOperation
          && data.capabilityId !== 'text.generate'
          && data.capabilityId !== 'image.generate'
          ? <OperationCapabilityControl blockId={id} data={data as BlockData} />
          : null}
        {operationDisplay?.executionBadge ? (
          <span
            className={`block-heading-status status-${operationDisplay.executionBadge.status} ${operationDisplay.executionBadge.historical ? 'is-history' : 'is-active'}`}
          >
            {t(operationDisplay.executionBadge.labelKey)}
          </span>
        ) : null}
        {blockType === 'operation' && !isLocalCanvasOperation && data.operationQueuedConfigurationStale ? (
          <span className="block-heading-status operation-dirty-status">
            {t('operationStatus.executionContentUpdated')}
          </span>
        ) : blockType === 'operation' && !isLocalCanvasOperation && (data.operationChangeCount ?? 0) > 0 ? (
          <span className="block-heading-status operation-dirty-status">
            {data.operationChangeCount} {t('operationStatus.changes')}
          </span>
        ) : null}
        {blockType === 'operation' && hasExecutionDetails(data as BlockData) ? (
          <ExecutionInfoButton
            blockId={id}
            className="block-heading-info-button nodrag nopan"
            label={t('inspector.openDetails')}
          />
        ) : null}
        {blockType === 'text' ? (
          <>
            <button
              type="button"
              className="block-heading-info-button nodrag nopan"
              aria-label={t('textEditor.open')}
              title={t('textEditor.open')}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                dispatchOpenTextBlockEditor(id);
              }}
            >
              <Expand size={14} />
            </button>
            <TooltipIconButton
              className="block-heading-delete-button nodrag nopan"
              disabled={data.groupContentLocked === true}
              label={t('toolbar.deleteSelection')}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                dispatchDeleteBlock(id);
              }}
            >
              <Trash2 size={13} />
            </TooltipIconButton>
          </>
        ) : null}
        {hasWorkflowContinuation ? (
          <button
            type="button"
            className="workflow-continuation-open nodrag nopan"
            aria-label={t('workflowContinuation.open')}
            title={t('workflowContinuation.open')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              window.dispatchEvent(new CustomEvent(
                'retake:open-workflow-continuation',
                { detail: { blockId: id } },
              ));
            }}
          >
            <span>{t('workflowContinuation.open')}</span>
            <ArrowRight size={13} />
          </button>
        ) : null}
        {blockType === 'operation' && !isLocalCanvasOperation && !isPluginOwnedOperation ? (
          <TooltipIconButton
            className="block-heading-agent-button nodrag nopan"
            disabled={data.groupContentLocked === true}
            label={t('operationToolbar.continueInAgent')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              dispatchBindAgentOperation(id);
            }}
          >
            <Bot size={14} />
          </TooltipIconButton>
        ) : null}
      </div>
      <PluginBlockRendererSlot
        blockId={id}
        coreFallback={(
          <BlockBody
            blockId={id}
            data={data as BlockData}
            title={title}
            type={blockType}
          />
        )}
        data={data as BlockData}
        selected={selected}
        type={blockType}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function dispatchResizeGroup(blockId: string, params: ResizeParams): void {
  window.dispatchEvent(
    new CustomEvent('retake:resize-group', {
      detail: { blockId, position: { x: params.x, y: params.y }, size: { width: params.width, height: params.height } },
    }),
  );
}

function isImageDetailGestureTarget(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest([
    '.block-heading',
    '.react-flow__handle',
    '.react-flow__resize-control',
    'button',
    'input',
    'select',
    'textarea',
  ].join(','));
}

function isInteractiveDoubleClickTarget(target: Element): boolean {
  return Boolean(
    target.closest(
      [
        'button',
        'input',
        'select',
        'textarea',
        '[role="menu"]',
        '.operation-side-popover',
        '.operation-input-quick-add',
        '.operation-reference-inputs',
        '.block-heading-info-button',
      ].join(','),
    ),
  );
}

function OperationCapabilityControl({
  blockId,
  data,
}: {
  blockId: string;
  data: BlockData;
}): ReactElement {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const operation = operationModeFromCapability(data);
  const isLocked = data.groupContentLocked === true;

  useEffect(() => {
    if (isLocked) setIsOpen(false);
  }, [isLocked]);

  useDismissiblePopover({
    active: isOpen,
    onDismiss: () => setIsOpen(false),
    rootRef: controlRef,
  });

  return (
    <div ref={controlRef} className="operation-capability-control nodrag nopan">
      <button
        type="button"
        aria-label={t('operationToolbar.capability')}
        aria-expanded={isOpen}
        disabled={isLocked}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
      >
        <ChevronDown size={14} />
      </button>
      {isOpen && !isLocked ? (
        <div className="operation-capability-menu" role="menu" aria-label={t('operationToolbar.capability')}>
          {operationOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={operation === option.value ? 'is-selected' : undefined}
              role="menuitem"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setIsOpen(false);
                dispatchUpdateOperationCapability(blockId, option.value);
              }}
            >
              <span>{operationLabel(option.value, t)}</span>
              {operation === option.value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OperationInputQuickAdd({
  data,
  operationBlockId,
}: {
  data: BlockData;
  operationBlockId: string;
}): ReactElement {
  const { t } = useI18n();
  const operation = operationModeFromCapability(data);
  const capabilityId = capabilityIdForOperationMode(operation, data);
  const inputTypes = new Set(
    schemaForCapability(capabilityId).inputContracts
      .filter((contract) => contract.source === 'block')
      .map((contract) => contract.type),
  );

  return (
    <div className="operation-input-quick-add nodrag nopan" aria-label={t('operationInputQuickAdd.title')}>
      {inputTypes.has('text') ? (
        <button
          type="button"
          aria-label={t('operationInputQuickAdd.addText')}
          disabled={data.groupContentLocked === true}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            dispatchAddOperationInput(operationBlockId, 'text');
          }}
        >
          <Plus size={13} />
          <span>{t('operationInputQuickAdd.text')}</span>
        </button>
      ) : null}
      {inputTypes.has('image') ? (
        <button
          type="button"
          aria-label={t('operationInputQuickAdd.addImage')}
          disabled={data.groupContentLocked === true}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            dispatchAddOperationInput(operationBlockId, 'image');
          }}
        >
          <Plus size={13} />
          <span>{t('operationInputQuickAdd.image')}</span>
        </button>
      ) : null}
    </div>
  );
}

function dispatchAddOperationInput(
  operationBlockId: string,
  type: 'image' | 'text' | 'video',
): void {
  window.dispatchEvent(
    new CustomEvent('retake:add-operation-input', {
      detail: { operationBlockId, type },
    }),
  );
}

function dispatchUpdateOperationCapability(blockId: string, operation: OperationMode): void {
  window.dispatchEvent(new CustomEvent('retake:update-operation-capability', { detail: { blockId, operation } }));
}

function dispatchRetryImageResult(blockId: string): void {
  window.dispatchEvent(new CustomEvent('retake:retry-image-result', { detail: { blockId } }));
}

function dispatchBindAgentOperation(blockId: string): void {
  window.dispatchEvent(new CustomEvent('retake:bind-agent-operation', {
    detail: { blockId },
  }));
}

function dispatchUseImageInAgent(blockId: string): void {
  window.dispatchEvent(new CustomEvent('retake:use-image-in-agent', {
    detail: { blockId },
  }));
}

function BlockBody({
  blockId,
  data,
  title,
  type,
}: {
  blockId: string;
  data: BlockData;
  title: string;
  type: BlockType;
}): ReactElement {
  const { t } = useI18n();

  if (type === 'image') {
    const status = visibleBlockStatus(data);
    if (!data.previewUrl) {
      const isManagedResult = typeof data.operationBlockId === 'string' || typeof data.sourceExecutionId === 'string';
      if (isManagedResult) {
        return (
          <div className="image-empty-state is-managed-result" aria-live="polite">
            <ResultBatchBadge data={data} />
            {hasExecutionDetails(data) ? (
              <ExecutionInfoButton
                blockId={blockId}
                className="image-info-button is-empty-result nodrag nopan"
                label={t('inspector.openDetails')}
              />
            ) : null}
            {status ? (
              <div className={`status-pill status-${status}`}>
                <Clock size={14} />
                <span>{t(`status.${status}`)}</span>
              </div>
            ) : null}
            <p>{managedResultDescription(data, t)}</p>
            {data.resultRetryMode ? (
              <button
                type="button"
                className="image-result-retry-button nodrag nopan"
                onClick={(event) => {
                  event.stopPropagation();
                  dispatchRetryImageResult(blockId);
                }}
              >
                <RefreshCw size={14} />
                <span>{t('result.retryCodex')}</span>
              </button>
            ) : null}
          </div>
        );
      }

      return (
        <div
          className="image-empty-state"
          role="button"
          aria-disabled={data.groupContentLocked === true}
          tabIndex={data.groupContentLocked ? -1 : 0}
          onClick={() => {
            if (!data.groupContentLocked) dispatchRequestImageImport(blockId);
          }}
          onKeyDown={(event) => {
            if (data.groupContentLocked) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            dispatchRequestImageImport(blockId);
          }}
        >
          {status ? (
            <div className={`status-pill status-${status}`}>
              <Clock size={14} />
              <span>{t(`status.${status}`)}</span>
            </div>
          ) : null}
          {data.body ? <p>{data.body}</p> : <p>{t('block.image.body')}</p>}
        </div>
      );
    }

    return (
      <div className="image-preview">
        <img src={data.previewUrl} alt={title} />
        <ResultBatchBadge data={data} />
        <ExecutionInfoButton
          blockId={blockId}
          className="image-info-button nodrag nopan"
          label={t('inspector.openDetails')}
        />
        {status ? (
          <div className={`status-pill image-status-pill status-${status}`}>
            <Clock size={14} />
            <span>{t(`status.${status}`)}</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (type === 'video') {
    return <VideoBlockBody blockId={blockId} data={data} />;
  }

  if (type === 'document') {
    return <DocumentBlockBody blockId={blockId} data={data} />;
  }

  if (type === 'operation') {
    return (
      <div className="operation-body">
        <OperationInlineControls blockId={blockId} data={data} />
      </div>
    );
  }

  return (
    <TextBlockBody
      blockId={blockId}
      body={data.body}
      placeholder={
        typeof data.placeholder === 'string'
          ? data.placeholder
          : data.promptRole === 'operation_prompt'
            ? t('operationToolbar.promptPlaceholder')
            : undefined
      }
      title={title}
      mentionsEnabled={data.promptRole === 'operation_prompt'}
      readOnly={
        data.groupContentLocked === true ||
        data.managedTextResult === true
      }
    />
  );
}

function ResultBatchBadge({ data }: { data: BlockData }): ReactElement | null {
  const index = typeof data.resultIndex === 'number' ? data.resultIndex : undefined;
  const count = typeof data.resultCount === 'number' ? data.resultCount : undefined;
  if (index === undefined || count === undefined || count <= 1) return null;
  return <span className="image-result-batch-badge">{index + 1} / {count}</span>;
}

function managedResultDescription(data: BlockData, t: ReturnType<typeof useI18n>['t']): string {
  const statusMessageKey = managedResultStatusMessageKey(data);
  if (statusMessageKey) return t(statusMessageKey);
  return data.body || t('block.image.body');
}

function TextBlockBody({
  blockId,
  body,
  placeholder,
  readOnly,
  title,
  mentionsEnabled,
}: {
  blockId: string;
  body?: string;
  mentionsEnabled: boolean;
  placeholder?: string;
  readOnly: boolean;
  title: string;
}): ReactElement {
  const [draftBody, setDraftBody] = useState(body ?? '');
  const composingRef = useRef(false);

  useEffect(() => {
    if (composingRef.current) return;
    setDraftBody(body ?? '');
  }, [body]);

  function commit(nextBody = draftBody): void {
    if (readOnly) return;
    if (nextBody === (body ?? '')) return;
    dispatchUpdateTextBlock(blockId, nextBody);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      commit(event.currentTarget.value);
      event.currentTarget.blur();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.currentTarget.blur();
    }
  }

  return (
    <textarea
      className="text-body-input nodrag nopan nowheel"
      aria-label={title}
      placeholder={placeholder}
      readOnly={readOnly}
      value={draftBody}
      onBlur={() => commit()}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const nextBody = event.currentTarget.value;
        setDraftBody(nextBody);
        dispatchPreviewTextBlock(blockId, nextBody);
      }}
      onChange={(event) => {
        const nextBody = event.target.value;
        const cursorIndex = event.target.selectionStart ?? nextBody.length;
        const insertedMentionTrigger =
          mentionsEnabled &&
          nextBody.length === draftBody.length + 1 &&
          nextBody[cursorIndex - 1] === '@';
        setDraftBody(nextBody);
        if (!composingRef.current) dispatchPreviewTextBlock(blockId, nextBody);
        if (insertedMentionTrigger) {
          dispatchUpdateTextBlock(blockId, nextBody);
          const rect = event.currentTarget.getBoundingClientRect();
          dispatchRequestImageMention(blockId, nextBody, cursorIndex, {
            x: rect.left + 18,
            y: rect.bottom + 6,
          });
        }
      }}
      onDoubleClick={(event) => {
        dispatchOpenTextBlockEditor(blockId);
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}

function dispatchRequestImageMention(
  textBlockId: string,
  body: string,
  cursorIndex: number,
  anchor: { x: number; y: number },
): void {
  window.dispatchEvent(
    new CustomEvent('retake:request-image-mention', {
      detail: { anchor, body, cursorIndex, textBlockId },
    }),
  );
}

function dispatchUpdateTextBlock(blockId: string, body: string): void {
  window.dispatchEvent(new CustomEvent('retake:update-text-block', { detail: { blockId, body } }));
}

function dispatchOpenTextBlockEditor(blockId: string): void {
  window.dispatchEvent(new CustomEvent('retake:open-text-block-editor', {
    detail: { blockId },
  }));
}

function dispatchDeleteBlock(blockId: string): void {
  window.dispatchEvent(new CustomEvent('retake:delete-block', {
    detail: { blockId },
  }));
}

function dispatchOpenExecutionInspector(blockId: string): void {
  window.dispatchEvent(new CustomEvent('retake:open-execution-inspector', {
    detail: { blockId },
  }));
}

function dispatchPreviewTextBlock(blockId: string, body: string): void {
  window.dispatchEvent(new CustomEvent('retake:preview-text-block', { detail: { blockId, body } }));
}

function dispatchRequestImageImport(blockId: string): void {
  window.dispatchEvent(new CustomEvent('retake:request-image-import', { detail: { blockId } }));
}

type OperationMode = SwitchableOperationMode;
function ExecutionInfoButton({
  blockId,
  className,
  label,
}: {
  blockId: string;
  className: string;
  label: string;
}): ReactElement {
  return (
    <TooltipIconButton
      className={className}
      label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        dispatchOpenExecutionInspector(blockId);
      }}
    >
      <Info size={15} />
    </TooltipIconButton>
  );
}

function hasExecutionDetails(data: BlockData): boolean {
  return data.executionDetailsAvailable === true
    || typeof data.sourceExecutionId === 'string'
    || typeof data.agentPrompt === 'string';
}

function visibleBlockStatus(data: BlockData): BlockData['status'] | undefined {
  if (!data.status) return undefined;
  if (data.statusVisualDismissed) return undefined;
  return data.status;
}

type Translate = ReturnType<typeof useI18n>['t'];

function groupExecutionSummary(data: BlockData, t: Translate): string | undefined {
  if (data.groupKind !== 'execution_results') return undefined;
  const changeKinds = data.executionChangeKinds ?? [];
  const changeSummary = changeKinds.length
    ? changeKinds.map((kind) => t(configurationChangeLabelKey(kind))).join(' + ')
    : t(data.executionVersion === 1 ? 'configuration.initial' : 'configuration.noChanges');
  if (typeof data.executionVersion !== 'number') {
    return data.executionStatus === 'queued'
      ? `${t('configuration.pendingExecution')}${changeKinds.length ? ` · ${changeSummary}` : ''}`
      : undefined;
  }
  return `V${data.executionVersion} · ${changeSummary}`;
}

function configurationChangeLabelKey(kind: ExecutionConfigurationChangeKind) {
  return `configuration.${kind}` as const;
}

function displayBlockTitle(data: BlockData, type: BlockType, t: Translate): string {
  if (type === 'group' && data.groupKind === 'execution_results') return t('group.executionResults');
  if (type === 'operation') {
    const operationMode = operationModeFromCapability(data);
    const capabilityId = typeof data.capabilityId === 'string' ? data.capabilityId : undefined;
    if (capabilityId === 'image.annotation_edit') return t('operation.annotationEdit.title');
    if (capabilityId === 'text.generate') return t('operation.generateText.title');
    if (capabilityId === 'image.text_to_image' || capabilityId === 'image.generate') return t('operation.generateImage.title');
    if (capabilityId === 'image.image_to_image' || capabilityId === 'image.edit') return data.title || t('operation.quickEdit.title');
    if (capabilityId === 'image.generate.similar') return t('operation.quickEdit.title');
    if (capabilityId) return data.title;
    if (operationMode === 'image_to_image') return t('operation.quickEdit.title');
    return data.title;
  }

  if (type === 'text' && data.promptRole === 'operation_prompt') return t('operationToolbar.prompt');
  if (type !== 'image') return data.title;

  const capabilityId = typeof data.capabilityId === 'string' ? data.capabilityId : undefined;
  if (capabilityId === 'image.annotation_edit') return t('operation.annotationEdit.title');
  if (capabilityId === 'image.text_to_image' || capabilityId === 'image.generate') return t('operation.generateImage.title');
  if (data.operationMode === 'image_to_image' || data.operationMode === 'quick_edit' || data.operationMode === 'create_similar') {
    return t('operation.quickEdit.title');
  }
  if (capabilityId === 'image.image_to_image' || capabilityId === 'image.edit') return data.title || t('operation.quickEdit.title');
  if (capabilityId === 'image.generate.similar') return t('operation.quickEdit.title');
  return data.title;
}

function operationModeFromCapability(data: BlockData): OperationMode {
  if (data.operationMode === 'text_to_image' || data.operationMode === 'generate_image') return 'text_to_image';
  if (data.operationMode === 'image_to_image' || data.operationMode === 'quick_edit' || data.operationMode === 'create_similar') {
    return 'image_to_image';
  }
  if (data.capabilityId === 'image.image_to_image' || data.capabilityId === 'image.edit') return 'image_to_image';
  if (data.capabilityId === 'image.generate.similar') return 'image_to_image';
  return 'text_to_image';
}

const operationOptions: Array<{ value: OperationMode }> = [
  { value: 'text_to_image' },
  { value: 'image_to_image' },
];

function operationLabel(operation: OperationMode, t: Translate): string {
  if (operation === 'text_to_image') return t('operation.generateImage.title');
  return t('operation.quickEdit.title');
}

function capabilityIdForOperationMode(operation: OperationMode, data: BlockData): string {
  const existingCapabilityId = typeof data.capabilityId === 'string' ? data.capabilityId : undefined;
  if (
    existingCapabilityId &&
    operation === operationModeFromCapability(data) &&
    existingCapabilityId !== 'image.generate.similar' &&
    !existingCapabilityId.startsWith('image.local_')
  ) {
    return existingCapabilityId;
  }
  if (operation === 'text_to_image') return 'image.text_to_image';
  return 'image.image_to_image';
}
