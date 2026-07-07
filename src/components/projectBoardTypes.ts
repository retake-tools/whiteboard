export type ProjectBoardDialogState =
  | { action: 'createProject'; defaultName: string }
  | { action: 'createBoard'; projectId: string; defaultName: string }
  | { action: 'renameProject'; projectId: string; currentName: string }
  | { action: 'renameBoard'; projectId: string; boardId: string; currentName: string }
  | { action: 'duplicateBoard'; projectId: string; boardId: string; currentName: string }
  | { action: 'deleteBoard'; projectId: string; boardId: string }
  | { action: 'deleteProject'; projectId: string };
