import type { ExecutionInputRole } from './types';

export type InputRoleIcon =
  | 'annotation'
  | 'character'
  | 'composition'
  | 'control'
  | 'environment'
  | 'frame'
  | 'general'
  | 'mask'
  | 'object'
  | 'pose'
  | 'source'
  | 'style';

export interface InputRoleDefinition {
  roleId: ExecutionInputRole;
  titleKey: `operationInputRole.${ExecutionInputRole}.title`;
  descriptionKey: `operationInputRole.${ExecutionInputRole}.description`;
  icon: InputRoleIcon;
  userSelectable: boolean;
  maxCount: number | 'many';
  promptDirective: string;
}

const inputRoleDefinitions: Record<ExecutionInputRole, InputRoleDefinition> = {
  annotated_composite: defineRole(
    'annotated_composite',
    'annotation',
    false,
    1,
    'Use this annotated composite as the authoritative spatial edit brief. Do not reproduce its annotations.',
  ),
  character_reference: defineRole(
    'character_reference',
    'character',
    true,
    'many',
    'Use this image for character identity. Preserve facial features, body proportions, and costume design.',
  ),
  composition_reference: defineRole(
    'composition_reference',
    'composition',
    true,
    'many',
    'Use this image for camera angle, spatial layout, framing, and subject placement.',
  ),
  control_image: defineRole(
    'control_image',
    'control',
    false,
    'many',
    'Use this image as a structural control input according to the selected provider capability.',
  ),
  depth_map: defineRole(
    'depth_map',
    'control',
    false,
    1,
    'Use this depth map to preserve scene depth and spatial structure.',
  ),
  edge_map: defineRole(
    'edge_map',
    'control',
    false,
    1,
    'Use this edge map to preserve contours and structural boundaries.',
  ),
  environment_reference: defineRole(
    'environment_reference',
    'environment',
    true,
    'many',
    'Use this image for the environment, background, architecture, spatial relationships, and atmosphere.',
  ),
  first_frame: defineRole(
    'first_frame',
    'frame',
    false,
    1,
    'Use this image as the exact first-frame visual state.',
  ),
  general_reference: defineRole(
    'general_reference',
    'general',
    true,
    'many',
    'Use this image as a general visual reference. Follow the user instruction for the specific aspects to borrow.',
  ),
  inpaint_mask: defineRole(
    'inpaint_mask',
    'mask',
    false,
    1,
    'Use this mask to identify the editable image region.',
  ),
  last_frame: defineRole(
    'last_frame',
    'frame',
    false,
    1,
    'Use this image as the exact last-frame visual state.',
  ),
  object_reference: defineRole(
    'object_reference',
    'object',
    true,
    'many',
    'Use this image to preserve the appearance and design of the referenced product, prop, building, or object.',
  ),
  pose_reference: defineRole(
    'pose_reference',
    'pose',
    true,
    'many',
    'Use this image for pose, action, gesture, and body relationships without copying unrelated identity or style.',
  ),
  source: defineRole(
    'source',
    'source',
    true,
    1,
    'Use this image as the editable base. Preserve its subject, composition, and primary content unless instructed otherwise.',
  ),
  style_reference: defineRole(
    'style_reference',
    'style',
    true,
    'many',
    'Use this image for visual style, palette, lighting, texture, and material treatment. Do not copy unrelated subjects.',
  ),
};

export function inputRoleDefinition(role: ExecutionInputRole): InputRoleDefinition {
  return inputRoleDefinitions[role];
}

export function isExecutionInputRole(value: unknown): value is ExecutionInputRole {
  return typeof value === 'string' && value in inputRoleDefinitions;
}

function defineRole(
  roleId: ExecutionInputRole,
  icon: InputRoleIcon,
  userSelectable: boolean,
  maxCount: number | 'many',
  promptDirective: string,
): InputRoleDefinition {
  return {
    roleId,
    titleKey: `operationInputRole.${roleId}.title`,
    descriptionKey: `operationInputRole.${roleId}.description`,
    icon,
    userSelectable,
    maxCount,
    promptDirective,
  };
}
