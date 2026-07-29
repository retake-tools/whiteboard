import { Boxes, X } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  projectPluginRuntimeForProfileV1,
  type PluginModuleEffectiveProfileV1,
  type PluginProfileOverrideStateV1,
} from '@retake-tools/plugin-runtime';
import { resolvePluginLocalizedTextV2 } from '@retake-tools/package-contracts';
import type {
  PluginRuntimeControllerV1,
} from '../core/pluginRuntimeManagementClient';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';

export type PluginSettingsTarget =
  | {
    boardId: null;
    label: string;
    projectId: string;
    scope: 'project';
  }
  | {
    boardId: string;
    label: string;
    projectId: string;
    scope: 'board';
  };

export function ProjectBoardPluginSettings({
  locale,
  onClose,
  pluginController,
  runtime,
  target,
}: {
  locale: string;
  onClose: () => void;
  pluginController: PluginRuntimeControllerV1;
  runtime: ReturnType<PluginRuntimeControllerV1['getSnapshot']>;
  target: PluginSettingsTarget;
}): ReactElement {
  const { t } = useI18n();
  const profile = pluginController.getProfileState();
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const drawerRef = useRef<HTMLElement | null>(null);
  const effectiveModules = useMemo(() => (
    projectPluginRuntimeForProfileV1({
      boardId: target.boardId,
      profile,
      projectId: target.projectId,
      runtime,
    }).modules
  ), [profile, runtime, target]);

  useDismissiblePopover({
    active: true,
    onDismiss: onClose,
    rootRef: drawerRef,
  });

  const updatePluginState = (
    pluginModuleId: string,
    state: PluginProfileOverrideStateV1,
  ): void => {
    const busyKey = targetKey(target, pluginModuleId);
    setBusyId(busyKey);
    setError(undefined);
    void pluginController.updateProfile({
      boardId: target.boardId,
      pluginModuleId,
      projectId: target.projectId,
      scope: target.scope,
      state,
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => setBusyId(undefined));
  };

  return (
    <aside
      ref={drawerRef}
      className="project-board-manager-plugin-drawer"
      aria-label={t('projectBoard.pluginSettings')}
    >
      <header>
        <div>
          <span>
            <Boxes size={14} />
            {target.scope === 'project'
              ? t('projectBoard.projectPluginDefaults')
              : t('projectBoard.boardPluginOverrides')}
          </span>
          <h3>{target.label}</h3>
          <p>
            {target.scope === 'project'
              ? t('projectBoard.projectPluginDescription')
              : t('projectBoard.boardPluginDescription')}
          </p>
        </div>
        <button
          type="button"
          aria-label={t('context.close')}
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      {error ? (
        <div className="project-board-manager-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="project-board-manager-plugin-list">
        {runtime.modules.map((record) => {
          const effective = effectiveModules.find(
            (entry) => entry.pluginModuleId === record.pluginModuleId,
          );
          const selected = selectedOverride(
            profile.entries,
            target,
            record.pluginModuleId,
          );
          const busyKey = targetKey(target, record.pluginModuleId);
          return (
            <article key={record.pluginModuleId}>
              <div>
                <strong>
                  {resolvePluginLocalizedTextV2(
                    record.manifest.name,
                    locale === 'zh' ? 'zh-CN' : 'en',
                  )}
                </strong>
                <small>{record.pluginModuleId}</small>
              </div>
              <select
                aria-label={`${record.pluginModuleId} ${
                  t('projectBoard.pluginState')
                }`}
                disabled={busyId === busyKey}
                value={selected}
                onChange={(event) => updatePluginState(
                  record.pluginModuleId,
                  event.target.value as PluginProfileOverrideStateV1,
                )}
              >
                <option value="inherit">
                  {t('pluginSettings.scopeInherit')}
                </option>
                <option value="enabled">
                  {t('pluginSettings.statusEnabled')}
                </option>
                <option value="disabled">
                  {t('pluginSettings.statusDisabled')}
                </option>
              </select>
              <EffectivePluginState effective={effective} t={t} />
            </article>
          );
        })}
      </div>
    </aside>
  );
}

function EffectivePluginState({
  effective,
  t,
}: {
  effective?: PluginModuleEffectiveProfileV1;
  t: ReturnType<typeof useI18n>['t'];
}): ReactElement {
  if (!effective) return <small>{t('pluginSettings.statusInstalled')}</small>;
  const enabled = effective.activationState === 'enabled';
  return (
    <small className={enabled ? 'is-enabled' : 'is-disabled'}>
      {enabled
        ? t('pluginSettings.statusEnabled')
        : t('pluginSettings.statusDisabled')}
      {' · '}
      {effective.source.scope === 'board'
        ? t('pluginSettings.scopeBoard')
        : effective.source.scope === 'project'
          ? t('pluginSettings.scopeProject')
          : t('pluginSettings.scopeWorkspace')}
      {effective.blocker ? ` · ${effective.blocker}` : ''}
    </small>
  );
}

function selectedOverride(
  entries: ReturnType<
    PluginRuntimeControllerV1['getProfileState']
  >['entries'],
  target: PluginSettingsTarget,
  pluginModuleId: string,
): PluginProfileOverrideStateV1 {
  const entry = entries.find((candidate) => (
    candidate.pluginModuleId === pluginModuleId
    && candidate.scope === target.scope
    && candidate.projectId === target.projectId
    && (
      target.scope === 'project'
      || candidate.boardId === target.boardId
    )
  ));
  return entry?.state ?? 'inherit';
}

function targetKey(
  target: PluginSettingsTarget,
  pluginModuleId: string,
): string {
  return `${target.scope}:${target.projectId}:${
    target.boardId ?? ''
  }:${pluginModuleId}`;
}
