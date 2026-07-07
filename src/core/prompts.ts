import type { BlockRecord, BoardSnapshot, ExecutionRecord } from './types';

export function createBindingPrompt(snapshot: BoardSnapshot): string {
  return [
    'Bind this Codex workspace to the Retake Whiteboard project and board.',
    '',
    `Retake projectId: ${snapshot.project.projectId}`,
    `Retake boardId: ${snapshot.board.boardId}`,
    snapshot.project.codexProjectPath
      ? `Expected Codex project path: ${snapshot.project.codexProjectPath}`
      : undefined,
    '',
    'Use the Retake MCP tools in this order:',
    '1. retake_validate_project_binding',
    '2. retake_set_project_binding if validation is missing or stale',
    '3. retake_get_board_snapshot to confirm the active board',
    '',
    'After binding, wait for a specific Retake operation prompt before creating or writing results.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createImageOperationPrompt(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  resultBlock: BlockRecord,
  execution: ExecutionRecord,
): string {
  const asset = snapshot.assets.find((candidate) => candidate.assetId === sourceBlock.data.assetId);
  const isAnnotationEdit = execution.capabilityId === 'image.annotation_edit';
  const isPromptGeneration = execution.capabilityId === 'image.generate' && !sourceBlock.data.assetId;
  const targetWidth = Math.round(sourceBlock.size.width);
  const targetHeight = Math.round(sourceBlock.size.height);
  const targetAspectRatio = targetHeight > 0 ? (targetWidth / targetHeight).toFixed(3) : 'unknown';
  const generationParams = execution.params?.generation as
    | {
        aspectRatioPreset?: string;
        targetAspectRatio?: number;
        targetResolution?: string;
        targetWidth?: number;
        targetHeight?: number;
      }
    | undefined;
  const referenceAssetIds = Array.isArray(execution.params?.referenceAssetIds)
    ? execution.params.referenceAssetIds.filter((assetId): assetId is string => typeof assetId === 'string')
    : [];
  const referenceAssets = referenceAssetIds
    .map((assetId) => snapshot.assets.find((candidate) => candidate.assetId === assetId))
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  const annotatedCompositeAssetId =
    typeof resultBlock.data.annotatedCompositeAssetId === 'string'
      ? resultBlock.data.annotatedCompositeAssetId
      : undefined;
  const annotatedCompositeAsset = snapshot.assets.find(
    (candidate) => candidate.assetId === annotatedCompositeAssetId,
  );
  const sourceAssetPath = localAssetPath(snapshot, asset);
  const annotatedCompositePath = localAssetPath(snapshot, annotatedCompositeAsset);
  const outputPath = localOutputPath(snapshot, execution);

  return [
    'Run this existing Retake Whiteboard image operation in Codex and write the result back to the board.',
    'If the $retake-whiteboard-codex skill is installed, use it for the Retake MCP writeback workflow. Otherwise follow this prompt directly.',
    '',
    'Identifiers:',
    `- projectId: ${snapshot.project.projectId}`,
    `- boardId: ${snapshot.board.boardId}`,
    `- existing executionId: ${execution.executionId}`,
    sourceBlock.data.assetId
      ? `- source image blockId: ${sourceBlock.blockId}`
      : `- image placeholder blockId: ${sourceBlock.blockId}`,
    `- result image blockId: ${resultBlock.blockId}`,
    sourceBlock.data.assetId ? `- source assetId: ${sourceBlock.data.assetId}` : undefined,
    asset?.storageKey ? `- source asset storageKey: ${asset.storageKey}` : undefined,
    sourceAssetPath ? `- source asset local path: ${sourceAssetPath}` : undefined,
    `- target display size: ${targetWidth} x ${targetHeight} canvas units`,
    `- target aspect ratio: ${targetAspectRatio}`,
    generationParams?.aspectRatioPreset ? `- requested aspect ratio preset: ${generationParams.aspectRatioPreset}` : undefined,
    typeof generationParams?.targetAspectRatio === 'number'
      ? `- requested aspect ratio: ${generationParams.targetAspectRatio.toFixed(3)} width/height`
      : undefined,
    generationParams?.targetResolution ? `- requested resolution preset: ${generationParams.targetResolution}` : undefined,
    generationParams?.targetWidth && generationParams?.targetHeight
      ? `- requested output size: ${generationParams.targetWidth} x ${generationParams.targetHeight} px`
      : undefined,
    annotatedCompositeAssetId ? `- annotated composite assetId: ${annotatedCompositeAssetId}` : undefined,
    annotatedCompositeAsset?.storageKey
      ? `- annotated composite storageKey: ${annotatedCompositeAsset.storageKey}`
      : undefined,
    annotatedCompositePath ? `- annotated composite local path: ${annotatedCompositePath}` : undefined,
    referenceAssets.length ? `- reference image assetIds: ${referenceAssets.map((asset) => asset.assetId).join(', ')}` : undefined,
    ...referenceAssets.flatMap((referenceAsset, index) => {
      const referencePath = localAssetPath(snapshot, referenceAsset);
      return [
        `- reference image ${index + 1} storageKey: ${referenceAsset.storageKey}`,
        referencePath ? `- reference image ${index + 1} local path: ${referencePath}` : undefined,
      ].filter(Boolean);
    }),
    '',
    'Operation:',
    `- capabilityId: ${execution.capabilityId}`,
    execution.skillId ? `- skillId: ${execution.skillId}` : undefined,
    execution.prompt ? `- instruction: ${execution.prompt}` : undefined,
    '',
    'Execution responsibility:',
    '- Retake MCP tools do not generate or edit images. They only validate binding, read execution context, import a final local file, update the existing result block, and mark success/failure.',
    '- Use whatever image generation/editing capability is available in this Codex environment to produce the final image file. This may be a built-in image tool, an installed provider/API client, or another configured agent capability.',
    '- If no real image generation/editing capability is available, call retake_fail_execution with the existing executionId. Do not create a placeholder, mock, empty, or annotation-only file as the final result.',
    '- Do not call retake_create_mock_generated_asset for this user operation.',
    isPromptGeneration ? '- generation mode: create a new image from the instruction. No source image asset exists.' : undefined,
    isPromptGeneration
      ? '- Treat the selected empty Image Block as the generation slot. Use the target display size and aspect ratio above as the intended composition frame.'
      : undefined,
    isPromptGeneration && generationParams?.targetWidth && generationParams?.targetHeight
      ? '- Compose the final bitmap for the requested output pixel size when the available image tool supports size parameters. If it does not, still follow the requested aspect ratio and composition frame in the prompt.'
      : undefined,
    isPromptGeneration && referenceAssets.length
      ? '- Use the reference images as visual/style references. They are input references, not images to copy verbatim unless the instruction asks for that.'
      : undefined,
    isAnnotationEdit ? '- annotation mode: annotated composite image is the authoritative edit brief.' : undefined,
    isAnnotationEdit ? '- Read all visible arrows, freehand marks, rectangles, circles, and text notes in the composite image.' : undefined,
    isAnnotationEdit ? '- Use the clean source image as the visual base when available.' : undefined,
    isAnnotationEdit ? '- Use the annotated composite image to understand where each edit applies.' : undefined,
    isAnnotationEdit ? '- Do not ask for arrow coordinates or structured annotation JSON.' : undefined,
    isAnnotationEdit
      ? '- Preserve the source subject, composition, aspect ratio, and style unless the annotations ask otherwise.'
      : undefined,
    isAnnotationEdit
      ? '- Generate a clean revised image. Do not include annotation text, arrows, freehand marks, selection outlines, or UI chrome in the output.'
      : undefined,
    '',
    'Suggested output file:',
    `- ${outputPath}`,
    '- Use png, jpg, webp, or svg. Pass the final local file path to retake_import_asset.',
    '',
    'Rules:',
    '- Do not call retake_create_execution. The execution already exists.',
    '- Use the existing executionId for all reads, imports, result blocks, and failures.',
    '- The result image block already exists and represents this operation while it is queued/running/succeeded/failed.',
    `- When calling retake_update_image_result_block, pass resultBlockId ${resultBlock.blockId}.`,
    '- Do not create another result block for this operation.',
    '- Do not replace the source block.',
    isAnnotationEdit ? '- Do not overwrite, delete, or move the source image block. The new result must be a separate Image Block.' : undefined,
    '',
    'Use the Retake MCP tools in this order:',
    '1. retake_validate_project_binding with the projectId and boardId above.',
    '2. If validation is missing or stale, call retake_set_project_binding for this Codex workspace path.',
    '3. retake_get_execution with the existing executionId above.',
    isAnnotationEdit
      ? '4. Open the source asset local path and annotated composite local path above. Use the source as the clean base and the composite as the edit brief, then generate/edit the final clean image and save it to the suggested output file path when possible.'
      : '4. Generate or edit the image according to the capabilityId, instruction, requested aspect ratio/output size, and reference images above, saving it to the suggested output file path when possible.',
    '5. retake_import_asset with sourcePath set to the generated file and sourceExecutionId set to the existing executionId.',
    `6. retake_update_image_result_block with the existing executionId, resultBlockId ${resultBlock.blockId}, and assetId from retake_import_asset.`,
    '7. If generation fails, call retake_fail_execution with the existing executionId and a concise errorMessage.',
  ]
    .filter(Boolean)
    .join('\n');
}

function localAssetPath(snapshot: BoardSnapshot, asset?: { storageProvider: string; storageKey: string }): string | undefined {
  if (!asset || (asset.storageProvider !== 'local' && asset.storageProvider !== 'local_mock')) return undefined;
  const localRoot = snapshot.project.localRoot ?? `.retake/projects/${snapshot.project.projectId}`;
  return joinLocalPath(snapshot.project.codexProjectPath, localRoot, asset.storageKey);
}

function localOutputPath(snapshot: BoardSnapshot, execution: ExecutionRecord): string {
  return joinLocalPath(snapshot.project.codexProjectPath, 'tmp/agent-output', `${execution.executionId}.png`);
}

function joinLocalPath(projectPath: string | undefined, ...parts: string[]): string {
  const normalizedParts = parts.filter(Boolean);
  if (normalizedParts[0]?.startsWith('/')) return normalizedParts.join('/');
  if (!projectPath) return normalizedParts.join('/');
  return [projectPath, ...normalizedParts].join('/');
}
