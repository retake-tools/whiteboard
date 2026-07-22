import type { CapabilityInputBinding, SkillDefinitionLock } from './capabilityContracts';

export type SkillCategory = 'screenplay';

export interface SkillCapabilityBinding {
  capabilityId: string;
  inputSlots: string[];
  outputSlots: string[];
}

export interface RetakeSkillDefinition extends SkillDefinitionLock {
  schemaVersion: 1;
  name: string;
  description: string;
  category: SkillCategory;
  capabilityBindings: SkillCapabilityBinding[];
  instructionTemplate: string;
  outputRequirements: string[];
  source: {
    kind: 'catmeme_migration';
    paths: string[];
  };
}

export interface RetakeSkillSnapshot extends RetakeSkillDefinition {
  inputBindings: CapabilityInputBinding[];
}

export type RetakeEntryPoint =
  | {
      schemaVersion: 1;
      entrypointId: string;
      kind: 'skill';
      skillId: string;
      capabilityId: string;
    }
  | {
      schemaVersion: 1;
      entrypointId: string;
      kind: 'workflow';
      workflowDefinitionId: string;
    };

const screenplaySource = {
  kind: 'catmeme_migration' as const,
  paths: [
    'skills/production-workflow/registry.yaml',
    'skills/stage-story-development/SKILL.md',
    'skills/role-writer/SKILL.md',
  ],
};

export const screenplayFromBriefSkill: RetakeSkillDefinition = {
  schemaVersion: 1,
  skillId: 'retake.screenplay.from-brief',
  version: '0.1.0',
  definitionHash: 'sha256:retake-screenplay-from-brief-catmeme-v1',
  name: 'Generate screenplay',
  description: 'Turn a creative brief into an executable screenplay without inventing unsupported facts.',
  category: 'screenplay',
  capabilityBindings: [{
    capabilityId: 'story.screenplay.generate',
    inputSlots: ['brief', 'references'],
    outputSlots: ['screenplay'],
  }],
  instructionTemplate: `You are the Writer for a video production workflow. Convert the supplied brief into an executable Markdown screenplay.

Treat supplied sources as an evidence boundary. Preserve the protected core, explicit facts, constraints, characters, and required ending. Do not silently invent missing facts. When a gap materially affects execution, mark it as an assumption or open question.

Build a causal dramatic spine: objective, obstacle, stakes, escalation, turning point, and payoff. Prefer "but/therefore" progression over disconnected "and then" events. Every beat must change story state and must be expressible through visible action, reaction, sound, dialogue, or a production note. Dialogue cannot replace missing visual causality.

For short-form work, make the opening hook legible within roughly two seconds, preserve one clear visual promise, and make the ending pay off the premise. Keep production scope realistic and flag any beat whose cast, location, effect, or continuity requirement is not supported by the brief.`,
  outputRequirements: [
    'Return only the requested Markdown screenplay.',
    'Include a concise premise, protected core, production assumptions, and ordered scenes or beats.',
    'For each scene or beat, state visible action, story-state change, dialogue or sound when relevant, and continuity needs.',
    'End with a coverage check for hook, causality, escalation, payoff, character continuity, scene continuity, and unresolved questions.',
  ],
  source: screenplaySource,
};

export const normalizeScreenplaySkill: RetakeSkillDefinition = {
  schemaVersion: 1,
  skillId: 'retake.screenplay.normalize',
  version: '0.1.0',
  definitionHash: 'sha256:retake-screenplay-normalize-catmeme-v1',
  name: 'Organize screenplay',
  description: 'Organize an existing screenplay while preserving its story facts and intent.',
  category: 'screenplay',
  capabilityBindings: [{
    capabilityId: 'story.screenplay.normalize',
    inputSlots: ['source_screenplay', 'normalization_instruction'],
    outputSlots: ['screenplay'],
  }],
  instructionTemplate: `You are normalizing an existing screenplay for a video production workflow.

The source screenplay is authoritative. Preserve plot facts, character identities, dialogue intent, scene order, causal relationships, required ending, and explicit production constraints unless the normalization instruction explicitly authorizes a change. Do not add new plot, characters, locations, props, lore, or motivations.

Improve only structure, readability, scene and beat boundaries, production legibility, and clearly mechanical language errors. Keep uncertain source material uncertain; surface ambiguities and conflicts instead of resolving them by invention. Separate source facts, user-authorized changes, and editorial notes.`,
  outputRequirements: [
    'Return only the normalized Markdown screenplay.',
    'Retain all source facts and identify every user-authorized substantive change.',
    'Use ordered scenes or beats with visible action, dialogue or sound, story-state change, and continuity needs.',
    'End with unresolved ambiguities and a fidelity check.',
  ],
  source: screenplaySource,
};

const builtInSkills = [screenplayFromBriefSkill, normalizeScreenplaySkill] as const;

export function listSkills(): RetakeSkillDefinition[] {
  return [...builtInSkills];
}

export function listSkillEntryPoints(): RetakeEntryPoint[] {
  return builtInSkills.map((skill) => ({
    schemaVersion: 1,
    entrypointId: `skill:${skill.skillId}`,
    kind: 'skill',
    skillId: skill.skillId,
    capabilityId: capabilityForSkill(skill),
  }));
}

export function skillEntryPointFor(skillId: string): Extract<RetakeEntryPoint, { kind: 'skill' }> {
  const entrypoint = listSkillEntryPoints().find((candidate) => candidate.kind === 'skill' && candidate.skillId === skillId);
  if (!entrypoint || entrypoint.kind !== 'skill') throw new Error(`Skill EntryPoint not found: ${skillId}`);
  return entrypoint;
}

export function skillDefinitionFor(skillId: string): RetakeSkillDefinition {
  const skill = builtInSkills.find((candidate) => candidate.skillId === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  return skill;
}

export function skillsForCapability(capabilityId: string): RetakeSkillDefinition[] {
  return builtInSkills.filter((skill) => skill.capabilityBindings.some(
    (binding) => binding.capabilityId === capabilityId,
  ));
}

export function capabilityForSkill(skill: RetakeSkillDefinition): string {
  const capabilityId = skill.capabilityBindings[0]?.capabilityId;
  if (!capabilityId) throw new Error(`Skill has no capability binding: ${skill.skillId}`);
  return capabilityId;
}

export function snapshotSkill(
  skill: RetakeSkillDefinition,
  inputBindings: CapabilityInputBinding[],
): RetakeSkillSnapshot {
  return structuredClone({ ...skill, inputBindings });
}
