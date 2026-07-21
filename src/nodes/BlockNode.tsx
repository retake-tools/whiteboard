import { Handle, NodeResizer, Position, type NodeProps, type ResizeParams } from '@xyflow/react';
import { Check, ChevronDown, Clock, FileText, ImageIcon, Info, Layers3, LockKeyhole, Play, Plus, RefreshCw, Video } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { isLocalCanvasCapability, schemaForCapability } from '../core/capabilities';
import type { SwitchableOperationMode } from '../core/imageOperations';
import { operationDisplayState } from '../core/operationDisplay';
import { managedResultStatusMessageKey } from '../core/resultStatus';
import type { BlockData, BlockType, ExecutionConfigurationChangeKind, ExecutionInputRole, RetakeNode } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from '../components/Tooltip';
import { InputRoleOptionList, inputRoleTitle } from '../components/InputRoleOptionList';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { AnnotationOperationPreviewButton } from './AnnotationOperationPreviewButton';
import { OperationInlineControls } from './OperationInlineControls';
import { VideoBlockBody } from './VideoBlockBody';

const iconByType = {
  text: FileText,
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
  const isLocalCanvasOperation = blockType === 'operation' && isLocalCanvasCapability(data.capabilityId);
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
        if (
          blockType !== 'text' &&
          blockType !== 'operation' &&
          event.target instanceof HTMLElement &&
          isInteractiveDoubleClickTarget(event.target)
        ) return;
        window.dispatchEvent(new CustomEvent('retake:select-connected-workflow', { detail: { blockId: id } }));
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Handle type="target" position={Position.Left} />
      {blockType === 'operation' && !isLocalCanvasOperation ? <OperationInputQuickAdd data={data as BlockData} operationBlockId={id} /> : null}
      {data.operationInputEdgeId ? (
        <OperationInputRoleBadge data={data as BlockData} />
      ) : null}
      <div
        className="block-heading"
        onPointerEnter={() => setIsHeadingHovered(true)}
        onPointerLeave={() => setIsHeadingHovered(false)}
      >
        <Icon size={16} />
        <span>{title}</span>
        {blockType === 'operation' && !isLocalCanvasOperation && data.capabilityId !== 'text.generate'
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
        {blockType === 'operation' && data.capabilityId === 'image.annotation_edit' && typeof data.sourceExecutionId === 'string' ? (
          <AnnotationOperationPreviewButton
            executionId={data.sourceExecutionId}
            label={t('inspector.restoreAnnotationDraft')}
            markCount={data.annotationMarkCount}
            previewLabel={t('inspector.annotationPreview')}
            previewUrl={data.annotatedCompositePreviewUrl}
          />
        ) : null}
        {blockType === 'operation' && hasExecutionDetails(data as BlockData) ? (
          <ExecutionInfoButton
            blockId={id}
            className="block-heading-info-button nodrag nopan"
            label={t('inspector.openDetails')}
          />
        ) : null}
      </div>
      <BlockBody blockId={id} data={data as BlockData} title={title} type={blockType} />
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

function isInteractiveDoubleClickTarget(target: HTMLElement): boolean {
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
        '.operation-input-role-control',
        '.block-heading-info-button',
      ].join(','),
    ),
  );
}

function OperationInputRoleBadge({ data }: { data: BlockData }): ReactElement | null {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<'above' | 'below'>('below');
  const [menuMaxHeight, setMenuMaxHeight] = useState(420);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const role = data.operationInputRole;
  const edgeId = data.operationInputEdgeId;
  const options = data.operationInputRoleOptions ?? [];
  const disabledOptions = data.operationInputRoleDisabledOptions ?? [];
  const isPending = data.operationInputRolePending === true;
  const isLocked = data.groupContentLocked === true || data.operationInputRoleLocked === true;

  function updateMenuPlacement(): void {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const availableAbove = Math.max(180, rect.top - 12);
    const availableBelow = Math.max(180, window.innerHeight - rect.bottom - 12);
    const placement = availableBelow < 420 && availableAbove > availableBelow ? 'above' : 'below';
    setMenuPlacement(placement);
    setMenuMaxHeight(Math.min(420, placement === 'above' ? availableAbove : availableBelow));
  }

  useEffect(() => {
    if (isPending) updateMenuPlacement();
  }, [isPending]);

  useEffect(() => {
    if (isLocked) setIsOpen(false);
  }, [isLocked]);

  useDismissiblePopover({
    active: isOpen && !isPending,
    onDismiss: () => setIsOpen(false),
    rootRef: controlRef,
  });

  if (!edgeId) return null;

  return (
    <div ref={controlRef} className="operation-input-role-control nodrag nopan">
      <button
        ref={buttonRef}
        type="button"
        className={`operation-input-role-badge ${role ? `is-${role}` : 'is-pending'}`}
        aria-expanded={isOpen}
        aria-label={role ? inputRoleTitle(role, t) : t('operationInputRole.choose')}
        disabled={isLocked}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          updateMenuPlacement();
          setIsOpen((current) => !current);
        }}
      >
        {role ? inputRoleTitle(role, t) : t('operationInputRole.choose')}
      </button>
      {!isLocked && (isOpen || isPending) && options.length > 0 ? (
        <div
          className={`operation-input-role-menu is-${menuPlacement}`}
          role="menu"
          aria-label={t('operationInputRole.change')}
          style={{ maxHeight: menuMaxHeight }}
        >
          <strong className="operation-input-role-menu-title">{t('operationInputRole.pickerTitle')}</strong>
          <p>{t('operationInputRole.pickerDescription')}</p>
          <InputRoleOptionList
            currentRole={role}
            disabledRoles={disabledOptions}
            roles={options}
            onSelect={(option) => {
              setIsOpen(false);
              dispatchUpdateOperationInputRole(edgeId, option);
            }}
            onRemove={role ? () => dispatchRemoveOperationInput(edgeId) : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

function dispatchRemoveOperationInput(edgeId: string): void {
  window.dispatchEvent(new CustomEvent('retake:remove-operation-input', { detail: { edgeId } }));
}

function dispatchUpdateOperationInputRole(edgeId: string, inputRole: ExecutionInputRole): void {
  window.dispatchEvent(
    new CustomEvent('retake:update-operation-input-role', {
      detail: { edgeId, inputRole },
    }),
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
        {hasExecutionDetails(data) ? (
          <ExecutionInfoButton
            blockId={blockId}
            className="image-info-button nodrag nopan"
            label={t('inspector.openDetails')}
          />
        ) : null}
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
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.currentTarget.blur();
    }
  }

  return (
    <textarea
      className="text-body-input nodrag nopan"
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
        window.dispatchEvent(new CustomEvent('retake:select-connected-workflow', { detail: { blockId } }));
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
        window.dispatchEvent(new CustomEvent('retake:open-execution-inspector', { detail: { blockId } }));
      }}
    >
      <Info size={15} />
    </TooltipIconButton>
  );
}

function hasExecutionDetails(data: BlockData): boolean {
  return typeof data.sourceExecutionId === 'string' || typeof data.agentPrompt === 'string';
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
    if (operationMode === 'image_to_image') return t('operation.quickEdit.title');
    if (capabilityId === 'image.image_to_image' || capabilityId === 'image.edit') return data.title || t('operation.quickEdit.title');
    if (capabilityId === 'image.generate.similar') return t('operation.quickEdit.title');
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
