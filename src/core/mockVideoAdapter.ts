import {
  assertValidCapabilityExecutionRequest,
  validateAdapterDefinition,
  type AdapterDefinition,
  type CapabilityAdapterExecutionResult,
  type CapabilityAdapterPort,
  type CapabilityExecutionRequest,
} from './capabilityContracts';
import { capabilityDefinitionFor } from './capabilityRegistry';

export class MockVideoAdapter implements CapabilityAdapterPort {
  readonly adapterId = 'retake.video.mock';

  async validate(request: CapabilityExecutionRequest, definition: AdapterDefinition): Promise<void> {
    const adapterIssues = validateAdapterDefinition(definition);
    if (adapterIssues.length > 0) throw new Error(adapterIssues.map((issue) => issue.message).join('; '));
    if (definition.adapterId !== this.adapterId || definition.routeKind !== 'local') {
      throw new Error(`MockVideoAdapter cannot execute adapter ${definition.adapterId}.`);
    }
    if (!definition.supportedCapabilityIds.includes(request.capabilityLock.capabilityId)) {
      throw new Error(`Adapter ${definition.adapterId} does not support ${request.capabilityLock.capabilityId}.`);
    }
    assertValidCapabilityExecutionRequest(request, capabilityDefinitionFor(request.capabilityLock.capabilityId));
    const outputCount = numberParameter(request, 'outputCount');
    const durationSeconds = numberParameter(request, 'durationSeconds');
    if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 4) {
      throw new Error('Mock video outputCount must be an integer from 1 to 4.');
    }
    if (durationSeconds < 4 || durationSeconds > 15) {
      throw new Error('Mock video durationSeconds must be from 4 to 15.');
    }
  }

  async execute(input: Parameters<CapabilityAdapterPort['execute']>[0]): Promise<CapabilityAdapterExecutionResult> {
    const outputCount = numberParameter(input.request, 'outputCount');
    input.emitProgress({ phase: 'generating', completed: 0, total: outputCount });
    const producedFiles = Array.from({ length: outputCount }, (_, index) => ({
      slotId: 'videos',
      sourcePath: `local-mock://video/${input.execution.executionId}/${index + 1}.mp4`,
      kind: 'video' as const,
      mimeType: 'video/mp4',
      duration: numberParameter(input.request, 'durationSeconds'),
    }));
    input.emitProgress({ phase: 'completed', completed: outputCount, total: outputCount });
    return {
      producedFiles,
      providerMetadata: { mockOnly: true },
      usage: { unit: 'mock_video', quantity: outputCount },
    };
  }

  async cancel(_executionId: string): Promise<void> {}
}

function numberParameter(request: CapabilityExecutionRequest, key: string): number {
  const value = request.parameters[key];
  return typeof value === 'number' ? value : Number.NaN;
}
