import type { ReactElement } from 'react';
import type { BoardSnapshot } from '../core/types';
import { SkillQuickInputComposer } from './SkillQuickInputComposer';
import type { UnifiedComposerAgentInput } from './UnifiedComposerProvider';

export function AgentWorkspaceComposer({
  disabled,
  onSubmit,
  snapshot,
}: {
  disabled?: boolean;
  onSubmit: (input: UnifiedComposerAgentInput) => void;
  snapshot: BoardSnapshot;
}): ReactElement {
  return (
    <SkillQuickInputComposer
      agentDisabled={disabled}
      autoFocus
      mode="agent"
      onSubmitAgentMessage={onSubmit}
      showRecommendations={false}
      snapshot={snapshot}
    />
  );
}
