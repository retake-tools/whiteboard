interface ImageComposerWorkflowLayoutInput {
  operationBlockId: string;
  outputSlotBlockId?: string;
  referenceBlockIds: string[];
  textBlockId: string;
}

export function imageComposerWorkflowLayoutBlockIds(
  input: ImageComposerWorkflowLayoutInput,
): string[] {
  return [
    ...input.referenceBlockIds,
    input.textBlockId,
    input.operationBlockId,
    ...(input.outputSlotBlockId ? [input.outputSlotBlockId] : []),
  ];
}
