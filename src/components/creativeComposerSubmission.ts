import {
  imageComposerInputFromCompiledRequest,
  withReferenceSlot,
  type CreativeRequestReferenceInput,
} from '../core/creativeRequestCompiler';
import { requestCreativeRequestCompilation } from '../core/creativeRequestCompilerClient';
import type { ImageGenerationParams } from '../core/imageOperations';
import {
  packageComposerMentionId,
  type PackageComposerMention,
} from '../core/packageComposer';
import type { BoardSnapshot } from '../core/types';
import {
  createReferenceIntent,
  type ComposerImageReferenceSetting,
} from '../core/referenceIntent';
import type {
  UnifiedComposerImageDraftInput,
  UnifiedComposerVideoDraftInput,
} from './UnifiedComposerProvider';

export async function compileImageComposerSubmission(input: {
  connectionId: string;
  referenceSettings: Readonly<Record<string, ComposerImageReferenceSetting>>;
  generationParams: ImageGenerationParams;
  generationParamsTouched: boolean;
  instruction: string;
  mentions: readonly PackageComposerMention[];
  snapshot: BoardSnapshot;
}): Promise<UnifiedComposerImageDraftInput> {
  const references = creativeReferenceInputs(input.mentions, input.referenceSettings);
  const compiled = await requestCreativeRequestCompilation({
    boardId: input.snapshot.board.boardId,
    explicitParameters: { ...input.generationParams },
    instruction: input.instruction.trim(),
    mediaKind: 'image',
    projectId: input.snapshot.project.projectId,
    references,
  });
  const effectiveGenerationParams = (
    compiled.capabilityId === 'image.image_to_image'
    && !input.generationParamsTouched
  )
    ? {
        aspectRatioPreset: 'source',
        targetResolution: input.generationParams.targetResolution,
        variationCount: input.generationParams.variationCount,
      }
    : input.generationParams;
  compiled.parameters = { ...effectiveGenerationParams };
  const composerInput = imageComposerInputFromCompiledRequest(
    compiled,
    references,
    effectiveGenerationParams,
  );
  return {
    capabilityId: composerInput.capabilityId,
    connectionId: input.connectionId,
    creativeRequest: compiled,
    generationParams: composerInput.generationParams,
    instruction: composerInput.instruction,
    references: composerInput.references,
  };
}

export async function compileVideoComposerSubmission(input: {
  aspectRatio: string;
  connectionId: string;
  durationSeconds: number;
  instruction: string;
  mentions: readonly PackageComposerMention[];
  outputCount: number;
  snapshot: BoardSnapshot;
}): Promise<UnifiedComposerVideoDraftInput> {
  const references = creativeReferenceInputs(input.mentions, {});
  const compiled = await requestCreativeRequestCompilation({
    boardId: input.snapshot.board.boardId,
    explicitParameters: {
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      outputCount: input.outputCount,
    },
    instruction: input.instruction.trim(),
    mediaKind: 'video',
    projectId: input.snapshot.project.projectId,
    references,
  });
  const mentionsById = new Map(
    references.map((reference) => [reference.mentionId, reference.mention]),
  );
  return {
    aspectRatio: input.aspectRatio,
    connectionId: input.connectionId,
    creativeRequest: compiled,
    durationSeconds: input.durationSeconds,
    instruction: compiled.prompt,
    outputCount: input.outputCount,
    references: compiled.references.map((reference) => {
      const mention = mentionsById.get(reference.mentionId);
      if (!mention) {
        throw new Error('Compiled video reference cannot be resolved.');
      }
      return {
        inputSlotId: reference.inputSlotId,
        mention: withReferenceSlot(mention),
        ...(reference.referenceIntent
          ? { referenceIntent: structuredClone(reference.referenceIntent) }
          : {}),
      };
    }),
  };
}

function creativeReferenceInputs(
  mentions: readonly PackageComposerMention[],
  referenceSettings: Readonly<Record<string, ComposerImageReferenceSetting>>,
): CreativeRequestReferenceInput[] {
  return mentions.map((mention) => {
    const normalizedMention = withReferenceSlot(mention);
    const originalMentionId = packageComposerMentionId(mention);
    const setting = referenceSettings[originalMentionId];
    const inputSlotId = setting?.mode === 'source'
      ? 'source_image'
      : setting?.mode === 'reference'
        ? 'references'
        : undefined;
    const referenceIntent = setting?.mode === 'reference'
      ? createReferenceIntent(setting.instruction, 'user')
      : undefined;
    return {
      mention: normalizedMention,
      mentionId: packageComposerMentionId(normalizedMention),
      ...(inputSlotId
        ? {
            explicitBinding: {
              inputSlotId,
              ...(referenceIntent ? { referenceIntent } : {}),
            },
          }
        : {}),
    };
  });
}
