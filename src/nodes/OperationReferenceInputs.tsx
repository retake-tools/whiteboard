import { ImageIcon, Pencil } from 'lucide-react';
import type { ReactElement } from 'react';
import { referenceInputSlotLabel } from '../components/referenceInputLabels';
import type { BlockData } from '../core/types';
import { useI18n } from '../i18n';

export function OperationReferenceInputs({ data }: { data: BlockData }): ReactElement | null {
  const { t } = useI18n();
  const inputs = data.operationReferenceInputs ?? [];
  if (inputs.length === 0) return null;

  return (
    <div className="operation-reference-inputs nodrag nopan">
      <header>
        <strong>{t('operationReference.inputs')}</strong>
        <small>{inputs.length}</small>
      </header>
      <div>
        {inputs.map((input) => {
          const detail = operationReferenceInputDetail(input, t);
          return (
            <button
              key={input.edgeId}
              type="button"
              className={`operation-reference-input is-${input.bindingKind}`}
              aria-label={`${input.title}: ${detail}`}
              disabled={!input.editable}
              title={input.referenceIntent?.instruction ?? detail}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (!input.editable) return;
                const rect = event.currentTarget.getBoundingClientRect();
                window.dispatchEvent(new CustomEvent(
                  'retake:configure-operation-reference',
                  {
                    detail: {
                      edgeId: input.edgeId,
                      anchor: { x: rect.right + 8, y: rect.top },
                    },
                  },
                ));
              }}
            >
              <span className="operation-reference-thumbnail">
                {input.previewUrl
                  ? <img src={input.previewUrl} alt="" />
                  : <ImageIcon aria-hidden="true" size={14} />}
              </span>
              <span>
                <strong>{input.title}</strong>
                <small>{detail}</small>
              </span>
              {input.editable ? <Pencil aria-hidden="true" size={11} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function operationReferenceInputDetail(
  input: NonNullable<BlockData['operationReferenceInputs']>[number],
  t: ReturnType<typeof useI18n>['t'],
): string {
  const slotLabel = referenceInputSlotLabel({
    inputSlotId: input.inputSlotId,
  }, t);
  const label = !input.inputSlotId
    ? t('operationReference.bindingPending')
    : input.bindingKind === 'source'
      ? t('skillComposer.referenceModeSource')
      : input.referenceIntent?.label
        ?? (input.bindingKind === 'reference'
          ? t('skillComposer.referenceModeAuto')
          : slotLabel);
  return input.inputSlotId
    && input.bindingKind === 'slot'
    && input.referenceIntent?.label
      ? `${slotLabel} · ${input.referenceIntent.label}`
      : label;
}
