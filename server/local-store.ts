// Compatibility facade: server callers keep one stable import surface while
// persistence responsibilities live in focused modules under local-store/.
export { readAssetFile } from './local-store/asset-files';
export {
  createAssetFromDataUrl,
  createMockGeneratedAsset,
  importAssetFromPath,
} from './local-store/asset-store';
export {
  completeExecution,
  createExecution,
  failExecution,
  getExecution,
  markExecutionRunning,
  updateImageResultBlock,
} from './local-store/execution-store';
export {
  ensureDefaultSnapshot,
  getBoardSnapshot,
  resetWorkspace,
  saveSnapshot,
  SnapshotWriteConflictError,
} from './local-store/snapshot-store';
export {
  createBoard,
  createCodexBindingPrompt,
  createProject,
  deleteBoard,
  deleteProject,
  duplicateBoard,
  listWorkspace,
  renameBoard,
  renameProject,
  reorderBoards,
  reorderProjects,
  setCodexProjectBinding,
  validateCodexProjectBinding,
} from './local-store/workspace-store';
