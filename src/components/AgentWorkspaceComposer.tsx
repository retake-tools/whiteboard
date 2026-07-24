import type { ReactElement } from 'react';
import type { BoardSnapshot } from '../core/types';
import { SkillQuickInputComposer } from './SkillQuickInputComposer';
import type { UnifiedComposerAgentInput } from './UnifiedComposerProvider';

export function AgentWorkspaceComposer({
  disabled,
  onRequestCanvasMode,
  onSubmit,
  snapshot,
}: {
  disabled?: boolean;
  onRequestCanvasMode: () => void;
  onSubmit: (input: UnifiedComposerAgentInput) => void;
  snapshot: BoardSnapshot;
}): ReactElement {
  return (
    <SkillQuickInputComposer
      agentDisabled={disabled}
      autoFocus
      mode="agent"
      onRequestCanvasMode={onRequestCanvasMode}
      onSubmitAgentMessage={onSubmit}
      showRecommendations={false}
      snapshot={snapshot}
    />
  );
}
