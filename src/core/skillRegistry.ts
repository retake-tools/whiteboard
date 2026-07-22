import type { CapabilityInputBinding, SkillDefinitionLock } from './capabilityContracts';

export type SkillCategory = 'previsualization' | 'production_design' | 'screenplay';

export type SkillNameKey =
  | 'skill.screenplayFromBrief.name'
  | 'skill.normalizeScreenplay.name'
  | 'skill.characterBible.name'
  | 'skill.sceneBible.name'
  | 'skill.storyboardPlan.name';

export type SkillDescriptionKey =
  | 'skill.screenplayFromBrief.description'
  | 'skill.normalizeScreenplay.description'
  | 'skill.characterBible.description'
  | 'skill.sceneBible.description'
  | 'skill.storyboardPlan.description';

export type SkillInputKey =
  | 'skill.common.referencesInput'
  | 'skill.screenplayFromBrief.input'
  | 'skill.normalizeScreenplay.input'
  | 'skill.normalizeScreenplay.instructionInput'
  | 'skill.characterBible.input'
  | 'skill.sceneBible.input'
  | 'skill.storyboardPlan.screenplayInput'
  | 'skill.storyboardPlan.characterInput'
  | 'skill.storyboardPlan.sceneInput';

export type SkillPlaceholderKey =
  | 'skill.common.referencesPlaceholder'
  | 'skill.screenplayFromBrief.placeholder'
  | 'skill.normalizeScreenplay.placeholder'
  | 'skill.normalizeScreenplay.instructionPlaceholder'
  | 'skill.characterBible.placeholder'
  | 'skill.sceneBible.placeholder'
  | 'skill.storyboardPlan.screenplayPlaceholder'
  | 'skill.storyboardPlan.characterPlaceholder'
  | 'skill.storyboardPlan.scenePlaceholder';

export type SkillOperationTitleKey =
  | 'operation.generateScreenplay.title'
  | 'operation.organizeScreenplay.title'
  | 'operation.defineCharacter.title'
  | 'operation.defineScene.title'
  | 'operation.generateStoryboardPlan.title';

export interface RetakeSkillUiInputSlot {
  inputKey: SkillInputKey;
  placeholderKey: SkillPlaceholderKey;
  slotId: string;
}

export interface RetakeSkillUiDefinition {
  descriptionKey: SkillDescriptionKey;
  inputKey: SkillInputKey;
  nameKey: SkillNameKey;
  operationTitleKey: SkillOperationTitleKey;
  placeholderKey: SkillPlaceholderKey;
  inputSlots?: RetakeSkillUiInputSlot[];
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
    kind: 'catmeme_migration';
    paths: string[];
  };
}

export interface RetakeSkillSnapshot extends RetakeSkillDefinition {
  inputBindings: CapabilityInputBinding[];
}

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

const productionDesignSource = {
  kind: 'catmeme_migration' as const,
  paths: [
    'skills-v1-node-workflow/design-character-designer/SKILL.md',
    'skills-v1-node-workflow/design-scene-designer/SKILL.md',
    'skills/role-production-designer/references/production-design.md',
  ],
};

export const characterBibleFromScreenplaySkill: RetakeSkillDefinition = {
  schemaVersion: 1,
  skillId: 'retake.character-bible.from-screenplay',
  version: '0.1.0',
  definitionHash: 'sha256:retake-character-bible-from-screenplay-catmeme-v1',
  name: 'Define characters',
  description: 'Extract stable, production-ready character constraints from an existing screenplay.',
  category: 'production_design',
  capabilityBindings: [{
    capabilityId: 'design.character.define',
    inputSlots: ['screenplay', 'references'],
    outputSlots: ['character_bible'],
  }],
  instructionTemplate: `You are the Character Designer for a video production workflow. Convert the supplied screenplay and optional references into a production-ready Markdown Character Bible.

The screenplay is the evidence boundary. Preserve character identities, relationships, story functions, actions, dialogue intent, and explicit visual facts. Do not invent unsupported biography, costume, props, or lore. Mark any useful but unsupported design choice as a proposal or open question.

Give every important character a stable identifier. Define story function, objective or pressure, readable silhouette, face and body traits, movement and performance language, expression range, visible wardrobe and accessories, and continuity rules. Separate invariant identity from scene-specific state. Note what must remain recognizable across shots, poses, lighting, and later image or video generation.

Describe future reference needs such as turnarounds, expression sheets, action poses, scale comparisons, or prop callouts, but do not claim those assets were generated, approved, or added to a library. This Skill produces one document only and must not mutate shared design files or run media-generation steps.`,
  outputRequirements: [
    'Return only the requested Markdown Character Bible.',
    'Include source traceability, stable identifiers, production constraints, continuity rules, and scene-specific state for each important character.',
    'List future reference assets as needed or proposed; never present them as generated or approved.',
    'End with unresolved questions, assumptions, and screenplay coverage.',
  ],
  source: productionDesignSource,
};

export const sceneBibleFromScreenplaySkill: RetakeSkillDefinition = {
  schemaVersion: 1,
  skillId: 'retake.scene-bible.from-screenplay',
  version: '0.1.0',
  definitionHash: 'sha256:retake-scene-bible-from-screenplay-catmeme-v1',
  name: 'Define scenes',
  description: 'Extract stable scene, spatial, lighting, and continuity constraints from an existing screenplay.',
  category: 'production_design',
  capabilityBindings: [{
    capabilityId: 'design.scene.define',
    inputSlots: ['screenplay', 'references'],
    outputSlots: ['scene_bible'],
  }],
  instructionTemplate: `You are the Scene Designer for a video production workflow. Convert the supplied screenplay and optional references into a production-ready Markdown Scene Bible.

The screenplay is the evidence boundary. Preserve named locations, time, weather, action requirements, entrances and exits, props, spatial facts, and continuity. Do not silently invent new locations, architecture, objects, or lore. Mark unsupported but useful design choices as proposals or open questions.

A scene is not a decorative background. For every production location, define its identity, spatial zones or map, entrances and exits, obstacles, practical light sources, environmental pressure, interactive objects, blocking opportunities, relationship compositions, and state changes across beats. Separate invariant location identity from scene-specific time, damage, dressing, lighting, and occupancy.

Describe future reference needs such as layout diagrams, key views, lighting states, prop callouts, or scale references, but do not claim those assets were generated, approved, or added to a library. This Skill produces one document only and must not mutate shared design files or run media-generation steps.`,
  outputRequirements: [
    'Return only the requested Markdown Scene Bible.',
    'Include source traceability, stable location identifiers, spatial logic, blocking affordances, lighting, interactive objects, continuity rules, and state changes.',
    'List future reference assets as needed or proposed; never present them as generated or approved.',
    'End with unresolved questions, assumptions, and screenplay coverage.',
  ],
  source: productionDesignSource,
};

const storyboardSource = {
  kind: 'catmeme_migration' as const,
  paths: [
    'skills-v1-node-workflow/previs-storyboard-director/SKILL.md',
    'skills/role-storyboard-director/SKILL.md',
    'skills/role-storyboard-director/references/storyboard-structure.md',
    'skills-v1-node-workflow/video-production-methods/references/storyboard-and-segmentation.md',
  ],
};

export const storyboardPlanFromProductionDesignSkill: RetakeSkillDefinition = {
  schemaVersion: 1,
  skillId: 'retake.storyboard-plan.from-production-design',
  version: '0.1.0',
  definitionHash: 'sha256:retake-storyboard-plan-from-production-design-catmeme-v1',
  name: 'Generate storyboard plan',
  description: 'Turn an approved screenplay and production design bibles into a shot-level storyboard plan.',
  category: 'previsualization',
  capabilityBindings: [{
    capabilityId: 'previs.storyboard.plan',
    inputSlots: ['screenplay', 'character_bible', 'scene_bible', 'references'],
    outputSlots: ['storyboard_plan'],
  }],
  instructionTemplate: `You are the Storyboard Director for a video production workflow. Convert the supplied screenplay, Character Bible, Scene Bible, and optional references into one production-ready Markdown Storyboard Plan.

The screenplay is the story authority. The Character Bible and Scene Bible are the design authorities. Preserve their facts, identifiers, relationships, state, spatial logic, lighting, props, continuity constraints, and required ending. Do not invent missing design facts. If an unresolved gap prevents a reliable shot decision, expose it and identify the upstream production-design input that must be resolved.

Design the sequence from story beats and natural visual boundaries, not by mechanically slicing time into fixed seconds. Organize the plan as sequence, generation unit, shot, and performance beat. Every shot must have a story function and inherit the source beat it realizes. Use relationship composition, blocking, environment pressure, object state, reactions, and transitions to make causality visible; do not reduce the plan to repeated protagonist-only coverage.

For each generation unit, define its purpose, boundary reason, emotional movement, environmental and object-state change, pressure source, relationship composition, required assets, start state, end state, and bridge to adjacent units. For each shot, define a stable identifier, source traceability, shot purpose, framing and camera intent, subject relationships and blocking, visible action and performance beats, environment and object changes, sound or dialogue, transition, continuity requirements, and production risks.

Describe future storyboard sheets, keyframes, image references, or generation assets only as needed or proposed. Do not claim they were generated, approved, submitted to a provider, or added to a library. This Skill produces one document only and must not execute units, generate media, mutate shared files, or advance workflow approvals.`,
  outputRequirements: [
    'Return only the requested Markdown Storyboard Plan.',
    'Include source traceability and an ordered sequence of generation units, shots, and performance beats.',
    'For every unit and shot, preserve story and design authority while stating camera intent, relational composition, blocking, continuity, state changes, sound, transitions, required assets, and risks.',
    'List storyboard sheets and media assets only as needed or proposed; never present them as generated, approved, submitted, or added to a library.',
    'End with screenplay coverage, continuity coverage, design gaps, unresolved questions, and upstream return points.',
  ],
  source: storyboardSource,
};

const builtInSkills = [
  screenplayFromBriefSkill,
  normalizeScreenplaySkill,
  characterBibleFromScreenplaySkill,
  sceneBibleFromScreenplaySkill,
  storyboardPlanFromProductionDesignSkill,
] as const;

const skillUiDefinitions: Record<string, RetakeSkillUiDefinition> = {
  [screenplayFromBriefSkill.skillId]: {
    nameKey: 'skill.screenplayFromBrief.name',
    descriptionKey: 'skill.screenplayFromBrief.description',
    inputKey: 'skill.screenplayFromBrief.input',
    placeholderKey: 'skill.screenplayFromBrief.placeholder',
    operationTitleKey: 'operation.generateScreenplay.title',
    inputSlots: [
      {
        slotId: 'brief',
        inputKey: 'skill.screenplayFromBrief.input',
        placeholderKey: 'skill.screenplayFromBrief.placeholder',
      },
      {
        slotId: 'references',
        inputKey: 'skill.common.referencesInput',
        placeholderKey: 'skill.common.referencesPlaceholder',
      },
    ],
  },
  [normalizeScreenplaySkill.skillId]: {
    nameKey: 'skill.normalizeScreenplay.name',
    descriptionKey: 'skill.normalizeScreenplay.description',
    inputKey: 'skill.normalizeScreenplay.input',
    placeholderKey: 'skill.normalizeScreenplay.placeholder',
    operationTitleKey: 'operation.organizeScreenplay.title',
    inputSlots: [
      {
        slotId: 'source_screenplay',
        inputKey: 'skill.normalizeScreenplay.input',
        placeholderKey: 'skill.normalizeScreenplay.placeholder',
      },
      {
        slotId: 'normalization_instruction',
        inputKey: 'skill.normalizeScreenplay.instructionInput',
        placeholderKey: 'skill.normalizeScreenplay.instructionPlaceholder',
      },
    ],
  },
  [characterBibleFromScreenplaySkill.skillId]: {
    nameKey: 'skill.characterBible.name',
    descriptionKey: 'skill.characterBible.description',
    inputKey: 'skill.characterBible.input',
    placeholderKey: 'skill.characterBible.placeholder',
    operationTitleKey: 'operation.defineCharacter.title',
    inputSlots: [
      {
        slotId: 'screenplay',
        inputKey: 'skill.characterBible.input',
        placeholderKey: 'skill.characterBible.placeholder',
      },
      {
        slotId: 'references',
        inputKey: 'skill.common.referencesInput',
        placeholderKey: 'skill.common.referencesPlaceholder',
      },
    ],
  },
  [sceneBibleFromScreenplaySkill.skillId]: {
    nameKey: 'skill.sceneBible.name',
    descriptionKey: 'skill.sceneBible.description',
    inputKey: 'skill.sceneBible.input',
    placeholderKey: 'skill.sceneBible.placeholder',
    operationTitleKey: 'operation.defineScene.title',
    inputSlots: [
      {
        slotId: 'screenplay',
        inputKey: 'skill.sceneBible.input',
        placeholderKey: 'skill.sceneBible.placeholder',
      },
      {
        slotId: 'references',
        inputKey: 'skill.common.referencesInput',
        placeholderKey: 'skill.common.referencesPlaceholder',
      },
    ],
  },
  [storyboardPlanFromProductionDesignSkill.skillId]: {
    nameKey: 'skill.storyboardPlan.name',
    descriptionKey: 'skill.storyboardPlan.description',
    inputKey: 'skill.storyboardPlan.screenplayInput',
    placeholderKey: 'skill.storyboardPlan.screenplayPlaceholder',
    operationTitleKey: 'operation.generateStoryboardPlan.title',
    inputSlots: [
      {
        slotId: 'screenplay',
        inputKey: 'skill.storyboardPlan.screenplayInput',
        placeholderKey: 'skill.storyboardPlan.screenplayPlaceholder',
      },
      {
        slotId: 'character_bible',
        inputKey: 'skill.storyboardPlan.characterInput',
        placeholderKey: 'skill.storyboardPlan.characterPlaceholder',
      },
      {
        slotId: 'scene_bible',
        inputKey: 'skill.storyboardPlan.sceneInput',
        placeholderKey: 'skill.storyboardPlan.scenePlaceholder',
      },
      {
        slotId: 'references',
        inputKey: 'skill.common.referencesInput',
        placeholderKey: 'skill.common.referencesPlaceholder',
      },
    ],
  },
};

export function listSkills(): RetakeSkillDefinition[] {
  return [...builtInSkills];
}

export function skillUiDefinitionFor(skillId: string): RetakeSkillUiDefinition {
  const definition = skillUiDefinitions[skillId];
  if (!definition) throw new Error(`Skill UI definition not found: ${skillId}`);
  return definition;
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
