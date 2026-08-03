import { Trash2 } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import {
  compatibleSkillsForWorkflowStep,
  removeWorkflowAuthoringStep,
  workflowAuthoringIssuesForStep,
  workflowBindingCandidates,
  workflowBindingSourceValue,
  workflowStepRemovalIssues,
} from '../core/workflowAuthoringGraph';
import type {
  WorkflowBindingSource,
  WorkflowCapabilityStepDefinition,
  WorkflowDefinition,
} from '../core/workflowRegistry';
import { useI18n } from '../i18n';

export function WorkflowDesignStepInspector({
  definition,
  issues,
  onChange,
  onRemove,
  stepId,
}: {
  definition: WorkflowDefinition;
  issues: string[];
  onChange: (definition: WorkflowDefinition) => void;
  onRemove: (stepId: string) => void;
  stepId: string;
}): ReactElement | null {
  const { t } = useI18n();
  const step = definition.steps.find((candidate) => candidate.stepId === stepId);
  if (!step) return null;
  const currentStep: WorkflowCapabilityStepDefinition = step;
  const capability = capabilityDefinitionFor(currentStep.capabilityLock.capabilityId);
  const compatibleSkills = compatibleSkillsForWorkflowStep(currentStep);
  const currentSkill = compatibleSkills.find(
    (skill) => skill.skillId === currentStep.skillLock.skillId,
  );
  const stepIssues = workflowAuthoringIssuesForStep(issues, stepId);
  const removalIssues = workflowStepRemovalIssues(definition, stepId);
  const updateStep = (
    update: (current: WorkflowCapabilityStepDefinition) => WorkflowCapabilityStepDefinition,
  ) => onChange({
    ...definition,
    steps: definition.steps.map((candidate) => (
      candidate.stepId === stepId ? update(candidate) : candidate
    )),
  });
  const removeStep = () => {
    if (removalIssues.length > 0) return;
    if (!window.confirm(t('workflowAuthoring.removeStepConfirm'))) return;
    onChange(removeWorkflowAuthoringStep(definition, stepId));
    onRemove(stepId);
  };

  return (
    <section className="workflow-design-step-inspector">
      <InspectorSection title={t('workflowInspector.overview')}>
        <InspectorFact label={t('workflowInspector.stepId')} value={currentStep.stepId} />
        <InspectorFact
          label={t('workflowInspector.capabilityLock')}
          value={`${capability.displayName}\n${currentStep.capabilityLock.capabilityId} · ${currentStep.capabilityLock.version}\n${currentStep.capabilityLock.definitionHash}`}
        />
        {definition.stages && definition.stages.length > 0 ? (
          <label>
            <span>{t('workflowInspector.stage')}</span>
            <select
              name={`workflow-step-${stepId}-stage`}
              value={currentStep.stageId}
              onChange={(event) => updateStep((current) => ({
                ...current,
                stageId: event.target.value,
              }))}
            >
              {definition.stages.map((stage) => (
                <option key={stage.stageId} value={stage.stageId}>{stage.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <InspectorFact label={t('workflowInspector.stage')} value={currentStep.stageId} />
        )}
        <label className="workflow-design-checkbox">
          <input
            name={`workflow-step-${stepId}-optional`}
            type="checkbox"
            checked={currentStep.optional}
            onChange={(event) => updateStep((current) => ({
              ...current,
              optional: event.target.checked,
            }))}
          />
          <span>{t('workflowAuthoring.optional')}</span>
        </label>
      </InspectorSection>

      <InspectorSection title={t('workflowInspector.inputs')}>
        {capability.inputSlots.length > 0 ? capability.inputSlots.map((slot) => {
          const candidates = workflowBindingCandidates({
            definition,
            inputSlotId: slot.slotId,
            stepId,
          });
          const current = currentStep.inputBindings.find(
            (binding) => binding.inputSlotId === slot.slotId,
          );
          const currentCandidate = current
            ? candidates.find((candidate) => candidate.value === workflowBindingSourceValue(current.source))
            : undefined;
          return (
            <label key={slot.slotId} className="workflow-step-binding-field">
              <span>{slot.semanticRole}{slot.required ? ' *' : ''}</span>
              <small>{slot.slotId} · {slot.dataTypes.join(' / ')}</small>
              <select
                name={`workflow-step-${stepId}-binding-${slot.slotId}`}
                value={current ? workflowBindingSourceValue(current.source) : ''}
                onChange={(event) => {
                  const source = candidates.find(
                    (candidate) => candidate.value === event.target.value,
                  )?.source;
                  updateStep((candidate) => ({
                    ...candidate,
                    inputBindings: source
                      ? [
                        ...candidate.inputBindings.filter(
                          (binding) => binding.inputSlotId !== slot.slotId,
                        ),
                        {
                          inputSlotId: slot.slotId,
                          source: structuredClone(source) as WorkflowBindingSource,
                        },
                      ]
                      : candidate.inputBindings.filter(
                        (binding) => binding.inputSlotId !== slot.slotId,
                      ),
                  }));
                }}
              >
                <option value="">—</option>
                {candidates.map((candidate) => (
                  <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
                ))}
              </select>
              <small className="workflow-step-binding-source">
                {currentCandidate?.label ?? t('workflowInspector.noInputs')}
              </small>
            </label>
          );
        }) : <p>{t('workflowInspector.noInputs')}</p>}
      </InspectorSection>

      <InspectorSection title={t('workflowInspector.behavior')}>
        <label>
          <span>{t('workflowAuthoring.skill')}</span>
          <select
            name={`workflow-step-${stepId}-skill`}
            value={currentStep.skillLock.skillId}
            disabled={compatibleSkills.length === 0}
            onChange={(event) => {
              const skill = compatibleSkills.find(
                (candidate) => candidate.skillId === event.target.value,
              );
              if (skill) updateStep((current) => ({
                ...current,
                skillLock: {
                  definitionHash: skill.definitionHash,
                  skillId: skill.skillId,
                  version: skill.version,
                },
              }));
            }}
          >
            {compatibleSkills.length === 0 ? (
              <option>{t('workflowAuthoring.noCompatibleSkills')}</option>
            ) : compatibleSkills.map((skill) => (
              <option key={skill.skillId} value={skill.skillId}>{skill.name}</option>
            ))}
          </select>
        </label>
        <InspectorFact
          label={t('workflowInspector.skillLock')}
          value={`${currentSkill?.description ?? currentStep.skillLock.skillId}\n${currentStep.skillLock.skillId} · ${currentStep.skillLock.version}\n${currentStep.skillLock.definitionHash}`}
        />
      </InspectorSection>

      <InspectorSection title={t('workflowInspector.outputs')}>
        {currentStep.outputSlots.length > 0 ? (
          <ul className="workflow-step-contract-list">
            {currentStep.outputSlots.map((outputSlotId) => {
              const slot = capability.outputSlots.find(
                (candidate) => candidate.slotId === outputSlotId,
              );
              return (
                <li key={outputSlotId}>
                  <strong>{slot?.semanticRole ?? outputSlotId}</strong>
                  <small>{outputSlotId} · {slot?.artifactType ?? slot?.dataType ?? 'unknown'}</small>
                </li>
              );
            })}
          </ul>
        ) : <p>{t('workflowInspector.noOutputs')}</p>}
      </InspectorSection>

      <InspectorSection title={t('workflowInspector.validation')}>
        {stepIssues.length > 0 ? (
          <ul className="workflow-design-issues">
            {stepIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        ) : <p>{t('workflowInspector.noIssues')}</p>}
        {removalIssues.length > 0 ? (
          <ul className="workflow-design-removal-issues">
            {removalIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        ) : null}
        <button
          className="workflow-design-remove-step"
          type="button"
          disabled={removalIssues.length > 0}
          onClick={removeStep}
        >
          <Trash2 size={14} />{t('workflowAuthoring.removeStep')}
        </button>
      </InspectorSection>
    </section>
  );
}

function InspectorSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}): ReactElement {
  return (
    <section className="workflow-step-inspector-section">
      <header><strong>{title}</strong></header>
      <div>{children}</div>
    </section>
  );
}

function InspectorFact({ label, value }: { label: string; value: string }): ReactElement {
  return <dl><dt>{label}</dt><dd>{value}</dd></dl>;
}
