import { inputRoleDefinition, isExecutionInputRole } from './inputRoles';
import type { BlockRecord, BoardSnapshot, ExecutionInputRole, ExecutionRecord } from './types';
import type { ImageGenerationParams } from './imageOperations';

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
  operationBlock: BlockRecord,
  resultBlocks: BlockRecord[],
  execution: ExecutionRecord,
): string {
  const resultBlock = resultBlocks[0];
  const asset = snapshot.assets.find((candidate) => candidate.assetId === sourceBlock.data.assetId);
  const isAnnotationEdit = execution.capabilityId === 'image.annotation_edit';
  const inputBindings = readInputBindings(execution.params?.inputBindings);
  const hasSourceInput = inputBindings.some((binding) => binding.inputRole === 'source');
  const isPromptGeneration = execution.capabilityId === 'image.text_to_image' && !hasSourceInput;
  const targetWidth = Math.round(sourceBlock.size.width);
  const targetHeight = Math.round(sourceBlock.size.height);
  const targetAspectRatio = targetHeight > 0 ? (targetWidth / targetHeight).toFixed(3) : 'unknown';
  const generationParams = execution.params?.generation as ImageGenerationParams | undefined;
  const referenceAssetIds = Array.isArray(execution.params?.referenceAssetIds)
    ? execution.params.referenceAssetIds.filter((assetId): assetId is string => typeof assetId === 'string')
    : [];
  const referenceAssets = referenceAssetIds
    .map((assetId) => snapshot.assets.find((candidate) => candidate.assetId === assetId))
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  const annotatedCompositeAssetId =
    typeof operationBlock.data.annotatedCompositeAssetId === 'string'
      ? operationBlock.data.annotatedCompositeAssetId
      : undefined;
  const annotatedCompositeAsset = snapshot.assets.find(
    (candidate) => candidate.assetId === annotatedCompositeAssetId,
  );
  const sourceAssetPath = localAssetPath(snapshot, asset);
  const annotatedCompositePath = localAssetPath(snapshot, annotatedCompositeAsset);
  const outputCount = Math.max(resultBlocks.length, execution.outputBlockIds.length);
  const outputPaths = resultBlocks.map((block, index) => {
    const assignedIndex = execution.outputBlockIds.indexOf(block.blockId);
    return localOutputPath(snapshot, execution, assignedIndex >= 0 ? assignedIndex : index, outputCount);
  });
  const isMultiResult = resultBlocks.length > 1;
  const inputAssignmentLines = inputBindings.flatMap((binding) => {
    const block = binding.blockId
      ? snapshot.blocks.find((candidate) => candidate.blockId === binding.blockId)
      : undefined;
    const bindingAsset = snapshot.assets.find((candidate) => candidate.assetId === binding.assetId);
    const bindingPath = localAssetPath(snapshot, bindingAsset);
    const title = block?.data.title?.trim() || binding.assetId || binding.blockId || 'image input';
    return [
      `- ${title}: role=${binding.inputRole}${binding.blockId ? `, blockId=${binding.blockId}` : ''}${binding.assetId ? `, assetId=${binding.assetId}` : ''}`,
      bindingAsset?.storageKey ? `  storageKey: ${bindingAsset.storageKey}` : undefined,
      bindingPath ? `  local path: ${bindingPath}` : undefined,
    ].filter((line): line is string => Boolean(line));
  });
  const inputContractLines = inputBindings.map((binding) => {
    const block = binding.blockId
      ? snapshot.blocks.find((candidate) => candidate.blockId === binding.blockId)
      : undefined;
    const title = block?.data.title?.trim() || binding.assetId || binding.blockId || 'image input';
    return `- ${title} [${binding.inputRole}]: ${inputRoleDefinition(binding.inputRole).promptDirective}`;
  });

  return [
    'Run this existing Retake Whiteboard image operation in Codex and write the result back to the board.',
    'If the $retake-whiteboard-codex skill is installed, use it for the Retake MCP writeback workflow. Otherwise follow this prompt directly.',
    '',
    'Identifiers:',
    `- projectId: ${snapshot.project.projectId}`,
    `- boardId: ${snapshot.board.boardId}`,
    snapshot.project.codexProjectPath ? `- expected Codex project path: ${snapshot.project.codexProjectPath}` : undefined,
    `- existing executionId: ${execution.executionId}`,
    sourceBlock.data.assetId
      ? `- source image blockId: ${sourceBlock.blockId}`
      : `- image placeholder blockId: ${sourceBlock.blockId}`,
    `- operation blockId: ${operationBlock.blockId}`,
    isMultiResult
      ? `- result image blockIds: ${resultBlocks.map((block) => block.blockId).join(', ')}`
      : `- result image blockId: ${resultBlock.blockId}`,
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
    generationParams?.model ? `- requested model preset: ${generationParams.model}` : undefined,
    execution.generationProfile ? `- generation profile: ${execution.generationProfile.name}` : undefined,
    typeof generationParams?.durationSeconds === 'number'
      ? `- requested duration: ${generationParams.durationSeconds}s`
      : undefined,
    generationParams?.motion ? `- requested motion: ${generationParams.motion}` : undefined,
    generationParams?.targetWidth && generationParams?.targetHeight
      ? `- requested output size: ${generationParams.targetWidth} x ${generationParams.targetHeight} px`
      : undefined,
    typeof generationParams?.variationCount === 'number'
      ? `- requested variation count: ${generationParams.variationCount}`
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
    inputAssignmentLines.length ? '' : undefined,
    inputAssignmentLines.length ? 'Image input assignments:' : undefined,
    ...inputAssignmentLines,
    '',
    'Operation:',
    `- capabilityId: ${execution.capabilityId}`,
    execution.skillId ? `- skillId: ${execution.skillId}` : undefined,
    execution.prompt ? `- instruction: ${execution.prompt}` : undefined,
    inputContractLines.length ? '' : undefined,
    inputContractLines.length ? 'Authoritative image input contract:' : undefined,
    inputContractLines.length
      ? '- These role assignments define how each image is exposed to the execution adapter. The user instruction may refine usage within a role but must not reassign roles.'
      : undefined,
    ...inputContractLines,
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
    generationParams?.aspectRatioPreset || typeof generationParams?.targetAspectRatio === 'number'
      ? '- Treat the requested aspect ratio as a native output-canvas requirement. Do not substitute another orientation or simulate the requested ratio with letterboxing or padding.'
      : undefined,
    isPromptGeneration && generationParams?.targetWidth && generationParams?.targetHeight
      ? '- Compose the final bitmap for the requested output pixel size when the available image tool supports size parameters. If it does not, still follow the requested aspect ratio and composition frame in the prompt.'
      : undefined,
    referenceAssets.length
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
    ...outputPaths.map((outputPath, index) =>
      isMultiResult
        ? `- variant ${index + 1}: ${outputPath} -> resultBlockId ${resultBlocks[index].blockId}`
        : `- ${outputPath}`,
    ),
    '- Use png, jpg, webp, or svg. Pass the final local file path to retake_import_asset.',
    '',
    'Rules:',
    '- Do not call retake_create_execution. The execution already exists.',
    '- Use the existing executionId for all reads, imports, result blocks, and failures.',
    snapshot.project.codexProjectPath
      ? `- Use ${snapshot.project.codexProjectPath} as the Codex project path for Retake binding validation and binding repair. Do not bind a different empty workspace just because it is the current shell directory.`
      : undefined,
    `- The operation block ${operationBlock.blockId} represents the visible execution node on the board.`,
    isMultiResult
      ? `- The ${resultBlocks.length} result image blocks already exist and represent the requested variants.`
      : '- The result image block already exists and represents this operation while it is queued/running/succeeded/failed.',
    isMultiResult
      ? '- Generate one distinct image per assigned resultBlockId. Do not reuse the same asset for multiple variants.'
      : `- When calling retake_update_image_result_block, pass resultBlockId ${resultBlock.blockId}.`,
    '- When calling retake_update_image_result_block, pass a concise, content-specific title for the generated image. For multiple results, distinguish them by visible content or treatment; do not use only generic names such as "Variant 1" or "Image 2".',
    '- Do not create another result block for this operation.',
    isMultiResult
      ? `- Spawn ${resultBlocks.length} subagents when subagent image generation is available, assigning one variant/output path/resultBlockId to each. As soon as any subagent finishes, immediately import and update that assigned Result Block; do not wait for the remaining variants before writing back a completed one. Wait for all subagents only before ending the task.`
      : undefined,
    isMultiResult
      ? '- If subagent image generation is unavailable, generate the variants sequentially in this task and preserve the same assignments.'
      : undefined,
    '- Do not replace the source block.',
    isAnnotationEdit ? '- Do not overwrite, delete, or move the source image block. The new result must be a separate Image Block.' : undefined,
    '',
    'Use the Retake MCP tools in this order:',
    snapshot.project.codexProjectPath
      ? `1. retake_validate_project_binding with the projectId, boardId, and codexProjectPath ${snapshot.project.codexProjectPath}.`
      : '1. retake_validate_project_binding with the projectId and boardId above.',
    snapshot.project.codexProjectPath
      ? `2. If validation is missing or stale, call retake_set_project_binding with codexProjectPath ${snapshot.project.codexProjectPath}.`
      : '2. If validation is missing or stale, call retake_set_project_binding for this Codex workspace path.',
    '3. retake_get_execution with the existing executionId above.',
    '4. retake_mark_execution_running with the existing executionId immediately before starting image generation or spawning subagents.',
    isMultiResult
      ? `5. Produce ${resultBlocks.length} distinct variants using the assignments above. Prefer one subagent per variant; otherwise run them sequentially. Process completed variants immediately in completion order.`
      : isAnnotationEdit
      ? '5. Open the source asset local path and annotated composite local path above. Use the source as the clean base and the composite as the edit brief, then generate/edit the final clean image and save it to the suggested output file path when possible.'
      : '5. Generate or edit the image according to the capabilityId, instruction, requested aspect ratio/output size, and reference images above, saving it to the suggested output file path when possible.',
    isMultiResult
      ? '6. As soon as each variant file is ready, call retake_import_asset with its assigned generated file and the existing executionId. Do not wait for all variants.'
      : '6. retake_import_asset with sourcePath set to the generated file and sourceExecutionId set to the existing executionId.',
    isMultiResult
      ? '7. Immediately after each import, call retake_update_image_result_block with the matching assigned resultBlockId. Partial writeback keeps the execution running; the execution succeeds only after every result block is updated.'
      : `7. retake_update_image_result_block with the existing executionId, resultBlockId ${resultBlock.blockId}, and assetId from retake_import_asset.`,
    '8. If the operation cannot produce usable results, call retake_fail_execution with the existing executionId and a concise errorMessage.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createImageResultRetryPrompt(snapshot: BoardSnapshot, resultBlock: BlockRecord): string {
  const executionId = typeof resultBlock.data.sourceExecutionId === 'string'
    ? resultBlock.data.sourceExecutionId
    : undefined;
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  if (!execution || execution.status !== 'failed') {
    throw new Error('Image result retry requires a failed execution.');
  }
  if (resultBlock.type !== 'image' || resultBlock.data.assetId) {
    throw new Error('Image result retry requires an incomplete Image Result Block.');
  }
  if (execution.adapter !== 'mcp_agent') {
    throw new Error('This retry prompt is only available for Codex Managed executions.');
  }

  const operationBlockId = typeof resultBlock.data.operationBlockId === 'string'
    ? resultBlock.data.operationBlockId
    : execution.params?.operationBlockId;
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === operationBlockId && block.type === 'operation',
  );
  if (!operationBlock) throw new Error('Operation Block for failed result retry was not found.');

  const sourceBinding = readInputBindings(execution.params?.inputBindings)
    .find((binding) => binding.inputRole === 'source');
  const sourceBlock = snapshot.blocks.find((block) => block.blockId === sourceBinding?.blockId) ?? resultBlock;
  const generation = execution.params?.generation as ImageGenerationParams | undefined;
  const retryExecution: ExecutionRecord = {
    ...execution,
    params: {
      ...execution.params,
      generation: generation ? { ...generation, variationCount: 1 } : undefined,
    },
  };
  const operationPrompt = createImageOperationPrompt(
    snapshot,
    sourceBlock,
    operationBlock,
    [resultBlock],
    retryExecution,
  );

  return [
    'Retry exactly one failed Retake Whiteboard image result and write it back to its existing Result Block.',
    `- retry resultBlockId: ${resultBlock.blockId}`,
    `- resume existing executionId: ${execution.executionId}`,
    '- Do not create a new Execution or Result Block.',
    '- Do not regenerate, replace, or update Result Blocks that already contain successful assets.',
    '- retake_mark_execution_running is expected to resume this failed Execution because it still has an incomplete assigned Result Block.',
    '',
    operationPrompt,
  ].join('\n');
}

function readInputBindings(
  value: unknown,
): Array<{ assetId?: string; blockId?: string; inputRole: ExecutionInputRole }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((binding) => {
    if (!binding || typeof binding !== 'object') return [];
    const record = binding as Record<string, unknown>;
    const blockId = typeof record.blockId === 'string' ? record.blockId : undefined;
    const assetId = typeof record.assetId === 'string' ? record.assetId : undefined;
    if ((!blockId && !assetId) || !isExecutionInputRole(record.inputRole)) return [];
    return [
      {
        blockId,
        inputRole: record.inputRole,
        assetId,
      },
    ];
  });
}

function localAssetPath(snapshot: BoardSnapshot, asset?: { storageProvider: string; storageKey: string }): string | undefined {
  if (!asset || (asset.storageProvider !== 'local' && asset.storageProvider !== 'local_mock')) return undefined;
  const localRoot = snapshot.project.localRoot ?? `.retake/projects/${snapshot.project.projectId}`;
  return joinLocalPath(snapshot.project.codexProjectPath, localRoot, asset.storageKey);
}

function localOutputPath(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  index: number,
  count: number,
): string {
  const suffix = count > 1 ? `-${index + 1}` : '';
  return joinLocalPath(snapshot.project.codexProjectPath, 'tmp/agent-output', `${execution.executionId}${suffix}.png`);
}

function joinLocalPath(projectPath: string | undefined, ...parts: string[]): string {
  const normalizedParts = parts.filter(Boolean);
  if (normalizedParts[0]?.startsWith('/')) return normalizedParts.join('/');
  if (!projectPath) return normalizedParts.join('/');
  return [projectPath, ...normalizedParts].join('/');
}
