import { annotationEditControlDescription, readAnnotationEditControlManifest } from '../src/core/annotationEditControls';
import { normalizeReferenceIntent, type ReferenceIntentV1 } from '../src/core/referenceIntent';
import type { ExecutionRecord } from '../src/core/types';
import {
  outpaintCapabilityId,
  readOutpaintParameters,
} from '../src/core/outpaintContracts';

export interface ImageExecutionInputAssignment {
  artifactType?: string;
  assetId: string;
  inputSlotId: string;
  order?: number;
  referenceIntent?: ReferenceIntentV1;
  title?: string;
}

export function imageExecutionInputAssignments(execution: ExecutionRecord): ImageExecutionInputAssignment[] {
  const explicitSlots = new Map<string, string>();
  const explicitReferenceIntents = new Map<string, ReferenceIntentV1>();
  const explicitAssetIds: string[] = [];
  const rawBindings = Array.isArray(execution.params?.inputBindings) ? execution.params.inputBindings : [];
  for (const rawBinding of rawBindings) {
    if (
      !isRecord(rawBinding)
      || typeof rawBinding.assetId !== 'string'
      || typeof rawBinding.inputSlotId !== 'string'
      || !rawBinding.inputSlotId.trim()
    ) {
      continue;
    }
    explicitSlots.set(rawBinding.assetId, rawBinding.inputSlotId);
    const referenceIntent = normalizeReferenceIntent(rawBinding.referenceIntent);
    if (referenceIntent) {
      explicitReferenceIntents.set(rawBinding.assetId, referenceIntent);
    }
    explicitAssetIds.push(rawBinding.assetId);
  }

  const snapshotSlots = new Map<string, string>();
  const snapshotAssetIds: string[] = [];
  for (const binding of execution.inputBindingsSnapshot ?? []) {
    for (const value of binding.values) {
      if (value.kind !== 'asset') continue;
      snapshotAssetIds.push(value.assetId);
      snapshotSlots.set(value.assetId, binding.slotId);
    }
  }

  const referenceAssetIds = Array.isArray(execution.params?.referenceAssetIds)
    ? execution.params.referenceAssetIds.filter((assetId): assetId is string => typeof assetId === 'string')
    : [];
  const annotatedCompositeAssetId = typeof execution.params?.annotatedCompositeAssetId === 'string'
    ? execution.params.annotatedCompositeAssetId
    : undefined;
  const assetIds = [...new Set([
    ...snapshotAssetIds,
    ...explicitAssetIds,
    ...((execution.inputBindingsSnapshot?.length ?? 0) > 0 ? [] : execution.inputAssetIds ?? []),
    ...referenceAssetIds,
    annotatedCompositeAssetId,
  ].filter((assetId): assetId is string => typeof assetId === 'string'))];
  const referenceSet = new Set(referenceAssetIds);
  const storyboardReferenceByAssetId = new Map(
    (Array.isArray(execution.params?.storyboardReferences)
      ? execution.params.storyboardReferences
      : []).flatMap((value) => {
      if (!isRecord(value) || typeof value.assetId !== 'string') return [];
      return [[value.assetId, value] as const];
    }),
  );
  const assignments = assetIds.map((assetId): ImageExecutionInputAssignment => {
    let inputSlotId = explicitSlots.get(assetId) ?? snapshotSlots.get(assetId);
    if (assetId === annotatedCompositeAssetId) inputSlotId = 'annotated_composite';
    if (!inputSlotId && referenceSet.has(assetId)) inputSlotId = 'references';
    inputSlotId ??= 'references';
    const storyboardReference = storyboardReferenceByAssetId.get(assetId);
    return {
      assetId,
      inputSlotId,
      ...(typeof storyboardReference?.artifactType === 'string'
        ? { artifactType: storyboardReference.artifactType }
        : {}),
      ...(typeof storyboardReference?.order === 'number' ? { order: storyboardReference.order } : {}),
      ...(explicitReferenceIntents.get(assetId)
        ? { referenceIntent: explicitReferenceIntents.get(assetId) }
        : {}),
      ...(typeof storyboardReference?.title === 'string' ? { title: storyboardReference.title } : {}),
    };
  });

  return assignments.filter((assignment) => assignment.inputSlotId !== 'prompt').sort((left, right) => (
    inputSlotOrder(left.inputSlotId) - inputSlotOrder(right.inputSlotId)
  ));
}

export function createProviderImagePrompt(
  execution: ExecutionRecord,
  inputAssignments: readonly ImageExecutionInputAssignment[],
  options: {
    dialect: 'codex_imagegen' | 'provider_api';
    variantIndex: number;
    variantCount: number;
  },
): string {
  const instruction = execution.prompt?.trim();
  if (!instruction) throw new Error('Image generation requires a non-empty prompt.');
  const command = options.dialect === 'codex_imagegen' ? '$imagegen ' : '';
  const toolRule = options.dialect === 'codex_imagegen'
    ? ' Do not call other tools or copy the result.'
    : '';
  const geometry = imageGenerationGeometryInstruction(execution);
  const inputContract = imageInputContractInstruction(inputAssignments);
  const variant = imageVariantInstruction(options.variantIndex, options.variantCount);

  if (execution.capabilityId === 'image.annotation_edit') {
    const annotationInstructions = annotationPromptInstructions(execution);
    const sourceIndex = attachmentIndex(inputAssignments, 'source_image');
    const compositeIndex = attachmentIndex(inputAssignments, 'annotated_composite');
    const source = sourceIndex ? `attachment ${sourceIndex}` : 'the clean source image';
    const composite = compositeIndex
      ? `the final attached annotated composite (attachment ${compositeIndex})`
      : 'the final attached annotated composite';
    return `${command}Edit ${source} using ${composite} as the authoritative visual instruction layer. ${annotationInstructions} The colored marks, arrows, outlines, labels, and brush overlays are instructions only: do not retain them in the final image. Preserve the source subject, composition, style, and all unmentioned content unless an annotation or requested output canvas explicitly changes it.${inputContract}${geometry}${variant} Generate exactly one clean revised image.${toolRule}`;
  }

  if (execution.capabilityId === 'image.masked_edit') {
    const sourceIndex = attachmentIndex(inputAssignments, 'source_image');
    const maskIndex = attachmentIndex(inputAssignments, 'inpaint_mask');
    const source = sourceIndex
      ? `attachment ${sourceIndex}`
      : 'the attached source image';
    const mask = maskIndex
      ? `attachment ${maskIndex}`
      : 'the attached inpaint mask';
    return `${command}Edit ${source} according to this instruction: ${sentence(instruction)} Use ${mask} as an exact spatial constraint: white pixels are editable and black pixels must remain unchanged. Do not reproduce the mask in the result.${inputContract}${geometry} Preserve the source dimensions, subject, composition, and every unselected region.${variant} Generate exactly one clean revised image.${toolRule}`;
  }

  if (execution.capabilityId === outpaintCapabilityId) {
    const parameters = readOutpaintParameters(
      execution.params?.pluginParameters,
    );
    const sourceIndex = attachmentIndex(inputAssignments, 'source_image');
    const guideIndex = attachmentIndex(inputAssignments, 'outpaint_guide');
    const maskIndex = attachmentIndex(inputAssignments, 'inpaint_mask');
    const source = sourceIndex
      ? `attachment ${sourceIndex}`
      : 'the attached source image';
    const guide = guideIndex
      ? `attachment ${guideIndex}`
      : 'the attached outpaint guide';
    const mask = maskIndex
      ? `attachment ${maskIndex}`
      : 'the attached outpaint mask';
    const sourceRect = `${parameters.sourceX},${parameters.sourceY},${parameters.sourceWidth},${parameters.sourceHeight}`;
    return `${command}Expand ${source} into a ${parameters.targetWidth}x${parameters.targetHeight} output canvas according to this instruction: ${sentence(instruction)} Place the unscaled source exactly at pixel rectangle x,y,width,height=${sourceRect}. Use ${guide} as the authoritative layout guide and ${mask} as the spatial constraint: black is the protected source footprint and white is the area to generate. Generate coherent new scene content only beyond the original boundaries; do not crop, scale, rotate, redraw, or reposition the source, and do not reproduce the guide transparency or mask.${inputContract}${geometry}${variant} Generate exactly one clean expanded image.${toolRule}`;
  }

  if (
    execution.capabilityId === 'image.generate'
    && inputAssignments.some((assignment) => assignment.inputSlotId === 'source_image')
  ) {
    const sourceIndex = attachmentIndex(inputAssignments, 'source_image');
    const source = sourceIndex ? `attachment ${sourceIndex}` : 'the attached source image';
    return `${command}Edit ${source} according to this instruction: ${sentence(instruction)}${inputContract}${geometry} Preserve its subject, composition, and all unmentioned primary content unless the instruction, a reference intent, or the requested output canvas explicitly changes it.${variant} Generate exactly one clean revised image.${toolRule}`;
  }

  const references = inputAssignments.length
    ? ' Use the attached images only according to their declared reference intent; create a new image instead of treating any reference as the editable output base.'
    : '';
  return `${command}Generate exactly one image from this instruction: ${sentence(instruction)}${references}${inputContract}${geometry} Generate the composition directly on the requested canvas.${variant}${toolRule}`;
}

function sentence(value: string): string {
  return /[.!?。！？]$/.test(value) ? value : `${value}.`;
}

function imageInputContractInstruction(assignments: readonly ImageExecutionInputAssignment[]): string {
  if (!assignments.length) return '';
  const descriptions = assignments.map((assignment, index) => {
    const identity = [
      assignment.title ? `title=${JSON.stringify(assignment.title)}` : '',
      assignment.artifactType ? `type=${assignment.artifactType}` : '',
      assignment.order ? `bound-order=${assignment.order}` : '',
    ].filter(Boolean).join(', ');
    const intent = assignment.referenceIntent;
    const directive = intent
      ? `Reference content ${JSON.stringify(intent.label)}: ${intent.instruction}`
      : inputSlotDirective(assignment.inputSlotId);
    return `attachment ${index + 1} [${assignment.inputSlotId}]${identity ? ` (${identity})` : ''}: ${directive}`;
  });
  return ` Authoritative image input contract: ${descriptions.join(' ')} Do not move images between input slots, reinterpret a source as a reference, or replace the declared reference intent.`;
}

function imageGenerationGeometryInstruction(execution: ExecutionRecord): string {
  const generation = isRecord(execution.params?.generation) ? execution.params.generation : {};
  const width = finiteNumber(generation.targetWidth);
  const height = finiteNumber(generation.targetHeight);
  const targetRatio = finiteNumber(generation.targetAspectRatio) ?? (width && height ? width / height : undefined);
  const preset = typeof generation.aspectRatioPreset === 'string' ? generation.aspectRatioPreset.trim() : '';
  const orientation = targetRatio
    ? targetRatio < 0.95 ? 'portrait' : targetRatio > 1.05 ? 'landscape' : 'square'
    : undefined;
  const aspectInstruction = preset === 'source'
    ? ' Preserve the source image aspect ratio as the output canvas.'
    : preset
      ? ` Required output aspect ratio: ${preset}${orientation ? ` (${orientation}, width:height)` : ' (width:height)'}.`
      : targetRatio
        ? ` Required output aspect ratio: ${targetRatio.toFixed(3)} width/height${orientation ? ` (${orientation})` : ''}.`
        : '';
  const dimensions = width && height
    ? ` Target pixel dimensions: ${Math.round(width)}x${Math.round(height)}.`
    : '';
  const hardConstraint = aspectInstruction
    ? ' Treat the aspect ratio as a hard output-canvas requirement: do not substitute another orientation, and do not simulate the requested ratio with letterboxing or padding.'
    : '';
  return `${aspectInstruction}${dimensions}${hardConstraint}`;
}

function annotationPromptInstructions(execution: ExecutionRecord): string {
  const manifest = isRecord(execution.params?.annotationManifest) ? execution.params.annotationManifest : {};
  const globalInstruction = typeof manifest.globalInstruction === 'string' ? manifest.globalInstruction.trim() : '';
  const controls = readAnnotationEditControlManifest(execution.params?.annotationEditControls)?.controls ?? [];
  const controlById = new Map(controls.map((control) => [control.markId, control]));
  const marks = Array.isArray(manifest.marks) ? manifest.marks.filter(isRecord) : [];
  const markInstructions = marks.flatMap((mark) => {
    if (typeof mark.id !== 'string' || typeof mark.intent !== 'string' || !mark.intent.trim()) return [];
    const control = controlById.get(mark.id);
    const location = control ? ` (${annotationEditControlDescription(control)})` : '';
    return [`${mark.id}${location}: ${mark.intent.trim()}`];
  });
  const parts = [
    globalInstruction ? `Global instruction: ${globalInstruction}` : '',
    markInstructions.length ? `Marked edits: ${markInstructions.join('; ')}` : '',
  ].filter(Boolean);
  return parts.join(' ') || `Instruction: ${execution.prompt?.trim() || 'Apply the marked edits.'}`;
}

function imageVariantInstruction(index: number, count: number): string {
  return count > 1
    ? ` This is candidate ${index + 1} of ${count}; produce an independent visual variation rather than duplicating another candidate.`
    : '';
}

function attachmentIndex(
  assignments: readonly ImageExecutionInputAssignment[],
  inputSlotId: string,
): number | undefined {
  const index = assignments.findIndex(
    (assignment) => assignment.inputSlotId === inputSlotId,
  );
  return index >= 0 ? index + 1 : undefined;
}

function inputSlotOrder(inputSlotId: string): number {
  if (inputSlotId === 'source_image') return 0;
  if (inputSlotId === 'control_image' || inputSlotId === 'outpaint_guide') return 1;
  if (inputSlotId === 'inpaint_mask') return 2;
  if (inputSlotId === 'annotated_composite') return 3;
  return 4;
}

function inputSlotDirective(inputSlotId: string): string {
  if (inputSlotId === 'source_image') {
    return 'Use as the editable base image and preserve unmentioned content.';
  }
  if (inputSlotId === 'annotated_composite') {
    return 'Use as the authoritative visual annotation layer, not as output content.';
  }
  if (inputSlotId === 'control_image' || inputSlotId === 'outpaint_guide') {
    return 'Use as the structural control guide.';
  }
  if (inputSlotId === 'inpaint_mask') {
    return 'Use as the exact editable-region mask.';
  }
  if (inputSlotId === 'first_frame') return 'Use as the exact first frame.';
  if (inputSlotId === 'last_frame') return 'Use as the exact last frame.';
  return 'Use only as a visual reference according to the prompt and reference intent.';
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
