import {
  imageComposerInputFromCompiledRequest,
  withReferenceSlot,
  type CreativeRequestReferenceInput,
} from '../core/creativeRequestCompiler';
import { requestCreativeRequestCompilation } from '../core/creativeRequestCompilerClient';
import type { ImageComposerReferenceRole } from '../core/imageComposer';
import type { ImageGenerationParams } from '../core/imageOperations';
import {
  packageComposerMentionId,
  type PackageComposerMention,
} from '../core/packageComposer';
import type { BoardSnapshot } from '../core/types';
import type {
  UnifiedComposerImageDraftInput,
  UnifiedComposerVideoDraftInput,
} from './UnifiedComposerProvider';

export async function compileImageComposerSubmission(input: {
  connectionId: string;
  explicitRoles: Readonly<Record<string, ImageComposerReferenceRole>>;
  generationParams: ImageGenerationParams;
  generationParamsTouched: boolean;
  instruction: string;
  mentions: readonly PackageComposerMention[];
  snapshot: BoardSnapshot;
}): Promise<UnifiedComposerImageDraftInput> {
  const references = creativeReferenceInputs(input.mentions, input.explicitRoles);
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
      if (
        !mention
        || (
          reference.role !== 'character_reference'
          && reference.role !== 'environment_reference'
          && reference.role !== 'first_frame'
          && reference.role !== 'general_reference'
          && reference.role !== 'last_frame'
        )
      ) {
        throw new Error('Compiled video reference cannot be resolved.');
      }
      return {
        mention: withReferenceSlot(mention),
        ...(reference.purpose ? { purpose: reference.purpose } : {}),
        role: reference.role,
      };
    }),
  };
}

function creativeReferenceInputs(
  mentions: readonly PackageComposerMention[],
  explicitRoles: Readonly<Record<string, ImageComposerReferenceRole>>,
): CreativeRequestReferenceInput[] {
  return mentions.map((mention) => {
    const normalizedMention = withReferenceSlot(mention);
    const originalMentionId = packageComposerMentionId(mention);
    return {
      mention: normalizedMention,
      mentionId: packageComposerMentionId(normalizedMention),
      ...(explicitRoles[originalMentionId]
        ? { explicitRole: explicitRoles[originalMentionId] }
        : {}),
    };
  });
}
