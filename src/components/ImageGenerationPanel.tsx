import { ChevronDown, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { ImageGenerationParams } from '../core/imageOperations';
import type { BlockRecord } from '../core/types';
import { useI18n } from '../i18n';

type ImageGenerationAspectPreset = 'smart' | '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';
type ImageGenerationResolutionPreset = '1k' | '2k' | '4k';

export interface ImageGenerationForm {
  aspectPreset: ImageGenerationAspectPreset;
  height: string;
  instruction: string;
  referenceFiles: File[];
  resolutionPreset: ImageGenerationResolutionPreset;
  width: string;
}

interface ImageGenerationPanelProps {
  form: ImageGenerationForm;
  onChange: (updater: (current: ImageGenerationForm) => ImageGenerationForm) => void;
  onRun: () => void;
  popoverScale: number;
  selectedBlock: BlockRecord;
}

export function ImageGenerationPanel({
  form,
  onChange,
  onRun,
  popoverScale,
  selectedBlock,
}: ImageGenerationPanelProps): ReactElement {
  const { t } = useI18n();
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const [paramsPanelStyle, setParamsPanelStyle] = useState<CSSProperties>();
  const paramsButtonRef = useRef<HTMLButtonElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const canRun = form.instruction.trim().length > 0 || form.referenceFiles.length > 0;

  useEffect(() => {
    if (!isParamsOpen) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setIsParamsOpen(false);
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [isParamsOpen]);

  useEffect(() => {
    if (isParamsOpen) updateParamsPanelPosition();
  }, [isParamsOpen, popoverScale]);

  function updateDimension(field: 'width' | 'height', value: string): void {
    onChange((current) => {
      const cleanValue = normalizeDimensionInput(value);
      if (current.aspectPreset === 'smart') {
        return { ...current, [field]: cleanValue };
      }

      const ratio = aspectRatioForPreset(current.aspectPreset, selectedBlock);
      const numericValue = Number(cleanValue);
      if (!ratio || !Number.isFinite(numericValue) || numericValue <= 0) {
        return { ...current, [field]: cleanValue };
      }

      if (field === 'width') {
        return { ...current, width: cleanValue, height: String(Math.max(1, Math.round(numericValue / ratio))) };
      }

      return { ...current, width: String(Math.max(1, Math.round(numericValue * ratio))), height: cleanValue };
    });
  }

  function updateParamsPanelPosition(): void {
    const bounds = paramsButtonRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const panelWidth = Math.min(392, (window.innerWidth - 32) / popoverScale);
    const visualWidth = panelWidth * popoverScale;
    setParamsPanelStyle({
      left: Math.max(16, Math.min(bounds.left, window.innerWidth - visualWidth - 16)),
      top: Math.min(bounds.bottom + 8, window.innerHeight - 260 * popoverScale),
      transform: `scale(${popoverScale})`,
      width: panelWidth,
    });
  }

  function toggleParamsPanel(): void {
    updateParamsPanelPosition();
    setIsParamsOpen((current) => !current);
  }

  const paramsPanel = isParamsOpen ? (
    <div className="generation-param-popover" style={paramsPanelStyle}>
      <div className="generation-param-popover-header">
        <span>{t('context.customSize')}</span>
        <button type="button" aria-label={t('context.close')} onClick={() => setIsParamsOpen(false)}>
          <X size={14} />
        </button>
      </div>
      <GenerationSegment
        label={t('context.aspectRatio')}
        options={aspectPresetOptions}
        selectedValue={form.aspectPreset}
        onSelect={(value) => {
          onChange((current) => ({
            ...current,
            ...sizeFieldsForPreset(value, current.resolutionPreset, selectedBlock),
            aspectPreset: value,
          }));
        }}
      />
      <GenerationSegment
        label={t('context.resolution')}
        options={resolutionPresetOptions}
        selectedValue={form.resolutionPreset}
        onSelect={(value) => {
          onChange((current) => ({
            ...current,
            ...sizeFieldsForPreset(current.aspectPreset, value, selectedBlock),
            resolutionPreset: value,
          }));
        }}
      />
      <div className="generation-size-row" aria-label={t('context.customSize')}>
        <label>
          <span>{t('context.width')}</span>
          <input inputMode="numeric" value={form.width} onChange={(event) => updateDimension('width', event.target.value)} />
        </label>
        <span className="generation-size-link" aria-hidden="true">×</span>
        <label>
          <span>{t('context.height')}</span>
          <input inputMode="numeric" value={form.height} onChange={(event) => updateDimension('height', event.target.value)} />
        </label>
        <span className="generation-size-unit">{t('context.pixels')}</span>
      </div>
    </div>
  ) : null;

  return (
    <div className="context-popover generation-popover" aria-label={t('context.generateImage')}>
      <h2>{t('context.generateImage')}</h2>
      <textarea
        placeholder={t('context.generatePromptPlaceholder')}
        rows={6}
        value={form.instruction}
        onChange={(event) => onChange((current) => ({ ...current, instruction: event.target.value }))}
      />
      <div className="generation-chip-row">
        <div className="generation-param-wrap">
          <button
            ref={paramsButtonRef}
            type="button"
            className="generation-chip"
            aria-expanded={isParamsOpen}
            onClick={toggleParamsPanel}
          >
            <span>{generationParamsLabel(form, t('context.pixels'))}</span>
            <ChevronDown size={14} />
          </button>
        </div>
        <button type="button" className="generation-chip" onClick={() => referenceInputRef.current?.click()}>
          <Upload size={14} />
          <span>{referenceChipLabel(form.referenceFiles.length, t('context.referenceImages'), t('context.referenceImage'))}</span>
        </button>
        <input
          ref={referenceInputRef}
          className="hidden-file-input"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.currentTarget.value = '';
            if (!files.length) return;
            onChange((current) => ({
              ...current,
              referenceFiles: [...current.referenceFiles, ...files].slice(0, 6),
            }));
          }}
        />
      </div>
      {form.referenceFiles.length ? (
        <ul className="generation-reference-list">
          {form.referenceFiles.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`}>
              <span>{file.name || `${t('context.referenceImage')} ${index + 1}`}</span>
              <button
                type="button"
                onClick={() =>
                  onChange((current) => ({
                    ...current,
                    referenceFiles: current.referenceFiles.filter((_, fileIndex) => fileIndex !== index),
                  }))
                }
              >
                {t('context.removeReferenceImage')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="primary-popover-button" disabled={!canRun} onClick={onRun}>
        {t('context.run')}
      </button>
      {paramsPanel ? createPortal(paramsPanel, document.body) : null}
    </div>
  );
}

export function createDefaultGenerationForm(block?: BlockRecord): ImageGenerationForm {
  return {
    aspectPreset: 'smart',
    instruction: '',
    referenceFiles: [],
    resolutionPreset: '2k',
    ...sizeFieldsForPreset('smart', '2k', block),
  };
}

export function generationFormToParams(form: ImageGenerationForm, block?: BlockRecord): ImageGenerationParams {
  const targetWidth = Number(form.width);
  const targetHeight = Number(form.height);
  return {
    aspectRatioPreset: form.aspectPreset,
    targetAspectRatio: aspectRatioForPreset(form.aspectPreset, block) ?? safeRatio(targetWidth, targetHeight),
    targetResolution: form.resolutionPreset.toUpperCase(),
    targetWidth: Number.isFinite(targetWidth) && targetWidth > 0 ? Math.round(targetWidth) : undefined,
    targetHeight: Number.isFinite(targetHeight) && targetHeight > 0 ? Math.round(targetHeight) : undefined,
  };
}

function GenerationSegment<T extends string>({
  label,
  onSelect,
  options,
  selectedValue,
}: {
  label: string;
  onSelect: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  selectedValue: T;
}): ReactElement {
  return (
    <div className="generation-segment">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === selectedValue ? 'is-selected' : undefined}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function generationParamsLabel(form: ImageGenerationForm, pixelsLabel: string): string {
  return `${form.aspectPreset} · ${form.resolutionPreset.toUpperCase()} · ${form.width}×${form.height} ${pixelsLabel}`;
}

function referenceChipLabel(count: number, pluralLabel: string, singularLabel: string): string {
  return count > 0 ? `${singularLabel} ${count}` : pluralLabel;
}

const aspectPresetOptions: Array<{ label: string; value: ImageGenerationAspectPreset }> = [
  { label: 'Smart', value: 'smart' },
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
];

const resolutionPresetOptions: Array<{ label: string; value: ImageGenerationResolutionPreset }> = [
  { label: '1K', value: '1k' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' },
];

function sizeFieldsForPreset(
  aspectPreset: ImageGenerationAspectPreset,
  resolutionPreset: ImageGenerationResolutionPreset,
  block?: BlockRecord,
): Pick<ImageGenerationForm, 'height' | 'width'> {
  const ratio = aspectRatioForPreset(aspectPreset, block) ?? 1;
  const maxSide = resolutionMaxSide(resolutionPreset);
  const size =
    ratio >= 1
      ? { width: maxSide, height: Math.round(maxSide / ratio) }
      : { width: Math.round(maxSide * ratio), height: maxSide };

  return {
    width: String(Math.max(1, size.width)),
    height: String(Math.max(1, size.height)),
  };
}

function aspectRatioForPreset(preset: ImageGenerationAspectPreset, block?: BlockRecord): number | undefined {
  if (preset === 'smart') {
    return safeRatio(block?.size.width, block?.size.height);
  }

  const [width, height] = preset.split(':').map(Number);
  return safeRatio(width, height);
}

function safeRatio(width?: number, height?: number): number | undefined {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || height <= 0) return undefined;
  return width / height;
}

function resolutionMaxSide(resolutionPreset: ImageGenerationResolutionPreset): number {
  if (resolutionPreset === '1k') return 1024;
  if (resolutionPreset === '4k') return 4096;
  return 2048;
}

function normalizeDimensionInput(value: string): string {
  return value.replace(/[^\d]/g, '').slice(0, 5);
}
