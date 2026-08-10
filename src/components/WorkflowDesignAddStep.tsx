import { ArrowRight, Plus, Search, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { listAuthorableCapabilityDefinitions } from '../core/capabilityRegistry';
import { listSkills, type RetakeSkillDefinition } from '../core/skillRegistry';
import {
  addWorkflowAuthoringStepAtContext,
  type WorkflowAuthoringStepInsertionContextV1,
} from '../core/workflowAuthoringGraph';
import type { CapabilityDefinition } from '../core/capabilityContracts';
import type { WorkflowDefinition } from '../core/workflowRegistry';
import { useI18n } from '../i18n';

interface AuthorableCapabilityOption {
  capability: CapabilityDefinition;
  skills: RetakeSkillDefinition[];
}

export function WorkflowDesignAddStep({
  context,
  definition,
  onAdd,
  onClose,
}: {
  context: WorkflowAuthoringStepInsertionContextV1;
  definition: WorkflowDefinition;
  onAdd: (definition: WorkflowDefinition, stepId: string) => void;
  onClose: () => void;
}): ReactElement {
  const { t } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const options = useMemo<AuthorableCapabilityOption[]>(() => {
    const skills = listSkills();
    return listAuthorableCapabilityDefinitions().flatMap((capability) => {
      const compatible = skills
        .filter((skill) => skill.capabilityBindings.some(
          (binding) => binding.capabilityId === capability.capabilityId,
        ))
        .sort((left, right) => left.name.localeCompare(right.name));
      return compatible.length > 0 ? [{ capability, skills: compatible }] : [];
    });
  }, []);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter(({ capability, skills }) => [
      capability.displayName,
      capability.capabilityId,
      capability.category,
      ...capability.inputSlots.flatMap((slot) => [slot.slotId, slot.semanticRole]),
      ...capability.outputSlots.flatMap((slot) => [slot.slotId, slot.semanticRole]),
      ...skills.flatMap((skill) => [skill.name, skill.description]),
    ].some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [options, query]);
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, AuthorableCapabilityOption[]>();
    for (const option of filteredOptions) {
      const category = option.capability.category || 'other';
      groups.set(category, [...(groups.get(category) ?? []), option]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [filteredOptions]);

  useEffect(() => {
    searchRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape, { capture: true });
    return () => window.removeEventListener('keydown', closeOnEscape, { capture: true });
  }, [onClose]);

  const addCapability = (option: AuthorableCapabilityOption) => {
    const existingSkillId = definition.steps.find(
      (step) => step.capabilityLock.capabilityId === option.capability.capabilityId,
    )?.skillLock.skillId;
    const skill = option.skills.find((candidate) => candidate.skillId === existingSkillId)
      ?? option.skills[0];
    if (!skill) return;
    const stepId = nextStepId(definition, option.capability.capabilityId);
    const sourceStepId = context.kind === 'first' ? undefined : context.sourceStepId;
    const stageId = definition.steps.find((step) => step.stepId === sourceStepId)?.stageId
      ?? definition.stages?.[0]?.stageId
      ?? definition.steps[0]?.stageId
      ?? 'default';
    onAdd(addWorkflowAuthoringStepAtContext({
      capability: option.capability,
      context,
      definition,
      skill,
      stageId,
      stepId,
    }), stepId);
    onClose();
  };

  return (
    <section
      className="workflow-design-step-creator nodrag nopan"
      aria-label={t('workflowAuthoring.chooseCapability')}
    >
      <header>
        <div>
          <strong>{t('workflowAuthoring.chooseCapability')}</strong>
          <small>{contextLabel(context, t)}</small>
        </div>
        <button
          type="button"
          aria-label={t('workflowAuthoring.closeStepCreator')}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <label className="workflow-design-step-search">
        <Search size={14} />
        <input
          ref={searchRef}
          name="workflow-capability-search"
          type="search"
          value={query}
          placeholder={t('workflowAuthoring.searchCapabilities')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="workflow-design-capability-list">
        {groupedOptions.length > 0 ? groupedOptions.map(([category, categoryOptions]) => (
          <section key={category}>
            <header>{category}</header>
            {categoryOptions.map((option) => (
              <button
                key={option.capability.capabilityId}
                type="button"
                onClick={() => addCapability(option)}
              >
                <span className="workflow-design-capability-icon"><Plus size={14} /></span>
                <span>
                  <strong>{option.capability.displayName}</strong>
                  <small>{option.capability.capabilityId}</small>
                  <em>
                    {option.capability.inputSlots.length} {t('workflowAuthoring.capabilityInputs')}
                    <ArrowRight size={11} />
                    {option.capability.outputSlots.map((slot) => (
                      slot.artifactType ?? slot.dataType
                    )).join(', ')}
                  </em>
                </span>
                <small>{option.skills.length} {t('workflowAuthoring.compatibleSkills')}</small>
              </button>
            ))}
          </section>
        )) : (
          <p>{t('workflowAuthoring.noCapabilities')}</p>
        )}
      </div>
    </section>
  );
}

function contextLabel(
  context: WorkflowAuthoringStepInsertionContextV1,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (context.kind === 'first') return t('workflowAuthoring.addFirstStep');
  if (context.kind === 'insert_edge') {
    return `${t('workflowAuthoring.insertOnEdge')} · ${context.sourceStepId} → ${context.targetStepId}`;
  }
  return `${t('workflowAuthoring.insertAfterStep')} · ${context.sourceStepId}`;
}

function nextStepId(definition: WorkflowDefinition, capabilityId: string): string {
  const base = capabilityId.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'step';
  let suffix = 1;
  let stepId = `${base}_${suffix}`;
  const existing = new Set(definition.steps.map((step) => step.stepId));
  while (existing.has(stepId)) {
    suffix += 1;
    stepId = `${base}_${suffix}`;
  }
  return stepId;
}
