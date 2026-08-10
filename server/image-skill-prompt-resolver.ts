import { readFile } from 'node:fs/promises';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import type { RetakeSkillSnapshot } from '../src/core/skillRegistry';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { resolveBoundSkillPrompt } from './skill-prompt-resolver';

export async function resolveImageExecutionPrompt(
  execution: ExecutionRecord,
  snapshot: BoardSnapshot,
): Promise<string> {
  if (
    execution.capabilityId === 'image.generate'
    && fullSkillSnapshot(execution.skillSnapshot)
  ) {
    return withExecutionAdjustment(
      await resolveBoundSkillPrompt(execution, snapshot),
      executionAdjustmentInstruction(execution),
    );
  }
  const promptBinding = execution.inputBindingsSnapshot?.find(
    (binding) => binding.slotId === 'prompt',
  );
  const resolved = await Promise.all((promptBinding?.values ?? []).map(async (value) => {
    if (value.kind === 'inline') {
      return typeof value.value === 'string' ? value.value : JSON.stringify(value.value);
    }
    if (value.kind === 'block') {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === value.blockId);
      if (block?.type === 'text') return typeof block.data.body === 'string' ? block.data.body : '';
      if (block?.type === 'document' && typeof block.data.assetId === 'string') {
        return readDocument(snapshot.project.projectId, block.data.assetId);
      }
      return '';
    }
    if (value.kind === 'asset') {
      return readDocument(snapshot.project.projectId, value.assetId);
    }
    if (!value.blockId) return '';
    const block = snapshot.blocks.find((candidate) => candidate.blockId === value.blockId);
    return block?.type === 'document' && typeof block.data.assetId === 'string'
      ? readDocument(snapshot.project.projectId, block.data.assetId)
      : '';
  }));
  const prompt = resolved.map((value) => value.trim()).filter(Boolean).join('\n\n---\n\n')
    || execution.prompt?.trim();
  if (!prompt) throw new Error('Image generation requires a readable prompt input.');
  return withExecutionAdjustment(prompt, executionAdjustmentInstruction(execution));
}

function executionAdjustmentInstruction(execution: ExecutionRecord): string | undefined {
  const adjustment = execution.params?.executionAdjustmentInstruction;
  return typeof adjustment === 'string' && adjustment.trim()
    ? adjustment.trim()
    : undefined;
}

function withExecutionAdjustment(
  basePrompt: string,
  adjustment: string | undefined,
): string {
  if (!adjustment) return basePrompt;
  return [
    basePrompt,
    '# Current user adjustment',
    adjustment,
    'Apply this adjustment to the current result. Preserve every unspecified identity, composition, and workflow constraint.',
  ].join('\n\n');
}

function fullSkillSnapshot(
  input: ExecutionRecord['skillSnapshot'],
): input is RetakeSkillSnapshot {
  return Boolean(input && 'instructionTemplate' in input && 'inputBindings' in input);
}

async function readDocument(projectId: string, assetId: string): Promise<string> {
  const bytes = await readFile(await resolveAssetStoragePath(projectId, assetId));
  if (bytes.byteLength > 2 * 1024 * 1024) {
    throw new Error(`Image prompt document exceeds 2 MB: ${assetId}`);
  }
  return bytes.toString('utf8');
}
