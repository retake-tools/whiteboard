import {
  DomainVideoGenerationContractError,
  type ProviderExecutionAuthorizationV1,
} from '../src/core/domainVideoGenerationContracts';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import {
  createVideoGenerationExecution,
  type DomainVideoExecutionContext,
  type VideoGenerationInput,
} from '../src/core/videoGeneration';
import { MockVideoAdapter } from '../src/core/mockVideoAdapter';
import { mockVideoAdapterDefinition } from '../src/core/capabilityRegistry';
import { startDreaminaCliVideoGeneration } from './dreamina-cli-video-service';
import { prepareDomainVideoLaunch } from './domain-video-launch-review-service';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { updateVideoResultBlock } from './local-store/execution-store';
import { updateProviderCall } from './local-store/provider-call-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { startSeedanceVideoGeneration } from './seedance-video-service';

export interface StartDomainVideoGenerationInput {
  blockId: string;
  boardId: string;
  projectId: string;
  requestFingerprint: string;
}

export async function authorizeAndStartDomainVideoGeneration(
  input: StartDomainVideoGenerationInput,
): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  if (!input.requestFingerprint) {
    throw new DomainVideoGenerationContractError(
      'generation_video_authorization_required',
      'Confirm the current Domain Video Launch Review before executing.',
    );
  }
  const prepared = await prepareDomainVideoLaunch(input);
  const review = prepared.review;
  if (!review.ready || !review.request || !review.costDisclosure) {
    const issue = review.issues[0];
    throw new DomainVideoGenerationContractError(
      issue?.code ?? 'generation_video_authorization_required',
      issue?.message ?? 'Domain Video Launch Review is not ready.',
    );
  }
  if (review.request.requestFingerprint !== input.requestFingerprint) {
    throw new DomainVideoGenerationContractError(
      'generation_video_authorization_mismatch',
      'Domain Video Launch Review changed. Review and confirm the current request again.',
    );
  }

  const authorization = authorizationFor(review.request, review.costDisclosure, review.route.routeKind);
  const domain: DomainVideoExecutionContext = {
    authorization,
    generationPackageBlockId: prepared.generationPackageBlock.blockId,
    operationBlockId: prepared.operation.blockId,
    providerPrompt: prepared.providerPrompt,
    request: review.request,
  };
  const targetBlockId = prepared.snapshot.edges
    .filter((edge) =>
      edge.kind === 'execution_output'
      && edge.sourceBlockId === prepared.operation.blockId,
    )
    .flatMap((edge) => {
      const block = prepared.snapshot.blocks.find(
        (candidate) => candidate.blockId === edge.targetBlockId && candidate.type === 'video',
      );
      return block ? [block.blockId] : [];
    })[0] ?? '';
  const generationInput: VideoGenerationInput & { projectId: string; boardId: string } = {
    projectId: input.projectId,
    boardId: input.boardId,
    targetBlockId,
    prompt: prepared.providerPrompt,
    durationSeconds: review.request.packageProfile.durationSeconds,
    outputCount: review.request.launchParameters.outputCount,
    aspectRatio: review.request.packageProfile.aspectRatio,
    connectionId: review.request.connectionId,
    domain,
  };

  if (review.request.adapterId === 'retake.video.mock') {
    return executeDurableDomainMock(prepared.snapshot, generationInput);
  }
  if (review.request.adapterId === 'retake.video.dreamina-cli') {
    const started = await startDreaminaCliVideoGeneration(generationInput);
    return { snapshot: started.snapshot, execution: started.execution };
  }
  if (review.request.adapterId === 'retake.video.seedance-modelark') {
    const started = await startSeedanceVideoGeneration(generationInput);
    return { snapshot: started.snapshot, execution: started.execution };
  }
  throw new DomainVideoGenerationContractError(
    'generation_video_adapter_incompatible',
    `Unsupported Domain Video Adapter: ${review.request.adapterId}`,
  );
}

async function executeDurableDomainMock(
  snapshot: BoardSnapshot,
  input: VideoGenerationInput,
): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const run = createVideoGenerationExecution(snapshot, input);
  await saveSnapshot(snapshot);
  const adapter = new MockVideoAdapter();
  await adapter.validate(run.request, mockVideoAdapterDefinition);
  const result = await adapter.execute({
    request: run.request,
    execution: run.execution,
    definition: mockVideoAdapterDefinition,
    signal: new AbortController().signal,
    emitProgress: () => undefined,
  });
  for (let index = 0; index < result.producedFiles.length; index += 1) {
    const file = result.producedFiles[index]!;
    const asset = await createAssetFromDataUrl({
      projectId: run.execution.projectId,
      sourceExecutionId: run.execution.executionId,
      dataUrl: `data:${file.mimeType};base64,AAAA`,
      duration: file.duration,
      fileName: `mock-domain-video-${index + 1}.mp4`,
      kind: 'video',
    });
    await updateVideoResultBlock({
      projectId: run.execution.projectId,
      boardId: run.execution.boardId,
      executionId: run.execution.executionId,
      assetId: asset.assetId,
      resultBlockId: run.execution.outputBlockIds[index],
      title: result.producedFiles.length > 1
        ? `Domain mock result ${index + 1}`
        : 'Domain mock result',
      body: 'Generated by the durable Retake Domain Video mock Adapter.',
    });
    await updateProviderCall({
      projectId: run.execution.projectId,
      boardId: run.execution.boardId,
      executionId: run.execution.executionId,
      callIndex: index,
      patch: {
        status: 'succeeded',
        outputAssetIds: [asset.assetId],
        usage: result.usage,
        completedAt: new Date().toISOString(),
      },
    });
  }
  const completed = await loadSnapshot(run.execution.projectId, run.execution.boardId);
  const execution = completed.executions.find(
    (candidate) => candidate.executionId === run.execution.executionId,
  );
  if (!execution) throw new Error(`Domain Video Execution disappeared: ${run.execution.executionId}`);
  return { snapshot: completed, execution };
}

function authorizationFor(
  request: NonNullable<Awaited<ReturnType<typeof prepareDomainVideoLaunch>>['review']['request']>,
  costDisclosure: NonNullable<Awaited<ReturnType<typeof prepareDomainVideoLaunch>>['review']['costDisclosure']>,
  routeKind: string | undefined,
): ProviderExecutionAuthorizationV1 {
  const local = routeKind === 'local';
  if (!local && costDisclosure.billingSource === 'no_cost') {
    throw new DomainVideoGenerationContractError(
      'generation_video_authorization_mismatch',
      'An external Provider route cannot use a no-cost local authorization.',
    );
  }
  return {
    schemaRef: 'retake.provider-execution-authorization/v1',
    kind: local ? 'not_required_no_external_action' : 'explicit_user_submit',
    action: local ? 'local_execute' : 'provider_submit',
    authorizedByActorId: 'user_local',
    authorizedAt: new Date().toISOString(),
    generationPackageArtifactRevisionId: request.generationPackageArtifactRevisionId,
    requestFingerprint: request.requestFingerprint,
    adapterId: request.adapterId,
    connectionId: request.connectionId,
    outputCount: request.launchParameters.outputCount,
    costDisclosure: structuredClone(costDisclosure),
  };
}
