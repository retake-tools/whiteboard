import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  completeExecution,
  createBoard,
  createExecution,
  createCodexBindingPrompt,
  createProject,
  createAssetFromDataUrl,
  createMockGeneratedAsset,
  deleteBoard,
  deleteProject,
  duplicateBoard,
  ensureDefaultSnapshot,
  failExecution,
  getBoardSnapshot,
  getExecution,
  importAssetFromPath,
  listWorkspace,
  markExecutionRunning,
  readAssetFile,
  renameBoard,
  renameProject,
  reorderBoards,
  reorderProjects,
  resetWorkspace,
  saveSnapshot,
  SnapshotWriteConflictError,
  setCodexProjectBinding,
  updateImageResultBlock,
  validateCodexProjectBinding,
} from './local-store';
import type { BoardSnapshot } from '../src/core/types';
import { seedanceModelArkAvailability } from './seedance-modelark-client';
import { cancelSeedanceVideoGeneration, startSeedanceVideoGeneration } from './seedance-video-service';
import { dreaminaCliAvailability } from './dreamina-cli-client';
import { cancelDreaminaCliVideoGeneration, startDreaminaCliVideoGeneration } from './dreamina-cli-video-service';
import {
  checkExecutionConnection,
  listExecutionProviderSettings,
  saveExecutionDefault,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import type { ExecutionCapabilityClass } from '../src/core/executionProviders';

type MiddlewareContainer = {
  use(
    path: string,
    handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void,
  ): void;
};

export function localApiPlugin(): Plugin {
  return {
    name: 'retake-local-api',
    configureServer(server) {
      installLocalApiMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installLocalApiMiddleware(server.middlewares);
    },
  };
}

function installLocalApiMiddleware(middlewares: MiddlewareContainer): void {
  middlewares.use('/api/local', async (req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const method = req.method ?? 'GET';

          if (method === 'GET' && url.pathname === '/health') {
            sendJson(res, { ok: true, service: 'retake-whiteboard' });
            return;
          }

          if (method === 'GET' && url.pathname === '/settings/execution') {
            sendJson(res, await listExecutionProviderSettings(url.searchParams.get('projectId') ?? undefined));
            return;
          }

          const executionConnectionMatch = url.pathname.match(/^\/settings\/execution\/connections\/([^/]+)$/);
          if (method === 'PUT' && executionConnectionMatch) {
            const [, providerId] = executionConnectionMatch;
            const body = (await readJson(req)) as {
              projectId?: string;
              displayName?: string;
              enabled?: boolean;
              baseUrl?: string;
              model?: string;
              apiKey?: string;
            };
            sendJson(res, await updateExecutionConnection({ providerId, ...body }, body.projectId));
            return;
          }

          const executionConnectionCheckMatch = url.pathname.match(
            /^\/settings\/execution\/connections\/([^/]+)\/check$/,
          );
          if (method === 'POST' && executionConnectionCheckMatch) {
            const [, providerId] = executionConnectionCheckMatch;
            const body = (await readJson(req)) as { projectId?: string };
            sendJson(res, await checkExecutionConnection(providerId, body.projectId));
            return;
          }

          if (method === 'PUT' && url.pathname === '/settings/execution/defaults') {
            const body = (await readJson(req)) as {
              capabilityClass?: ExecutionCapabilityClass;
              connectionId?: string;
              projectId?: string;
              responseProjectId?: string;
              model?: string;
            };
            if (!body.capabilityClass) {
              sendJson(res, { error: 'capabilityClass is required' }, 400);
              return;
            }
            sendJson(res, await saveExecutionDefault({
              capabilityClass: body.capabilityClass,
              connectionId: body.connectionId,
              projectId: body.projectId,
              responseProjectId: body.responseProjectId,
              model: body.model,
            }));
            return;
          }

          if (method === 'GET' && url.pathname === '/video/seedance-modelark/availability') {
            const settings = await listExecutionProviderSettings();
            const connection = settings.connections.find((candidate) => candidate.providerId === 'byteplus-modelark');
            sendJson(res, connection ? {
              available: connection.status === 'ready',
              adapterId: 'retake.video.seedance-modelark',
              credentialRefType: 'modelark_api_key',
              model: connection.model,
              ...(connection.status === 'ready' ? {} : { reason: connection.lastError || 'Configure BytePlus ModelArk in Retake Settings.' }),
            } : seedanceModelArkAvailability());
            return;
          }

          if (method === 'GET' && url.pathname === '/video/dreamina-cli/availability') {
            sendJson(res, await dreaminaCliAvailability());
            return;
          }

          if (method === 'POST' && url.pathname === '/video/dreamina-cli/generate') {
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              targetBlockId?: string;
              prompt?: string;
              durationSeconds?: number;
              outputCount?: number;
              aspectRatio?: string;
            };
            if (!body.projectId || !body.boardId || !body.targetBlockId || typeof body.prompt !== 'string') {
              sendJson(res, { error: 'projectId, boardId, targetBlockId, and prompt are required' }, 400);
              return;
            }
            const started = await startDreaminaCliVideoGeneration({
              projectId: body.projectId,
              boardId: body.boardId,
              targetBlockId: body.targetBlockId,
              prompt: body.prompt,
              durationSeconds: body.durationSeconds ?? 8,
              outputCount: body.outputCount ?? 1,
              aspectRatio: body.aspectRatio ?? '9:16',
            });
            sendJson(res, { snapshot: started.snapshot, execution: started.execution }, 202);
            return;
          }

          const cancelDreaminaMatch = url.pathname.match(/^\/video\/dreamina-cli\/executions\/([^/]+)\/cancel$/);
          if (method === 'POST' && cancelDreaminaMatch) {
            const [, executionId] = cancelDreaminaMatch;
            const body = (await readJson(req)) as { projectId?: string; boardId?: string; remoteOnly?: boolean };
            if (!body.projectId || !body.boardId) {
              sendJson(res, { error: 'projectId and boardId are required' }, 400);
              return;
            }
            sendJson(res, await cancelDreaminaCliVideoGeneration({
              projectId: body.projectId,
              boardId: body.boardId,
              executionId,
              remoteOnly: body.remoteOnly,
            }));
            return;
          }

          if (method === 'POST' && url.pathname === '/video/seedance-modelark/generate') {
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              targetBlockId?: string;
              prompt?: string;
              durationSeconds?: number;
              outputCount?: number;
              aspectRatio?: string;
            };
            if (!body.projectId || !body.boardId || !body.targetBlockId || typeof body.prompt !== 'string') {
              sendJson(res, { error: 'projectId, boardId, targetBlockId, and prompt are required' }, 400);
              return;
            }
            const started = await startSeedanceVideoGeneration({
              projectId: body.projectId,
              boardId: body.boardId,
              targetBlockId: body.targetBlockId,
              prompt: body.prompt,
              durationSeconds: body.durationSeconds ?? 8,
              outputCount: body.outputCount ?? 1,
              aspectRatio: body.aspectRatio,
            });
            sendJson(res, { snapshot: started.snapshot, execution: started.execution }, 202);
            return;
          }

          const cancelSeedanceMatch = url.pathname.match(/^\/video\/seedance-modelark\/executions\/([^/]+)\/cancel$/);
          if (method === 'POST' && cancelSeedanceMatch) {
            const [, executionId] = cancelSeedanceMatch;
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              providerTaskIds?: string[];
              remoteOnly?: boolean;
            };
            if (!body.projectId || !body.boardId) {
              sendJson(res, { error: 'projectId and boardId are required' }, 400);
              return;
            }
            sendJson(res, await cancelSeedanceVideoGeneration({
              projectId: body.projectId,
              boardId: body.boardId,
              executionId,
              providerTaskIds: body.providerTaskIds,
              remoteOnly: body.remoteOnly,
            }));
            return;
          }

          if (method === 'GET' && url.pathname === '/snapshot') {
            const projectId = url.searchParams.get('projectId') ?? undefined;
            const boardId = url.searchParams.get('boardId') ?? undefined;
            sendJson(res, projectId && boardId ? await getBoardSnapshot({ projectId, boardId }) : await ensureDefaultSnapshot());
            return;
          }

          if (method === 'PUT' && url.pathname === '/snapshot') {
            const snapshot = (await readJson(req)) as BoardSnapshot;
            await saveSnapshot(snapshot);
            sendJson(res, { ok: true });
            return;
          }

          if (method === 'GET' && url.pathname === '/workspace') {
            sendJson(res, await listWorkspace());
            return;
          }

          if (method === 'POST' && url.pathname === '/projects') {
            const body = (await readJson(req)) as { name?: string };
            sendJson(res, await createProject({ name: body.name }));
            return;
          }

          if (method === 'PATCH' && url.pathname === '/projects/reorder') {
            const body = (await readJson(req)) as { projectIds?: string[] };
            if (!body.projectIds) {
              sendJson(res, { error: 'projectIds is required' }, 400);
              return;
            }
            sendJson(res, await reorderProjects({ projectIds: body.projectIds }));
            return;
          }

          const projectMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
          if (method === 'PATCH' && projectMatch) {
            const [, projectId] = projectMatch;
            const body = (await readJson(req)) as { name?: string };
            if (!body.name) {
              sendJson(res, { error: 'name is required' }, 400);
              return;
            }
            sendJson(res, await renameProject({ projectId, name: body.name }));
            return;
          }

          if (method === 'DELETE' && projectMatch) {
            const [, projectId] = projectMatch;
            sendJson(res, await deleteProject({ projectId }));
            return;
          }

          const boardsMatch = url.pathname.match(/^\/projects\/([^/]+)\/boards$/);
          if (method === 'POST' && boardsMatch) {
            const [, projectId] = boardsMatch;
            const body = (await readJson(req)) as { name?: string };
            sendJson(res, await createBoard({ projectId, name: body.name }));
            return;
          }

          const reorderBoardsMatch = url.pathname.match(/^\/projects\/([^/]+)\/boards\/reorder$/);
          if (method === 'PATCH' && reorderBoardsMatch) {
            const [, projectId] = reorderBoardsMatch;
            const body = (await readJson(req)) as { boardIds?: string[] };
            if (!body.boardIds) {
              sendJson(res, { error: 'boardIds is required' }, 400);
              return;
            }
            sendJson(res, await reorderBoards({ projectId, boardIds: body.boardIds }));
            return;
          }

          const boardMatch = url.pathname.match(/^\/projects\/([^/]+)\/boards\/([^/]+)$/);
          if (method === 'PATCH' && boardMatch) {
            const [, projectId, boardId] = boardMatch;
            const body = (await readJson(req)) as { name?: string };
            if (!body.name) {
              sendJson(res, { error: 'name is required' }, 400);
              return;
            }
            sendJson(res, await renameBoard({ projectId, boardId, name: body.name }));
            return;
          }

          if (method === 'DELETE' && boardMatch) {
            const [, projectId, boardId] = boardMatch;
            sendJson(res, await deleteBoard({ projectId, boardId }));
            return;
          }

          const duplicateBoardMatch = url.pathname.match(/^\/projects\/([^/]+)\/boards\/([^/]+)\/duplicate$/);
          if (method === 'POST' && duplicateBoardMatch) {
            const [, projectId, boardId] = duplicateBoardMatch;
            const body = (await readJson(req)) as { name?: string };
            sendJson(res, await duplicateBoard({ projectId, boardId, name: body.name }));
            return;
          }

          if (method === 'POST' && url.pathname === '/reset') {
            sendJson(res, await resetWorkspace());
            return;
          }

          if (method === 'POST' && url.pathname === '/binding/codex') {
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              codexProjectPath?: string;
              note?: string;
            };
            if (!body.projectId || !body.boardId || !body.codexProjectPath) {
              sendJson(res, { error: 'projectId, boardId, and codexProjectPath are required' }, 400);
              return;
            }

            sendJson(
              res,
              await setCodexProjectBinding({
                projectId: body.projectId,
                boardId: body.boardId,
                codexProjectPath: body.codexProjectPath,
                note: body.note,
              }),
            );
            return;
          }

          if (method === 'POST' && url.pathname === '/binding/codex/validate') {
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              codexProjectPath?: string;
            };
            sendJson(res, await validateCodexProjectBinding(body));
            return;
          }

          if (method === 'POST' && url.pathname === '/binding/codex/prompt') {
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              codexProjectPath?: string;
            };
            sendJson(res, await createCodexBindingPrompt(body));
            return;
          }

          if (method === 'POST' && url.pathname === '/assets/mock-generated') {
            const body = (await readJson(req)) as {
              projectId?: string;
              sourceExecutionId?: string;
            };
            if (!body.projectId || !body.sourceExecutionId) {
              sendJson(res, { error: 'projectId and sourceExecutionId are required' }, 400);
              return;
            }

            sendJson(
              res,
              await createMockGeneratedAsset({
                projectId: body.projectId,
                sourceExecutionId: body.sourceExecutionId,
              }),
            );
            return;
          }

          if (method === 'POST' && url.pathname === '/assets/import') {
            const body = (await readJson(req)) as {
              projectId?: string;
              sourceExecutionId?: string;
              sourcePath?: string;
              kind?: 'image' | 'video' | 'audio' | 'document' | 'other';
              mimeType?: string;
            };
            if (!body.projectId || !body.sourcePath) {
              sendJson(res, { error: 'projectId and sourcePath are required' }, 400);
              return;
            }

            sendJson(
              res,
              await importAssetFromPath({
                projectId: body.projectId,
                sourceExecutionId: body.sourceExecutionId,
                sourcePath: body.sourcePath,
                kind: body.kind,
                mimeType: body.mimeType,
              }),
            );
            return;
          }

          if (method === 'POST' && url.pathname === '/assets/data-url') {
            const body = (await readJson(req)) as {
              projectId?: string;
              dataUrl?: string;
              fileName?: string;
              width?: number;
              height?: number;
              sourceExecutionId?: string;
            };
            if (!body.projectId || !body.dataUrl) {
              sendJson(res, { error: 'projectId and dataUrl are required' }, 400);
              return;
            }

            sendJson(
              res,
              await createAssetFromDataUrl({
                projectId: body.projectId,
                dataUrl: body.dataUrl,
                fileName: body.fileName,
                kind: 'image',
                width: body.width,
                height: body.height,
                sourceExecutionId: body.sourceExecutionId,
              }),
            );
            return;
          }

          if (method === 'POST' && url.pathname === '/executions') {
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              capabilityId?: string;
              adapter?: 'direct_api' | 'mcp_agent' | 'cli_agent' | 'manual_import' | 'mock';
              inputBlockIds?: string[];
              agentHost?: 'codex' | 'claude' | 'cursor' | 'other';
              triggerMode?:
                | 'manual_agent_session'
                | 'agent_bridge'
                | 'codex_cli'
                | 'acp'
                | 'server_worker'
                | 'manual_import'
                | 'local_mock';
              provider?: string;
              model?: string;
              skillId?: string;
              prompt?: string;
            };
            if (!body.projectId || !body.boardId || !body.capabilityId || !body.adapter) {
              sendJson(res, { error: 'projectId, boardId, capabilityId, and adapter are required' }, 400);
              return;
            }

            sendJson(
              res,
              await createExecution({
                projectId: body.projectId,
                boardId: body.boardId,
                capabilityId: body.capabilityId,
                adapter: body.adapter,
                inputBlockIds: body.inputBlockIds ?? [],
                agentHost: body.agentHost,
                triggerMode: body.triggerMode,
                provider: body.provider,
                model: body.model,
                skillId: body.skillId,
                prompt: body.prompt,
              }),
            );
            return;
          }

          const executionMatch = url.pathname.match(/^\/executions\/([^/]+)$/);
          if (method === 'GET' && executionMatch) {
            const [, executionId] = executionMatch;
            const projectId = url.searchParams.get('projectId');
            const boardId = url.searchParams.get('boardId');
            if (!projectId || !boardId) {
              sendJson(res, { error: 'projectId and boardId are required' }, 400);
              return;
            }

            sendJson(res, await getExecution({ projectId, boardId, executionId }));
            return;
          }

          const startExecutionMatch = url.pathname.match(/^\/executions\/([^/]+)\/start$/);
          if (method === 'POST' && startExecutionMatch) {
            const [, executionId] = startExecutionMatch;
            const body = (await readJson(req)) as { projectId?: string; boardId?: string };
            if (!body.projectId || !body.boardId) {
              sendJson(res, { error: 'projectId and boardId are required' }, 400);
              return;
            }

            sendJson(
              res,
              await markExecutionRunning({
                projectId: body.projectId,
                boardId: body.boardId,
                executionId,
              }),
            );
            return;
          }

          const completeExecutionMatch = url.pathname.match(/^\/executions\/([^/]+)\/complete$/);
          if (method === 'POST' && completeExecutionMatch) {
            const [, executionId] = completeExecutionMatch;
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              outputBlockIds?: string[];
              outputAssetIds?: string[];
            };
            if (!body.projectId || !body.boardId) {
              sendJson(res, { error: 'projectId and boardId are required' }, 400);
              return;
            }

            sendJson(
              res,
              await completeExecution({
                projectId: body.projectId,
                boardId: body.boardId,
                executionId,
                outputBlockIds: body.outputBlockIds,
                outputAssetIds: body.outputAssetIds,
              }),
            );
            return;
          }

          const failExecutionMatch = url.pathname.match(/^\/executions\/([^/]+)\/fail$/);
          if (method === 'POST' && failExecutionMatch) {
            const [, executionId] = failExecutionMatch;
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              errorMessage?: string;
            };
            if (!body.projectId || !body.boardId || !body.errorMessage) {
              sendJson(res, { error: 'projectId, boardId, and errorMessage are required' }, 400);
              return;
            }

            sendJson(
              res,
              await failExecution({
                projectId: body.projectId,
                boardId: body.boardId,
                executionId,
                errorMessage: body.errorMessage,
              }),
            );
            return;
          }

          if (method === 'POST' && url.pathname === '/result-blocks/image/update') {
            const body = (await readJson(req)) as {
              projectId?: string;
              boardId?: string;
              executionId?: string;
              assetId?: string;
              resultBlockId?: string;
              title?: string;
              body?: string;
            };
            if (!body.projectId || !body.boardId || !body.executionId || !body.assetId) {
              sendJson(res, { error: 'projectId, boardId, executionId, and assetId are required' }, 400);
              return;
            }

            sendJson(
              res,
              await updateImageResultBlock({
                projectId: body.projectId,
                boardId: body.boardId,
                executionId: body.executionId,
                assetId: body.assetId,
                resultBlockId: body.resultBlockId,
                title: body.title,
                body: body.body,
              }),
            );
            return;
          }

          const assetMatch = url.pathname.match(/^\/assets\/([^/]+)\/([^/]+)\/([^/]+)$/);
          if (method === 'GET' && assetMatch) {
            const [, projectId, assetId, fileName] = assetMatch;
            const file = await readAssetFile({ projectId, assetId, fileName });
            res.statusCode = 200;
            res.setHeader('Content-Type', file.mimeType);
            res.end(file.bytes);
            return;
          }

          next();
        } catch (error) {
          sendJson(
            res,
            {
              error: error instanceof Error ? error.message : 'Unknown local API error',
            },
            error instanceof SnapshotWriteConflictError ? 409 : 500,
          );
        }
      });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, value: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(value));
}
