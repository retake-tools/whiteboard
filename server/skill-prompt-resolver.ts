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
  return resolveBoundSkillPrompt(execution, snapshot, skill);
}

export async function resolveBoundSkillPrompt(
  execution: ExecutionRecord,
  snapshot: BoardSnapshot,
  skill = fullSkillSnapshot(execution.skillSnapshot),
): Promise<string> {
  if (!skill) throw new Error('Execution does not contain a full Skill snapshot.');
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
  if (value.kind === 'artifact_revision') {
    if (!value.blockId) {
      throw new Error(`Artifact revision text binding is missing its projected Block: ${value.artifactRevisionId}`);
    }
    const block = snapshot.blocks.find((candidate) => candidate.blockId === value.blockId);
    if (!block) throw new Error(`Artifact revision projected Block not found: ${value.artifactRevisionId}`);
    if (block.type === 'document' && typeof block.data.assetId === 'string') {
      return readDocumentAsset(snapshot.project.projectId, block.data.assetId);
    }
    if (block.type === 'text') return typeof block.data.body === 'string' ? block.data.body : '';
    if (block.type === 'image' || block.type === 'video') {
      return `Attached ${block.type} Artifact Revision: ${value.artifactRevisionId}`;
    }
    throw new Error(`Artifact revision binding is not a readable Skill input: ${value.artifactRevisionId}`);
  }
  if (value.kind === 'block') {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === value.blockId);
    if (!block) throw new Error(`Skill input block not found: ${value.blockId}`);
    if (block.type === 'text') return typeof block.data.body === 'string' ? block.data.body : '';
    if (block.type === 'document' && typeof block.data.assetId === 'string') {
      return readDocumentAsset(snapshot.project.projectId, block.data.assetId);
    }
    if (block.type === 'image' || block.type === 'video') {
      return `Attached ${block.type} Block: ${block.blockId}`;
    }
    throw new Error(`Skill input block is not readable text: ${value.blockId}`);
  }
  const asset = snapshot.assets.find((candidate) => candidate.assetId === value.assetId);
  if (!asset) throw new Error(`Skill input Asset not found: ${value.assetId}`);
  return asset.kind === 'document'
    ? readDocumentAsset(snapshot.project.projectId, value.assetId)
    : `Attached ${asset.kind} Asset: ${value.assetId}`;
}

async function readDocumentAsset(projectId: string, assetId: string): Promise<string> {
  const bytes = await readFile(await resolveAssetStoragePath(projectId, assetId));
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error(`Skill document input exceeds 2 MB: ${assetId}`);
  return bytes.toString('utf8');
}
