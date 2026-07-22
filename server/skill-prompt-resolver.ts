import { readFile } from 'node:fs/promises';
import type { CapabilityBindingValue } from '../src/core/capabilityContracts';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import type { RetakeSkillSnapshot } from '../src/core/skillRegistry';
import { resolveAssetStoragePath } from './local-store/asset-files';

export async function resolveTextExecutionPrompt(
  execution: ExecutionRecord,
  snapshot: BoardSnapshot,
): Promise<string> {
  const skill = fullSkillSnapshot(execution.skillSnapshot);
  if (!skill) {
    const prompt = execution.prompt?.trim();
    if (!prompt) throw new Error('Text generation requires a non-empty prompt.');
    return `${prompt}\n\nReturn only the requested Markdown document. Do not call tools and do not add process commentary.`;
  }
  const sections: string[] = [];
  for (const binding of skill.inputBindings) {
    const contents = await Promise.all(binding.values.map((value) => resolveBindingValue(value, snapshot)));
    const nonEmpty = contents.map((value) => value.trim()).filter(Boolean);
    if (nonEmpty.length > 0) sections.push(`## ${binding.slotId}\n${nonEmpty.join('\n\n---\n\n')}`);
  }
  if (sections.length === 0) throw new Error(`Skill ${skill.skillId} has no readable inputs.`);
  return [
    skill.instructionTemplate.trim(),
    '# Bound inputs',
    sections.join('\n\n'),
    '# Output requirements',
    skill.outputRequirements.map((requirement) => `- ${requirement}`).join('\n'),
  ].join('\n\n');
}

function fullSkillSnapshot(input: ExecutionRecord['skillSnapshot']): RetakeSkillSnapshot | undefined {
  if (!input || !('instructionTemplate' in input) || !('inputBindings' in input)) return undefined;
  return input as RetakeSkillSnapshot;
}

async function resolveBindingValue(value: CapabilityBindingValue, snapshot: BoardSnapshot): Promise<string> {
  if (value.kind === 'inline') return typeof value.value === 'string' ? value.value : JSON.stringify(value.value);
  if (value.kind === 'artifact_revision') throw new Error('Artifact revision text resolution is not available in Skill V0.');
  if (value.kind === 'block') {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === value.blockId);
    if (!block) throw new Error(`Skill input block not found: ${value.blockId}`);
    if (block.type === 'text') return typeof block.data.body === 'string' ? block.data.body : '';
    if (block.type === 'document' && typeof block.data.assetId === 'string') {
      return readDocumentAsset(snapshot.project.projectId, block.data.assetId);
    }
    throw new Error(`Skill input block is not readable text: ${value.blockId}`);
  }
  return readDocumentAsset(snapshot.project.projectId, value.assetId);
}

async function readDocumentAsset(projectId: string, assetId: string): Promise<string> {
  const bytes = await readFile(await resolveAssetStoragePath(projectId, assetId));
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error(`Skill document input exceeds 2 MB: ${assetId}`);
  return bytes.toString('utf8');
}
