import type { ReactElement } from 'react';
import type { BlockData } from '../core/types';
import { useI18n } from '../i18n';
import { OperationReferenceInputs } from './OperationReferenceInputs';

export function PluginOwnedOperationControls({
  capabilityName,
  data,
}: {
  capabilityName: string;
  data: BlockData;
}): ReactElement {
  const { t } = useI18n();
  return (
    <div
      className="operation-inline-controls is-local-canvas"
      aria-label={t('operationToolbar.title')}
    >
      <div className="operation-option-row is-read-only">
        <span>{t('operationToolbar.capability')}</span>
        <strong>{capabilityName}</strong>
      </div>
      <div className="operation-option-row is-read-only">
        <span>{t('operationToolbar.executor')}</span>
        <strong>{t('operationToolbar.pluginOwned')}</strong>
      </div>
      <OperationReferenceInputs data={data} />
    </div>
  );
}
