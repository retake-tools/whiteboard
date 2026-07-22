import {
  Clapperboard,
  BookOpen,
  FileText,
  Hand,
  ImageIcon,
  Layers3,
  MousePointer2,
  Play,
  Shapes,
  Sparkles,
  Search,
  Video,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import {
  listPackageEntryPoints,
  listRecommendedPackageEntryPoints,
  type RegisteredPackageEntryPoint,
} from '../core/packageRegistry';
import {
  skillUiDefinitionFor,
} from '../core/skillRegistry';
import { shouldShowSkillDock } from '../core/releaseFeatures';
import type { BlockType } from '../core/types';
import {
  workflowUiDefinitionFor,
} from '../core/workflowRegistry';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

const skillDockVisible = shouldShowSkillDock({ DEV: import.meta.env?.DEV === true });

export type CanvasTool = 'group' | 'select' | 'pan';

interface FloatingToolbarProps {
  activeTool: CanvasTool;
  onAddBlock: (type: Extract<BlockType, 'group' | 'image' | 'operation' | 'text' | 'video'>) => void;
  onCreateImageToImage: () => void;
  onCreateTextToImage: () => void;
  onInvokeEntryPoint?: (entrypointId: string) => void;
  onSetActiveTool: (tool: CanvasTool) => void;
}

export function FloatingToolbar({
  activeTool,
  onAddBlock,
  onCreateImageToImage,
  onCreateTextToImage,
  onInvokeEntryPoint,
  onSetActiveTool,
}: FloatingToolbarProps): ReactElement {
  const { t } = useI18n();
  const skillDockRef = useRef<HTMLElement>(null);
  const [skillLibraryOpen, setSkillLibraryOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const entrypoints = useMemo(() => listPackageEntryPoints().filter(
    ({ entrypoint }) => entrypoint.kind === 'skill' || entrypoint.kind === 'workflow',
  ), []);
  const recommendedEntryPoints = useMemo(() => listRecommendedPackageEntryPoints().filter(
    ({ entrypoint }) => entrypoint.kind === 'skill' || entrypoint.kind === 'workflow',
  ), []);
  const filteredEntryPoints = useMemo(() => {
    const query = skillQuery.trim().toLocaleLowerCase();
    return query
      ? entrypoints.filter((registration) =>
          `${registration.entrypoint.name} ${registration.entrypoint.description} ${entryPointDisplayName(registration, t)} ${entryPointDisplayDescription(registration, t)}`
            .toLocaleLowerCase()
            .includes(query))
      : entrypoints;
  }, [entrypoints, skillQuery, t]);
  const filteredSkills = filteredEntryPoints.filter(({ entrypoint }) => entrypoint.kind === 'skill');
  const filteredWorkflows = filteredEntryPoints.filter(({ entrypoint }) => entrypoint.kind === 'workflow');

  useDismissiblePopover({
    active: skillDockVisible && skillLibraryOpen,
    onDismiss: () => setSkillLibraryOpen(false),
    rootRef: skillDockRef,
  });

  return (
    <>
      {skillDockVisible ? (
        <section ref={skillDockRef} className="skill-dock" aria-label={t('skillDock.title')}>
          <span className="skill-dock-label"><Sparkles size={14} />{t('skillDock.recommended')}</span>
          {recommendedEntryPoints.map((registration) => (
            <button
              key={registration.entrypoint.entrypointId}
              type="button"
              className="skill-dock-card"
              data-entrypoint-id={registration.entrypoint.entrypointId}
              data-package-id={registration.packageLock.packageId}
              onClick={() => {
                onInvokeEntryPoint?.(registration.entrypoint.entrypointId);
                setSkillLibraryOpen(false);
              }}
            >
              <strong>{entryPointDisplayName(registration, t)}</strong>
              <span>{entryPointDisplayDescription(registration, t)}</span>
            </button>
          ))}
          <button
            type="button"
            className="skill-dock-more"
            aria-controls="skill-library-popover"
            aria-expanded={skillLibraryOpen}
            onClick={() => setSkillLibraryOpen((open) => !open)}
          >
            <BookOpen size={15} />{t('skillDock.more')}
          </button>
          {skillLibraryOpen ? (
            <div id="skill-library-popover" className="skill-library-popover" role="dialog" aria-label={t('skillDock.library')}>
              <header><strong>{t('skillDock.library')}</strong></header>
              <label className="skill-library-search">
                <Search size={15} />
                <input value={skillQuery} placeholder={t('skillDock.search')} onChange={(event) => setSkillQuery(event.target.value)} />
              </label>
              <div className="skill-library-list">
                {filteredWorkflows.length > 0 ? (
                  <div className="skill-library-section-label">{t('skillDock.workflowCategory')}</div>
                ) : null}
                {filteredWorkflows.map((registration) => (
                  <button
                    key={registration.entrypoint.entrypointId}
                    type="button"
                    data-entrypoint-id={registration.entrypoint.entrypointId}
                    data-package-id={registration.packageLock.packageId}
                    onClick={() => { onInvokeEntryPoint?.(registration.entrypoint.entrypointId); setSkillLibraryOpen(false); }}
                  >
                    <strong>{entryPointDisplayName(registration, t)}</strong>
                    <span>{t('skillDock.workflowBadge')} · {entryPointDisplayDescription(registration, t)}</span>
                  </button>
                ))}
                {filteredSkills.length > 0 ? (
                  <div className="skill-library-section-label">{t('skillDock.skillCategory')}</div>
                ) : null}
                {filteredSkills.map((registration) => (
                  <button
                    key={registration.entrypoint.entrypointId}
                    type="button"
                    data-entrypoint-id={registration.entrypoint.entrypointId}
                    data-package-id={registration.packageLock.packageId}
                    onClick={() => { onInvokeEntryPoint?.(registration.entrypoint.entrypointId); setSkillLibraryOpen(false); }}
                  >
                    <strong>{entryPointDisplayName(registration, t)}</strong>
                    <span>{entryPointDisplayDescription(registration, t)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      <nav className="floating-toolbar" aria-label={t('canvas.tools')}>
      <ToolButton
        isPressed={activeTool === 'select'}
        label={t('toolbar.selectTool')}
        onClick={() => onSetActiveTool('select')}
      >
        <MousePointer2 size={18} />
      </ToolButton>
      <ToolButton
        isPressed={activeTool === 'pan'}
        label={t('toolbar.panTool')}
        onClick={() => onSetActiveTool('pan')}
      >
        <Hand size={18} />
      </ToolButton>
      <div className="toolbar-divider" />
      <ToolbarMenu icon={<Shapes size={18} />} label={t('toolbar.basicElements')}>
        <MenuItem icon={<FileText size={15} />} label={t('toolbar.addText')} onClick={() => onAddBlock('text')} />
        <MenuItem icon={<ImageIcon size={15} />} label={t('toolbar.addImage')} onClick={() => onAddBlock('image')} />
        <MenuItem icon={<Video size={15} />} label={t('toolbar.addVideo')} onClick={() => onAddBlock('video')} />
        <MenuItem icon={<Play size={15} />} label={t('toolbar.addOperation')} onClick={() => onAddBlock('operation')} />
      </ToolbarMenu>
      <ToolbarMenu icon={<Sparkles size={18} />} label={t('toolbar.generation')}>
        <MenuItem icon={<Sparkles size={15} />} label={t('toolbar.textToImage')} onClick={onCreateTextToImage} />
        <MenuItem icon={<ImageIcon size={15} />} label={t('toolbar.imageToImage')} onClick={onCreateImageToImage} />
        <MenuItem disabled icon={<ImageIcon size={15} />} label={t('toolbar.multiImageToImage')} />
        <MenuItem disabled icon={<Sparkles size={15} />} label={t('toolbar.styleTransfer')} />
        <MenuItem icon={<FileText size={15} />} label={t('toolbar.textToVideo')} onClick={() => onAddBlock('video')} />
        <MenuItem icon={<ImageIcon size={15} />} label={t('toolbar.imageToVideo')} onClick={() => onAddBlock('video')} />
        <MenuItem icon={<Clapperboard size={15} />} label={t('toolbar.firstLastFrameVideo')} onClick={() => onAddBlock('video')} />
      </ToolbarMenu>
      <div className="toolbar-divider" />
      <ToolButton isPressed={activeTool === 'group'} label={t('toolbar.addGroup')} onClick={() => onAddBlock('group')}>
        <Layers3 size={18} />
      </ToolButton>
      </nav>
    </>
  );
}

function entryPointDisplayName(
  registration: RegisteredPackageEntryPoint,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const { entrypoint } = registration;
  if (entrypoint.kind === 'skill') return t(skillUiDefinitionFor(entrypoint.ref.skillId).nameKey);
  if (entrypoint.kind === 'workflow') return t(workflowUiDefinitionFor(entrypoint.ref.workflowDefinitionId).nameKey);
  return entrypoint.name;
}

function entryPointDisplayDescription(
  registration: RegisteredPackageEntryPoint,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const { entrypoint } = registration;
  if (entrypoint.kind === 'skill') return t(skillUiDefinitionFor(entrypoint.ref.skillId).descriptionKey);
  if (entrypoint.kind === 'workflow') return t(workflowUiDefinitionFor(entrypoint.ref.workflowDefinitionId).descriptionKey);
  return entrypoint.description;
}

function ToolbarMenu({
  children,
  icon,
  label,
}: {
  children: ReactElement | ReactElement[];
  icon: ReactElement;
  label: string;
}): ReactElement {
  return (
    <div className="floating-toolbar-menu">
      <button type="button" className="floating-toolbar-menu-trigger" aria-label={label}>
        {icon}
      </button>
      <div className="floating-toolbar-submenu" role="menu" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function MenuItem({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactElement;
  label: string;
  onClick?: () => void;
}): ReactElement {
  return (
    <button type="button" className="floating-toolbar-menu-item" disabled={disabled} role="menuitem" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ToolButton({
  children,
  disabled,
  isPressed,
  label,
  onClick,
}: {
  children: ReactElement;
  disabled?: boolean;
  isPressed?: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <TooltipIconButton disabled={disabled} isPressed={isPressed} label={label} onClick={onClick}>
      {children}
    </TooltipIconButton>
  );
}
