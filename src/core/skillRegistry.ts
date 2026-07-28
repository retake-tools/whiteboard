import {
  resolvePluginLocalizedTextV2,
  type PluginLocalizedTextV2,
} from '@retake-tools/package-contracts';
import type { CapabilityInputBinding, SkillDefinitionLock } from './capabilityContracts';
import { tryCapabilityDefinitionFor } from './capabilityRegistry';
import screenplayFromBriefSource from '../../packages/builtin/story-production-starter/skills/screenplay-from-brief/retake.skill.json';
import normalizeScreenplaySource from '../../packages/builtin/story-production-starter/skills/screenplay-normalize/retake.skill.json';
import characterBibleSource from '../../packages/builtin/story-production-starter/skills/character-bible-from-screenplay/retake.skill.json';
import sceneBibleSource from '../../packages/builtin/story-production-starter/skills/scene-bible-from-screenplay/retake.skill.json';
import storyboardPlanSource from '../../packages/builtin/story-production-starter/skills/storyboard-plan-from-production-design/retake.skill.json';
import storyboardSheetSource from '../../packages/builtin/story-production-starter/skills/storyboard-sheet-from-unit-plan/retake.skill.json';
import generationPackageSource from '../../packages/builtin/story-production-starter/skills/video-generation-package-from-approved-storyboard/retake.skill.json';
import domainVideoSource from '../../packages/builtin/story-production-starter/skills/video-generation-from-approved-package/retake.skill.json';

export type SkillCategory = 'media_generation' | 'previsualization' | 'production_design' | 'screenplay';

export interface RetakeSkillUiInputSlot {
  label: PluginLocalizedTextV2;
  placeholder: PluginLocalizedTextV2;
  slotId: string;
}

export interface RetakeSkillUiDefinition {
  description: PluginLocalizedTextV2;
  inputLabel: PluginLocalizedTextV2;
  name: PluginLocalizedTextV2;
  operationTitle: PluginLocalizedTextV2;
  placeholder: PluginLocalizedTextV2;
  inputSlots?: RetakeSkillUiInputSlot[];
}

export interface ResolvedRetakeSkillUiDefinition {
  description: string;
  inputLabel: string;
  name: string;
  operationTitle: string;
  placeholder: string;
  inputSlots?: Array<{
    label: string;
    placeholder: string;
    slotId: string;
  }>;
}

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
    kind: 'builtin' | 'catmeme_migration' | 'package';
    paths?: string[];
  };
  ui?: RetakeSkillUiDefinition;
}

export interface RetakeSkillSnapshot extends RetakeSkillDefinition {
  inputBindings: CapabilityInputBinding[];
}

export const screenplayFromBriefSkill = screenplayFromBriefSource as unknown as RetakeSkillDefinition;
export const normalizeScreenplaySkill = normalizeScreenplaySource as unknown as RetakeSkillDefinition;
export const characterBibleFromScreenplaySkill = characterBibleSource as unknown as RetakeSkillDefinition;
export const sceneBibleFromScreenplaySkill = sceneBibleSource as unknown as RetakeSkillDefinition;
export const storyboardPlanFromProductionDesignSkill = storyboardPlanSource as unknown as RetakeSkillDefinition;
export const storyboardSheetFromUnitPlanSkill = storyboardSheetSource as unknown as RetakeSkillDefinition;
export const videoGenerationPackageFromApprovedStoryboardSkill = generationPackageSource as unknown as RetakeSkillDefinition;
export const videoGenerationFromApprovedPackageSkill = domainVideoSource as unknown as RetakeSkillDefinition;

const builtInSkills = [
  screenplayFromBriefSkill,
  normalizeScreenplaySkill,
  characterBibleFromScreenplaySkill,
  sceneBibleFromScreenplaySkill,
  storyboardPlanFromProductionDesignSkill,
  storyboardSheetFromUnitPlanSkill,
  videoGenerationPackageFromApprovedStoryboardSkill,
  videoGenerationFromApprovedPackageSkill,
] as const;

let activeSkills: RetakeSkillDefinition[] = structuredClone([...builtInSkills]);

export function listSkills(): RetakeSkillDefinition[] {
  return structuredClone(activeSkills);
}

export function configureSkillRegistry(
  definitions: RetakeSkillDefinition[],
): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.skillId)) throw new Error(`Duplicate Skill ID: ${definition.skillId}`);
    ids.add(definition.skillId);
    if (
      definition.schemaVersion !== 1
      || !definition.skillId
      || !definition.version
      || !definition.definitionHash
      || definition.capabilityBindings.length === 0
    ) throw new Error(`Skill definition is invalid: ${definition.skillId}`);
    for (const binding of definition.capabilityBindings) {
      const capability = tryCapabilityDefinitionFor(binding.capabilityId);
      if (!capability) continue;
      for (const inputSlotId of binding.inputSlots) {
        if (!capability.inputSlots.some((slot) => slot.slotId === inputSlotId)) {
          throw new Error(`Skill input Slot is not registered: ${definition.skillId}.${inputSlotId}`);
        }
      }
      for (const outputSlotId of binding.outputSlots) {
        if (!capability.outputSlots.some((slot) => slot.slotId === outputSlotId)) {
          throw new Error(`Skill output Slot is not registered: ${definition.skillId}.${outputSlotId}`);
        }
      }
    }
  }
  activeSkills = structuredClone(definitions);
}

export function skillUiDefinitionFor(skillId: string): RetakeSkillUiDefinition {
  const definition = skillDefinitionFor(skillId).ui;
  if (!definition) throw new Error(`Skill UI definition not found: ${skillId}`);
  return structuredClone(definition);
}

export function resolvedSkillUiDefinitionFor(
  skillId: string,
  locale: string,
): ResolvedRetakeSkillUiDefinition {
  const definition = skillUiDefinitionFor(skillId);
  return {
    description: resolvePluginLocalizedTextV2(definition.description, locale),
    inputLabel: resolvePluginLocalizedTextV2(definition.inputLabel, locale),
    name: resolvePluginLocalizedTextV2(definition.name, locale),
    operationTitle: resolvePluginLocalizedTextV2(definition.operationTitle, locale),
    placeholder: resolvePluginLocalizedTextV2(definition.placeholder, locale),
    ...(definition.inputSlots ? {
      inputSlots: definition.inputSlots.map((slot) => ({
        label: resolvePluginLocalizedTextV2(slot.label, locale),
        placeholder: resolvePluginLocalizedTextV2(slot.placeholder, locale),
        slotId: slot.slotId,
      })),
    } : {}),
  };
}

export function skillDefinitionFor(skillId: string): RetakeSkillDefinition {
  const skill = activeSkills.find((candidate) => candidate.skillId === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  return structuredClone(skill);
}

export function skillsForCapability(capabilityId: string): RetakeSkillDefinition[] {
  return structuredClone(activeSkills.filter((skill) => skill.capabilityBindings.some(
    (binding) => binding.capabilityId === capabilityId,
  )));
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
