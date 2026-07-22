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
  listRecommendedSkills,
  listSkills,
  skillUiDefinitionFor,
  type RetakeSkillDefinition,
} from '../core/skillRegistry';
import type { BlockType } from '../core/types';
import {
  listWorkflows,
  workflowUiDefinitionFor,
  type WorkflowDefinition,
} from '../core/workflowRegistry';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export type CanvasTool = 'group' | 'select' | 'pan';

interface FloatingToolbarProps {
  activeTool: CanvasTool;
  onAddBlock: (type: Extract<BlockType, 'group' | 'image' | 'operation' | 'text' | 'video'>) => void;
  onCreateImageToImage: () => void;
  onCreateSkill?: (skillId: string) => void;
  onCreateWorkflow?: (workflowId: string) => void;
  onCreateTextToImage: () => void;
  onSetActiveTool: (tool: CanvasTool) => void;
}

export function FloatingToolbar({
  activeTool,
  onAddBlock,
  onCreateImageToImage,
  onCreateSkill,
  onCreateWorkflow,
  onCreateTextToImage,
  onSetActiveTool,
}: FloatingToolbarProps): ReactElement {
  const { t } = useI18n();
  const skillDockRef = useRef<HTMLElement>(null);
  const [skillLibraryOpen, setSkillLibraryOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const skills = useMemo(() => listSkills(), []);
  const workflows = useMemo(() => listWorkflows(), []);
  const recommendedSkills = useMemo(() => listRecommendedSkills(), []);
  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLocaleLowerCase();
    return query
      ? skills.filter((skill) => {
          const ui = skillUiDefinitionFor(skill.skillId);
          return `${skill.name} ${skill.description} ${t(ui.nameKey)} ${t(ui.descriptionKey)}`
            .toLocaleLowerCase()
            .includes(query);
        })
      : skills;
  }, [skillQuery, skills, t]);
  const filteredWorkflows = useMemo(() => {
    const query = skillQuery.trim().toLocaleLowerCase();
    return query
      ? workflows.filter((workflow) => {
          const ui = workflowUiDefinitionFor(workflow.workflowId);
          return `${workflow.name} ${workflow.description} ${t(ui.nameKey)} ${t(ui.descriptionKey)}`
            .toLocaleLowerCase()
            .includes(query);
        })
      : workflows;
  }, [skillQuery, t, workflows]);

  useDismissiblePopover({
    active: skillLibraryOpen,
    onDismiss: () => setSkillLibraryOpen(false),
    rootRef: skillDockRef,
  });

  return (
    <>
      <section ref={skillDockRef} className="skill-dock" aria-label={t('skillDock.title')}>
        <span className="skill-dock-label"><Sparkles size={14} />{t('skillDock.recommended')}</span>
        {recommendedSkills.map((skill) => (
          <button
            key={skill.skillId}
            type="button"
            className="skill-dock-card"
            onClick={() => {
              onCreateSkill?.(skill.skillId);
              setSkillLibraryOpen(false);
            }}
          >
            <strong>{skillDisplayName(skill, t)}</strong>
            <span>{skillDisplayDescription(skill, t)}</span>
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
              {filteredWorkflows.map((workflow) => (
                <button
                  key={workflow.workflowId}
                  type="button"
                  onClick={() => { onCreateWorkflow?.(workflow.workflowId); setSkillLibraryOpen(false); }}
                >
                  <strong>{workflowDisplayName(workflow, t)}</strong>
                  <span>{t('skillDock.workflowBadge')} · {workflowDisplayDescription(workflow, t)}</span>
                </button>
              ))}
              {filteredSkills.length > 0 ? (
                <div className="skill-library-section-label">{t('skillDock.skillCategory')}</div>
              ) : null}
              {filteredSkills.map((skill) => (
                <button key={skill.skillId} type="button" onClick={() => { onCreateSkill?.(skill.skillId); setSkillLibraryOpen(false); }}>
                  <strong>{skillDisplayName(skill, t)}</strong>
                  <span>{skillDisplayDescription(skill, t)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
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

function skillDisplayName(skill: RetakeSkillDefinition, t: ReturnType<typeof useI18n>['t']): string {
  return t(skillUiDefinitionFor(skill.skillId).nameKey);
}

function skillDisplayDescription(skill: RetakeSkillDefinition, t: ReturnType<typeof useI18n>['t']): string {
  return t(skillUiDefinitionFor(skill.skillId).descriptionKey);
}

function workflowDisplayName(workflow: WorkflowDefinition, t: ReturnType<typeof useI18n>['t']): string {
  return t(workflowUiDefinitionFor(workflow.workflowId).nameKey);
}

function workflowDisplayDescription(workflow: WorkflowDefinition, t: ReturnType<typeof useI18n>['t']): string {
  return t(workflowUiDefinitionFor(workflow.workflowId).descriptionKey);
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
