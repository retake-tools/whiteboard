import { skillUiDefinitionFor } from '../core/skillRegistry';
import type { TextGenerationLabels } from '../core/textOperations';
import type { useI18n } from '../i18n';

export function textGenerationLabelsForSkill(
  skillId: string,
  t: ReturnType<typeof useI18n>['t'],
): TextGenerationLabels {
  const ui = skillUiDefinitionFor(skillId);
  const operationTitle = t(ui.operationTitleKey);
  return {
    inputSlots: ui.inputSlots?.map((slot) => ({
      slotId: slot.slotId,
      promptTitle: t(slot.inputKey),
      promptPlaceholder: t(slot.placeholderKey),
    })),
    operationTitle,
    promptPlaceholder: t(ui.placeholderKey),
    promptTitle: t(ui.inputKey),
    resultTitle: operationTitle,
    waitingBody: t('resultStatus.queued'),
  };
}
