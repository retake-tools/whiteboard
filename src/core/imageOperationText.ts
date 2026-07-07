import type { ImageCodexOperation } from './imageOperations';
import type { I18nContextValue } from '../i18n';

type Translate = I18nContextValue['t'];

export function imageOperationTitle(operation: ImageCodexOperation, t: Translate): string {
  if (operation === 'generate_image') return t('operation.generateImage.title');
  if (operation === 'annotation_edit') return t('operation.annotationEdit.title');
  if (operation === 'quick_edit') return t('operation.quickEdit.title');
  return t('operation.createSimilar.title');
}

export function imageOperationDefaultPrompt(operation: ImageCodexOperation, t: Translate): string {
  if (operation === 'generate_image') return t('operation.generateImage.prompt');
  if (operation === 'annotation_edit') return t('operation.annotationEdit.prompt');
  if (operation === 'quick_edit') return t('operation.quickEdit.prompt');
  return t('operation.createSimilar.prompt');
}
