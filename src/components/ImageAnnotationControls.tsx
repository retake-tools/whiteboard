import {
  ArrowUpRight,
  Circle,
  Eraser,
  MapPin,
  MousePointer2,
  Paintbrush,
  PenLine,
  RectangleHorizontal,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { ReactElement } from 'react';
import type {
  AnnotationColor,
  AnnotationMark,
  AnnotationMarkKind,
  AnnotationStrokeSize,
} from '../core/imageAnnotations';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export type AnnotationTool = 'select' | AnnotationMarkKind | 'eraser';

const strokeOptions: AnnotationStrokeSize[] = ['xs', 's', 'm', 'l'];

export function AnnotationToolStrip({
  activeTool,
  canRedo,
  canUndo,
  onActiveToolChange,
  onClear,
  onRedo,
  onUndo,
}: {
  activeTool: AnnotationTool;
  canRedo: boolean;
  canUndo: boolean;
  onActiveToolChange: (tool: AnnotationTool) => void;
  onClear: () => void;
  onRedo: () => void;
  onUndo: () => void;
}): ReactElement {
  const { t } = useI18n();

  return (
    <div className="annotation-tool-strip" aria-label={t('context.annotationTools')}>
      <ToolButton active={activeTool === 'select'} label={t('context.selectMarkTool')} onClick={() => onActiveToolChange('select')}>
        <MousePointer2 size={15} />
      </ToolButton>
      <ToolButton active={activeTool === 'marker'} label={t('context.markerTool')} onClick={() => onActiveToolChange('marker')}>
        <MapPin size={15} />
      </ToolButton>
      <ToolButton active={activeTool === 'arrow'} label={t('context.arrowTool')} onClick={() => onActiveToolChange('arrow')}>
        <ArrowUpRight size={15} />
      </ToolButton>
      <ToolButton active={activeTool === 'pen'} label={t('context.penTool')} onClick={() => onActiveToolChange('pen')}>
        <PenLine size={15} />
      </ToolButton>
      <ToolButton active={activeTool === 'brush'} label={t('context.regionBrushTool')} onClick={() => onActiveToolChange('brush')}>
        <Paintbrush size={15} />
      </ToolButton>
      <ToolButton active={activeTool === 'rect'} label={t('context.rectangleTool')} onClick={() => onActiveToolChange('rect')}>
        <RectangleHorizontal size={15} />
      </ToolButton>
      <ToolButton active={activeTool === 'ellipse'} label={t('context.ellipseTool')} onClick={() => onActiveToolChange('ellipse')}>
        <Circle size={15} />
      </ToolButton>
      <ToolButton active={activeTool === 'eraser'} label={t('context.eraserTool')} onClick={() => onActiveToolChange('eraser')}>
        <Eraser size={15} />
      </ToolButton>
      <ToolButton disabled={!canUndo} label={t('context.undoAnnotation')} onClick={onUndo}>
        <Undo2 size={15} />
      </ToolButton>
      <ToolButton disabled={!canRedo} label={t('context.redoAnnotation')} onClick={onRedo}>
        <Redo2 size={15} />
      </ToolButton>
      <ToolButton label={t('context.clearAnnotationDraft')} onClick={onClear}>
        <RotateCcw size={15} />
      </ToolButton>
    </div>
  );
}

export function AnnotationSidePanel({
  colors,
  compiledInstruction,
  displayedSelectedMarkId,
  instruction,
  marks,
  missingIntentIds,
  onDeleteMark,
  onInstructionChange,
  onMarkFocus,
  onMarkIntentChange,
  onMarkSelect,
  onSelectedMarkColorChange,
  onStrokeSizeChange,
  selectedMarkId,
  strokeSize,
}: {
  colors: AnnotationColor[];
  compiledInstruction: string;
  displayedSelectedMarkId: string | null;
  instruction: string;
  marks: AnnotationMark[];
  missingIntentIds: string[];
  onDeleteMark: (markId: string) => void;
  onInstructionChange: (instruction: string) => void;
  onMarkFocus: (markId: string) => void;
  onMarkIntentChange: (markId: string, intent: string) => void;
  onMarkSelect: (markId: string) => void;
  onSelectedMarkColorChange: (color: AnnotationColor) => void;
  onStrokeSizeChange: (strokeSize: AnnotationStrokeSize) => void;
  selectedMarkId: string | null;
  strokeSize: AnnotationStrokeSize;
}): ReactElement {
  const { t } = useI18n();
  const selectedMark = marks.find((mark) => mark.id === selectedMarkId);

  return (
    <div className="annotation-side-panel">
      <div className={`annotation-control-group annotation-selected-color-control${selectedMark ? '' : ' is-disabled'}`}>
        <span>{selectedMark ? `${selectedMark.id} · ` : ''}{t('context.selectedMarkColor')}</span>
        <div className="annotation-swatch-row">
          {colors.map((option) => (
            <button
              key={option}
              type="button"
              disabled={!selectedMark}
              className={`annotation-swatch${selectedMark?.color === option ? ' is-active' : ''}`}
              style={{ background: option }}
              aria-label={`${markColorLabel(option, t)} · ${option}`}
              title={`${markColorLabel(option, t)} · ${option}`}
              onClick={() => onSelectedMarkColorChange(option)}
            />
          ))}
        </div>
      </div>
      <div className="annotation-control-group">
        <span>{t('context.strokeSize')}</span>
        <div className="annotation-size-row">
          {strokeOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={strokeSize === option ? 'is-active' : ''}
              onClick={() => onStrokeSizeChange(option)}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="annotation-control-group annotation-intents-group">
        <span>{t('context.markIntents')}</span>
        {marks.length ? (
          <div className="annotation-intent-list">
            {marks.map((mark) => (
              <div
                key={`intent-${mark.id}`}
                className={`annotation-intent-card${displayedSelectedMarkId === mark.id ? ' is-selected' : ''}`}
                onPointerDown={(event) => event.stopPropagation()}
                aria-current={selectedMarkId === mark.id ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="annotation-intent-heading"
                  onClick={() => onMarkSelect(mark.id)}
                >
                  <span className="annotation-intent-color" style={{ background: mark.color }} />
                  <strong>{mark.id}</strong>
                  <span>{markKindLabel(mark.kind, t)}</span>
                  {displayedSelectedMarkId === mark.id ? (
                    <span className="annotation-intent-selected-label">{t('context.selectedMark')}</span>
                  ) : null}
                </button>
                <input
                  data-mark-id={mark.id}
                  className="annotation-intent-input"
                  placeholder={t('context.markIntentPlaceholder')}
                  value={mark.intent}
                  onChange={(event) => onMarkIntentChange(mark.id, event.target.value)}
                  onFocus={() => onMarkFocus(mark.id)}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="annotation-empty-intents">{t('context.noMarks')}</p>
        )}
      </div>
      <label className="annotation-control-group">
        <span>{t('context.globalInstruction')}</span>
        <textarea
          rows={3}
          placeholder={t('context.globalInstructionPlaceholder')}
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value)}
        />
      </label>
      {missingIntentIds.length ? (
        <p className="annotation-missing-intent">
          {t('context.missingMarkIntent')}: {missingIntentIds.join(', ')}
        </p>
      ) : null}
      <details className="annotation-prompt-preview">
        <summary>{t('context.executionInstructionPreview')}</summary>
        <pre>{compiledInstruction}</pre>
      </details>
      {selectedMark ? (
        <button
          type="button"
          className="secondary-popover-button"
          onClick={() => onDeleteMark(selectedMark.id)}
        >
          <Trash2 size={13} />
          {t('context.deleteMark')} {selectedMark.id}
        </button>
      ) : null}
    </div>
  );
}

function ToolButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactElement;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <TooltipIconButton disabled={disabled} isPressed={active} label={label} onClick={onClick}>
      {children}
    </TooltipIconButton>
  );
}

type Translate = ReturnType<typeof useI18n>['t'];

function markKindLabel(kind: AnnotationMarkKind, t: Translate): string {
  if (kind === 'marker') return t('context.markerTool');
  if (kind === 'arrow') return t('context.arrowTool');
  if (kind === 'pen') return t('context.penTool');
  if (kind === 'brush') return t('context.regionBrushTool');
  if (kind === 'rect') return t('context.rectangleTool');
  return t('context.ellipseTool');
}

function markColorLabel(color: AnnotationColor, t: Translate): string {
  if (color === '#dc2626') return t('context.annotationColorRed');
  if (color === '#facc15') return t('context.annotationColorYellow');
  if (color === '#22c55e') return t('context.annotationColorGreen');
  if (color === '#2563eb') return t('context.annotationColorBlue');
  return t('context.annotationColorPurple');
}
