import {
  Box,
  Check,
  ImageIcon,
  Images,
  LayoutGrid,
  Mountain,
  Palette,
  Pencil,
  PersonStanding,
  Scan,
  SlidersHorizontal,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { inputRoleDefinition, type InputRoleIcon } from '../core/inputRoles';
import type { ExecutionInputRole } from '../core/types';
import { useI18n } from '../i18n';

const iconByRoleType: Record<InputRoleIcon, LucideIcon> = {
  annotation: Pencil,
  character: UserRound,
  composition: LayoutGrid,
  control: SlidersHorizontal,
  environment: Mountain,
  frame: ImageIcon,
  general: Images,
  mask: Scan,
  object: Box,
  pose: PersonStanding,
  source: ImageIcon,
  style: Palette,
};

export function InputRoleOptionList({
  currentRole,
  disabledRoles = [],
  onRemove,
  onSelect,
  roles,
}: {
  currentRole?: ExecutionInputRole;
  disabledRoles?: ExecutionInputRole[];
  onRemove?: () => void;
  onSelect: (role: ExecutionInputRole) => void;
  roles: ExecutionInputRole[];
}): ReactElement {
  const { t } = useI18n();

  return (
    <div className="input-role-option-list">
      {roles.map((role) => {
        const definition = inputRoleDefinition(role);
        const Icon = iconByRoleType[definition.icon];
        const isDisabled = disabledRoles.includes(role) && role !== currentRole;
        return (
          <button
            key={role}
            type="button"
            className={role === currentRole ? 'input-role-option is-selected' : 'input-role-option'}
            disabled={isDisabled}
            role="menuitem"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(role);
            }}
          >
            <Icon size={16} />
            <span>
              <strong>{t(definition.titleKey)}</strong>
              <small>{isDisabled ? t('operationInputRole.roleLimitReached') : t(definition.descriptionKey)}</small>
            </span>
            {role === currentRole ? <Check size={15} /> : null}
          </button>
        );
      })}
      {onRemove ? (
        <button
          type="button"
          className="input-role-option is-remove"
          role="menuitem"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <X size={16} />
          <span>
            <strong>{t('operationInputRole.remove')}</strong>
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function inputRoleTitle(role: ExecutionInputRole, t: ReturnType<typeof useI18n>['t']): string {
  return t(inputRoleDefinition(role).titleKey);
}
