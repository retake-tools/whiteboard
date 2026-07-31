import type { ReactElement } from 'react';
import type { BoardSnapshot } from '../core/types';
import { SkillQuickInputComposer } from './SkillQuickInputComposer';
import type { UnifiedComposerAgentInput } from './UnifiedComposerProvider';

export function AgentWorkspaceComposer({
  disabled,
  onAttachFiles,
  onRequestCanvasMode,
  onSubmit,
  snapshot,
}: {
  disabled?: boolean;
  onAttachFiles?: Parameters<typeof SkillQuickInputComposer>[0]['onAttachFiles'];
  onRequestCanvasMode: () => void;
  onSubmit: (input: UnifiedComposerAgentInput) => void;
  snapshot: BoardSnapshot;
}): ReactElement {
  return (
    <SkillQuickInputComposer
      agentDisabled={disabled}
      autoFocus
      mode="agent"
      onAttachFiles={onAttachFiles}
      onRequestCanvasMode={onRequestCanvasMode}
      onSubmitAgentMessage={onSubmit}
      showRecommendations={false}
      snapshot={snapshot}
    />
  );
}
