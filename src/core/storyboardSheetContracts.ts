export const storyboardSheetCapabilityId = 'previs.storyboard_sheet.generate';
export const storyboardSheetSkillId = 'retake.storyboard-sheet.from-unit-plan';
export const storyboardSheetWorkflowId = 'retake.workflow.storyboard-unit-to-sheet';

export type StoryboardSheetErrorCode =
  | 'storyboard_adapter_unavailable'
  | 'storyboard_parameters_invalid'
  | 'storyboard_plan_missing'
  | 'storyboard_plan_unreadable'
  | 'storyboard_unit_ambiguous'
  | 'storyboard_unit_not_found';

export class StoryboardSheetContractError extends Error {
  readonly code: StoryboardSheetErrorCode;

  constructor(code: StoryboardSheetErrorCode, message: string) {
    super(message);
    this.name = 'StoryboardSheetContractError';
    this.code = code;
  }
}

export type StoryboardSheetPanelCount = 6 | 8 | 10 | 12;
export type StoryboardSheetGridLayout = '3x2' | '4x2' | '5x2' | '4x3';

export interface StoryboardSheetGenerationParameters {
  gridLayout: StoryboardSheetGridLayout;
  outputCount: 1 | 2 | 3 | 4;
  panelAspectRatio: '16:9';
  panelCount: StoryboardSheetPanelCount;
  renderMode: 'panel_grid';
}

export interface StoryboardSheetArtifactRevisionMetadata {
  gridLayout: StoryboardSheetGridLayout;
  kind: 'storyboard_sheet';
  panelAspectRatio: '16:9';
  panelCount: StoryboardSheetPanelCount;
  renderMode: 'panel_grid';
  schemaRef: 'retake.storyboard-sheet-metadata/v1';
  unitId: string;
}

export const defaultStoryboardSheetGenerationParameters: StoryboardSheetGenerationParameters = {
  gridLayout: '3x2',
  outputCount: 1,
  panelAspectRatio: '16:9',
  panelCount: 6,
  renderMode: 'panel_grid',
};

const gridLayoutForPanelCount: Record<StoryboardSheetPanelCount, StoryboardSheetGridLayout> = {
  6: '3x2',
  8: '4x2',
  10: '5x2',
  12: '4x3',
};

export function normalizeStoryboardUnitId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new StoryboardSheetContractError('storyboard_unit_not_found', 'Storyboard Unit ID must be text.');
  }
  const unitId = value.trim();
  if (!unitId) {
    throw new StoryboardSheetContractError('storyboard_unit_not_found', 'Storyboard Unit ID is required.');
  }
  if ([...unitId].length > 64) {
    throw new StoryboardSheetContractError(
      'storyboard_unit_not_found',
      'Storyboard Unit ID must be at most 64 characters.',
    );
  }
  return unitId;
}

export function assertStoryboardUnitExists(markdown: string, unitId: string): void {
  const escaped = unitId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenPattern = new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}(?=$|[^\\p{L}\\p{N}_-])`, 'mu');
  if (!tokenPattern.test(markdown)) {
    throw new StoryboardSheetContractError(
      'storyboard_unit_not_found',
      `Storyboard Unit not found: ${unitId}`,
    );
  }
  const definitionPattern = new RegExp(
    [
      `^#{1,6}\\s+.*(?:unit|单元|生成单元)\\s*[:：#-]?\\s*${escaped}(?=$|[^\\p{L}\\p{N}_-])`,
      `^\\s*(?:[-*+]\\s+)?(?:\\*{0,2})?(?:unit|单元|生成单元)(?:\\*{0,2})?\\s*[:：]\\s*${escaped}(?=$|[^\\p{L}\\p{N}_-])`,
      `^\\s*\\|\\s*${escaped}\\s*\\|`,
    ].join('|'),
    'gimu',
  );
  const definitions = markdown.match(definitionPattern) ?? [];
  if (definitions.length > 1) {
    throw new StoryboardSheetContractError(
      'storyboard_unit_ambiguous',
      `Storyboard Unit is defined more than once: ${unitId}`,
    );
  }
}

export function normalizeStoryboardSheetGenerationParameters(
  value: Record<string, unknown> | undefined,
): StoryboardSheetGenerationParameters {
  const merged = { ...defaultStoryboardSheetGenerationParameters, ...(value ?? {}) };
  const panelCount = merged.panelCount;
  if (panelCount !== 6 && panelCount !== 8 && panelCount !== 10 && panelCount !== 12) {
    throw new StoryboardSheetContractError(
      'storyboard_parameters_invalid',
      'Storyboard Sheet panelCount must be 6, 8, 10, or 12.',
    );
  }
  if (merged.gridLayout !== gridLayoutForPanelCount[panelCount]) {
    throw new StoryboardSheetContractError(
      'storyboard_parameters_invalid',
      `Storyboard Sheet gridLayout must be ${gridLayoutForPanelCount[panelCount]} for ${panelCount} panels.`,
    );
  }
  if (merged.panelAspectRatio !== '16:9') {
    throw new StoryboardSheetContractError(
      'storyboard_parameters_invalid',
      'Storyboard Sheet panelAspectRatio must be 16:9.',
    );
  }
  if (merged.renderMode !== 'panel_grid') {
    throw new StoryboardSheetContractError(
      'storyboard_parameters_invalid',
      'Storyboard Sheet renderMode must be panel_grid.',
    );
  }
  if (
    merged.outputCount !== 1
    && merged.outputCount !== 2
    && merged.outputCount !== 3
    && merged.outputCount !== 4
  ) {
    throw new StoryboardSheetContractError(
      'storyboard_parameters_invalid',
      'Storyboard Sheet outputCount must be between 1 and 4.',
    );
  }
  return {
    gridLayout: merged.gridLayout,
    outputCount: merged.outputCount,
    panelAspectRatio: merged.panelAspectRatio,
    panelCount,
    renderMode: merged.renderMode,
  };
}

export function storyboardSheetArtifactMetadata(input: {
  parameters: StoryboardSheetGenerationParameters;
  unitId: string;
}): StoryboardSheetArtifactRevisionMetadata {
  return {
    kind: 'storyboard_sheet',
    schemaRef: 'retake.storyboard-sheet-metadata/v1',
    unitId: normalizeStoryboardUnitId(input.unitId),
    panelCount: input.parameters.panelCount,
    gridLayout: input.parameters.gridLayout,
    panelAspectRatio: input.parameters.panelAspectRatio,
    renderMode: input.parameters.renderMode,
  };
}

export function isStoryboardSheetArtifactRevisionMetadata(
  value: unknown,
): value is StoryboardSheetArtifactRevisionMetadata {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoryboardSheetArtifactRevisionMetadata>;
  try {
    const parameters = normalizeStoryboardSheetGenerationParameters({
      panelCount: candidate.panelCount,
      gridLayout: candidate.gridLayout,
      panelAspectRatio: candidate.panelAspectRatio,
      renderMode: candidate.renderMode,
      outputCount: 1,
    });
    return candidate.kind === 'storyboard_sheet'
      && candidate.schemaRef === 'retake.storyboard-sheet-metadata/v1'
      && normalizeStoryboardUnitId(candidate.unitId) === candidate.unitId
      && parameters.outputCount === 1;
  } catch {
    return false;
  }
}
