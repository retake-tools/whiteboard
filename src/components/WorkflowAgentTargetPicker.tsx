import type { ReactElement } from 'react';
import type {
  PackageEntrypointAgentLaunchTarget,
} from '../core/agentSessionContracts';
import { useI18n } from '../i18n';

type WorkflowTarget = Exclude<PackageEntrypointAgentLaunchTarget, { kind: 'capability' }>;

export interface WorkflowAgentTargetDefinition {
  gates: Array<{ gateId: string; name?: string }>;
  outputSlots: Array<{ slotId: string }>;
  stages?: Array<{ name: string; stageId: string }>;
  steps: Array<{ stepId: string }>;
}

export function WorkflowAgentTargetPicker({
  definition,
  onChange,
  value,
}: {
  definition: WorkflowAgentTargetDefinition;
  onChange: (target: WorkflowTarget) => void;
  value: WorkflowTarget;
}): ReactElement {
  const { t } = useI18n();
  const selectedKey = workflowTargetKey(value);
  const selectedGate = value.kind === 'workflow_slice' && value.until.kind === 'gate'
    ? value.until
    : undefined;

  return (
    <>
      <label>
        <span>{t('agentRuntime.executionRange')}</span>
        <select
          value={selectedKey}
          onChange={(event) => onChange(targetForKey(definition, event.target.value))}
        >
          <option value="workflow_run">{t('agentRuntime.fullWorkflow')}</option>
          {definition.gates.map((gate) => (
            <option key={`gate:${gate.gateId}`} value={`gate:${gate.gateId}`}>
              {t('agentRuntime.untilGate')}: {gate.name ?? gate.gateId}
            </option>
          ))}
          {(definition.stages ?? []).map((stage) => (
            <option key={`stage:${stage.stageId}`} value={`stage:${stage.stageId}`}>
              {t('agentRuntime.untilStage')}: {stage.name}
            </option>
          ))}
          {definition.steps.map((step) => (
            <option key={`step:${step.stepId}`} value={`step:${step.stepId}`}>
              {t('agentRuntime.untilStep')}: {step.stepId}
            </option>
          ))}
          {definition.outputSlots.map((output) => (
            <option key={`artifact:${output.slotId}`} value={`artifact:${output.slotId}`}>
              {t('agentRuntime.untilArtifact')}: {output.slotId}
            </option>
          ))}
        </select>
      </label>
      {selectedGate ? (
        <label>
          <span>{t('agentRuntime.gateCompletion')}</span>
          <select
            value={selectedGate.completion}
            onChange={(event) => onChange({
              kind: 'workflow_slice',
              until: {
                ...selectedGate,
                completion: event.target.value as 'arrived' | 'passed',
              },
            })}
          >
            <option value="arrived">{t('agentRuntime.gateCompletion.arrived')}</option>
            <option value="passed">{t('agentRuntime.gateCompletion.passed')}</option>
          </select>
          <small>
            {selectedGate.completion === 'arrived'
              ? t('agentRuntime.gateCompletion.arrivedDescription')
              : t('agentRuntime.gateCompletion.passedDescription')}
          </small>
        </label>
      ) : null}
    </>
  );
}

function workflowTargetKey(target: WorkflowTarget): string {
  if (target.kind === 'workflow_run') return target.kind;
  const until = target.until;
  if (until.kind === 'artifact') return `artifact:${until.workflowOutputSlotId}`;
  if (until.kind === 'stage') return `stage:${until.stageId}`;
  if (until.kind === 'gate') return `gate:${until.gateId}`;
  return `step:${until.stepId}`;
}

function targetForKey(definition: WorkflowAgentTargetDefinition, key: string): WorkflowTarget {
  if (key === 'workflow_run') return { kind: 'workflow_run' };
  const separator = key.indexOf(':');
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (kind === 'step' && definition.steps.some((step) => step.stepId === id)) {
    return { kind: 'workflow_slice', until: { kind: 'step', stepId: id } };
  }
  if (kind === 'artifact' && definition.outputSlots.some((output) => output.slotId === id)) {
    return {
      kind: 'workflow_slice',
      until: { kind: 'artifact', workflowOutputSlotId: id },
    };
  }
  if (kind === 'stage' && (definition.stages ?? []).some((stage) => stage.stageId === id)) {
    return { kind: 'workflow_slice', until: { kind: 'stage', stageId: id } };
  }
  if (kind === 'gate' && definition.gates.some((gate) => gate.gateId === id)) {
    return {
      kind: 'workflow_slice',
      until: { completion: 'arrived', gateId: id, kind: 'gate' },
    };
  }
  throw new Error(`Workflow Agent target is not in the Definition: ${key}`);
}
