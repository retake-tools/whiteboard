import type { useI18n } from '../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

export function referenceInputSlotLabel(
  input: {
    inputSlotId?: string;
    semanticRole?: string;
  },
  t: Translate,
): string {
  const { inputSlotId, semanticRole = inputSlotId } = input;
  if (semanticRole === 'source' || inputSlotId === 'source_image') {
    return t('operationReference.slotSource');
  }
  if (semanticRole === 'first_frame' || inputSlotId === 'first_frame') {
    return t('operationReference.slotFirstFrame');
  }
  if (semanticRole === 'last_frame' || inputSlotId === 'last_frame') {
    return t('operationReference.slotLastFrame');
  }
  if (
    semanticRole === 'character_reference'
    || inputSlotId === 'character_references'
  ) {
    return t('operationReference.slotCharacter');
  }
  if (
    semanticRole === 'scene_reference'
    || semanticRole === 'environment_reference'
    || inputSlotId === 'scene_references'
  ) {
    return t('operationReference.slotScene');
  }
  if (
    semanticRole === 'style_reference'
    || inputSlotId === 'style_references'
  ) {
    return t('operationReference.slotStyle');
  }
  if (
    semanticRole === 'composition_reference'
    || inputSlotId === 'composition_references'
  ) {
    return t('operationReference.slotComposition');
  }
  if (
    semanticRole === 'control_image'
    || inputSlotId === 'control_image'
    || inputSlotId === 'outpaint_guide'
  ) {
    return t('operationReference.slotControl');
  }
  if (semanticRole === 'inpaint_mask' || inputSlotId === 'inpaint_mask') {
    return t('operationReference.slotMask');
  }
  if (
    semanticRole === 'reference'
    || semanticRole === 'general_reference'
    || inputSlotId === 'references'
    || inputSlotId === 'general_references'
  ) {
    return t('operationReference.slotReference');
  }
  return inputSlotId?.replaceAll('_', ' ')
    ?? t('skillComposer.referenceModeReference');
}
