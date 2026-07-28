import { resolvedSkillUiDefinitionFor } from '../core/skillRegistry';
import type { TextGenerationLabels } from '../core/textOperations';
import type { useI18n } from '../i18n';

export function textGenerationLabelsForSkill(
  skillId: string,
  locale: string,
  t: ReturnType<typeof useI18n>['t'],
): TextGenerationLabels {
  const ui = resolvedSkillUiDefinitionFor(skillId, locale);
  const operationTitle = ui.operationTitle;
  return {
    inputSlots: ui.inputSlots?.map((slot) => ({
      slotId: slot.slotId,
      promptTitle: slot.label,
      promptPlaceholder: slot.placeholder,
    })),
    operationTitle,
    promptPlaceholder: ui.placeholder,
    promptTitle: ui.inputLabel,
    resultTitle: operationTitle,
    waitingBody: t('resultStatus.queued'),
  };
}
