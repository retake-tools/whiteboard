import {
  Bot,
  Clapperboard,
  FileText,
  GitBranch,
  ImageIcon,
  Play,
  Plus,
  Sparkles,
  Video,
} from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import {
  currentInstalledRuntimeRegistryRevision,
  subscribeInstalledRuntimeRegistry,
} from '../core/installedRuntimeRegistry';
import { packageComposerDependencyIssue } from '../core/packageComposer';
import { listPackageEntryPoints, type RegisteredPackageEntryPoint } from '../core/packageRegistry';
import type { BlockType } from '../core/types';
import { resolvedWorkflowUiDefinitionFor } from '../core/workflowRegistry';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';

interface WorkspaceCreateMenuProps {
  onAddBlock: (type: Extract<BlockType, 'image' | 'operation' | 'text' | 'video'>) => void;
  onCreateImageToImage: () => void;
  onCreateTextToImage: () => void;
  onOpenAgent: () => void;
  onOpenWorkflow: (entrypointId: string) => void;
}

export function WorkspaceCreateMenu({
  onAddBlock,
  onCreateImageToImage,
  onCreateTextToImage,
  onOpenAgent,
  onOpenWorkflow,
}: WorkspaceCreateMenuProps): ReactElement {
  const { locale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const registryRevision = useSyncExternalStore(
    subscribeInstalledRuntimeRegistry,
    currentInstalledRuntimeRegistryRevision,
    currentInstalledRuntimeRegistryRevision,
  );
  const workflows = useMemo(() => {
    void registryRevision;
    return listPackageEntryPoints().filter(
      (registration) => registration.entrypoint.kind === 'workflow',
    );
  }, [registryRevision]);

  useDismissiblePopover({
    active: isOpen,
    focusOnEscapeRef: triggerRef,
    onDismiss: () => setIsOpen(false),
    rootRef,
  });

  function run(action: () => void): void {
    setIsOpen(false);
    action();
  }

  return (
    <div ref={rootRef} className="workspace-create-menu">
      <button
        type="button"
        ref={triggerRef}
        className="workspace-create-trigger"
        aria-controls="workspace-create-menu-popover"
        aria-expanded={isOpen}
        aria-label={t('createMenu.open')}
        onClick={() => setIsOpen((current) => !current)}
      >
        <Plus size={17} strokeWidth={1.75} />
      </button>
      {isOpen ? (
        <div
          id="workspace-create-menu-popover"
          className="workspace-create-popover"
          role="dialog"
          aria-label={t('createMenu.title')}
        >
          <CreateSection label={t('createMenu.blocks')}>
            <CreateAction icon={<FileText size={16} />} label={t('toolbar.addText')} onClick={() => run(() => onAddBlock('text'))} />
            <CreateAction icon={<ImageIcon size={16} />} label={t('toolbar.addImage')} onClick={() => run(() => onAddBlock('image'))} />
            <CreateAction icon={<Video size={16} />} label={t('toolbar.addVideo')} onClick={() => run(() => onAddBlock('video'))} />
            <CreateAction icon={<Play size={16} />} label={t('toolbar.addOperation')} onClick={() => run(() => onAddBlock('operation'))} />
          </CreateSection>
          <CreateSection label={t('createMenu.generate')}>
            <CreateAction icon={<Sparkles size={16} />} label={t('toolbar.textToImage')} onClick={() => run(onCreateTextToImage)} />
            <CreateAction icon={<ImageIcon size={16} />} label={t('toolbar.imageToImage')} onClick={() => run(onCreateImageToImage)} />
            <CreateAction icon={<Video size={16} />} label={t('toolbar.textToVideo')} onClick={() => run(() => onAddBlock('video'))} />
            <CreateAction icon={<ImageIcon size={16} />} label={t('toolbar.imageToVideo')} onClick={() => run(() => onAddBlock('video'))} />
            <CreateAction icon={<Clapperboard size={16} />} label={t('toolbar.firstLastFrameVideo')} onClick={() => run(() => onAddBlock('video'))} />
          </CreateSection>
          <CreateSection label={t('createMenu.automate')}>
            <CreateAction icon={<Bot size={16} />} label={t('createMenu.agent')} onClick={() => run(onOpenAgent)} />
            {workflows.map((registration) => (
              <WorkflowCreateAction
                key={registration.entrypoint.entrypointId}
                registration={registration}
                label={workflowLabel(registration, locale)}
                unavailableLabel={t('createMenu.capabilityUnavailable')}
                onClick={() => run(() => onOpenWorkflow(registration.entrypoint.entrypointId))}
              />
            ))}
            {workflows.length === 0 ? (
              <p className="workspace-create-empty">{t('createMenu.noWorkflows')}</p>
            ) : null}
          </CreateSection>
        </div>
      ) : null}
    </div>
  );
}

function CreateSection({ children, label }: { children: ReactNode; label: string }): ReactElement {
  return (
    <section className="workspace-create-section">
      <h2>{label}</h2>
      <div>{children}</div>
    </section>
  );
}

function CreateAction({
  disabled,
  icon,
  label,
  note,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactElement;
  label: string;
  note?: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className="workspace-create-action" disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {note ? <small>{note}</small> : null}
    </button>
  );
}

function WorkflowCreateAction({
  label,
  onClick,
  registration,
  unavailableLabel,
}: {
  label: string;
  onClick: () => void;
  registration: RegisteredPackageEntryPoint;
  unavailableLabel: string;
}): ReactElement {
  const unavailable = Boolean(packageComposerDependencyIssue(registration.entrypoint.entrypointId));
  return (
    <CreateAction
      disabled={unavailable}
      icon={<GitBranch size={16} />}
      label={label}
      note={unavailable ? unavailableLabel : undefined}
      onClick={onClick}
    />
  );
}

function workflowLabel(registration: RegisteredPackageEntryPoint, locale: string): string {
  if (registration.entrypoint.kind !== 'workflow') return registration.entrypoint.name;
  try {
    return resolvedWorkflowUiDefinitionFor(
      registration.entrypoint.ref.workflowDefinitionId,
      locale,
    ).name;
  } catch {
    return registration.entrypoint.name;
  }
}
