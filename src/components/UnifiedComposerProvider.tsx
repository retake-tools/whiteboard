import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  defaultGenerationPreparationParameters,
  type GenerationPreparationParameters,
  type GenerationReferenceRole,
} from '../core/generationPreparationContracts';
import type {
  PackageComposerInlineValue,
  PackageComposerMention,
} from '../core/packageComposer';
import type { StoryboardSheetPanelCount } from '../core/storyboardSheetContracts';
import {
  defaultImageComposerGenerationParams,
  type ComposerMode,
  type ImageComposerReference,
  type ImageComposerReferenceRole,
} from '../core/imageComposer';
import type { ImageGenerationParams } from '../core/imageOperations';
import type {
  CompiledCreativeRequest,
  CreativeRequestReferenceRole,
} from '../core/creativeRequestCompiler';

export interface ComposerReferenceSetting {
  purpose: string;
  required: boolean;
  role: GenerationReferenceRole;
}

export interface UnifiedComposerAgentInput {
  agentPreferences: AgentComposerPreferences;
  content: string;
  entrypointId?: string;
  inlineValues: PackageComposerInlineValue[];
  mentions: PackageComposerMention[];
  parameters: Record<string, unknown>;
}

export interface AgentComposerPreferences {
  aspectRatioPreset?: string;
  connectionId?: string;
  outputType: 'auto' | 'image' | 'video';
  targetResolution?: string;
  variationCount?: 1 | 2 | 3 | 4;
}

export interface UnifiedComposerImageDraftInput {
  capabilityId: 'image.image_to_image' | 'image.text_to_image';
  connectionId: string;
  creativeRequest: CompiledCreativeRequest;
  generationParams: ImageGenerationParams;
  instruction: string;
  references: ImageComposerReference[];
}

export interface UnifiedComposerVideoReference {
  mention: PackageComposerMention;
  purpose?: string;
  role: Extract<
    CreativeRequestReferenceRole,
    | 'character_reference'
    | 'environment_reference'
    | 'first_frame'
    | 'general_reference'
    | 'last_frame'
  >;
}

export interface UnifiedComposerVideoDraftInput {
  aspectRatio: string;
  connectionId: string;
  durationSeconds: number;
  instruction: string;
  outputCount: number;
  creativeRequest: CompiledCreativeRequest;
  references: UnifiedComposerVideoReference[];
}

export interface WorkflowContinuationComposerHandoff {
  entrypointId: string;
  inlineValuesBySlot: Record<string, string>;
  mentions: PackageComposerMention[];
}

export interface UnifiedComposerDraftController {
  clearEntryPoint: () => void;
  agentPreferences: AgentComposerPreferences;
  composerMode: ComposerMode;
  entrypointId?: string;
  generationParameters: GenerationPreparationParameters;
  imageConnectionId?: string;
  imageGenerationParams: ImageGenerationParams;
  imageGenerationParamsTouched: boolean;
  imageReferenceRoles: Record<string, ImageComposerReferenceRole>;
  inlineValuesBySlot: Record<string, string>;
  instruction: string;
  isDirty: boolean;
  mentions: PackageComposerMention[];
  referenceSettings: Record<string, ComposerReferenceSetting>;
  reset: () => void;
  resetImageSubmission: () => void;
  selectEntryPoint: (entrypointId: string) => void;
  setComposerMode: (mode: ComposerMode) => void;
  setAgentPreferences: Dispatch<SetStateAction<AgentComposerPreferences>>;
  setGenerationParameters: Dispatch<SetStateAction<GenerationPreparationParameters>>;
  setImageConnectionId: Dispatch<SetStateAction<string | undefined>>;
  setImageGenerationParams: Dispatch<SetStateAction<ImageGenerationParams>>;
  setImageGenerationParamsTouched: Dispatch<SetStateAction<boolean>>;
  setImageReferenceRoles: Dispatch<SetStateAction<Record<string, ImageComposerReferenceRole>>>;
  setInlineValuesBySlot: Dispatch<SetStateAction<Record<string, string>>>;
  setInstruction: Dispatch<SetStateAction<string>>;
  setMentions: Dispatch<SetStateAction<PackageComposerMention[]>>;
  setReferenceSettings: Dispatch<SetStateAction<Record<string, ComposerReferenceSetting>>>;
  setStoryboardOutputCount: Dispatch<SetStateAction<1 | 2 | 3 | 4>>;
  setStoryboardPanelCount: Dispatch<SetStateAction<StoryboardSheetPanelCount>>;
  startWorkflowContinuation: (handoff: WorkflowContinuationComposerHandoff) => void;
  storyboardOutputCount: 1 | 2 | 3 | 4;
  storyboardPanelCount: StoryboardSheetPanelCount;
  videoConnectionId?: string;
  videoParameters: {
    aspectRatio: string;
    durationSeconds: number;
    outputCount: number;
  };
  setVideoConnectionId: Dispatch<SetStateAction<string | undefined>>;
  setVideoParameters: Dispatch<SetStateAction<{
    aspectRatio: string;
    durationSeconds: number;
    outputCount: number;
  }>>;
}

const UnifiedComposerContext = createContext<UnifiedComposerDraftController | undefined>(undefined);

export function UnifiedComposerProvider({ children }: { children: ReactNode }): ReactElement {
  const [agentPreferences, setAgentPreferences] = useState<AgentComposerPreferences>({
    outputType: 'auto',
  });
  const [composerMode, setComposerModeState] = useState<ComposerMode>('agent');
  const [entrypointId, setEntrypointId] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [inlineValuesBySlot, setInlineValuesBySlot] = useState<Record<string, string>>({});
  const [storyboardOutputCount, setStoryboardOutputCount] = useState<1 | 2 | 3 | 4>(1);
  const [storyboardPanelCount, setStoryboardPanelCount] = useState<StoryboardSheetPanelCount>(6);
  const [generationParameters, setGenerationParameters] = useState<GenerationPreparationParameters>(
    defaultGenerationPreparationParameters,
  );
  const [referenceSettings, setReferenceSettings] = useState<Record<string, ComposerReferenceSetting>>({});
  const [mentions, setMentions] = useState<PackageComposerMention[]>([]);
  const [imageConnectionId, setImageConnectionId] = useState<string>();
  const [imageGenerationParams, setImageGenerationParams] = useState<ImageGenerationParams>(
    defaultImageComposerGenerationParams,
  );
  const [imageGenerationParamsTouched, setImageGenerationParamsTouched] = useState(false);
  const [imageReferenceRoles, setImageReferenceRoles] = useState<Record<string, ImageComposerReferenceRole>>({});
  const [videoConnectionId, setVideoConnectionId] = useState<string>();
  const [videoParameters, setVideoParameters] = useState({
    aspectRatio: '9:16',
    durationSeconds: 8,
    outputCount: 1,
  });

  const reset = useCallback((): void => {
    setEntrypointId(undefined);
    setInstruction('');
    setInlineValuesBySlot({});
    setStoryboardOutputCount(1);
    setStoryboardPanelCount(6);
    setGenerationParameters(defaultGenerationPreparationParameters);
    setReferenceSettings({});
    setMentions([]);
    setImageReferenceRoles({});
    setImageGenerationParamsTouched(false);
  }, []);

  const resetImageSubmission = useCallback((): void => {
    setInstruction('');
    setMentions([]);
    setImageReferenceRoles({});
  }, []);

  const clearEntryPoint = useCallback((): void => {
    setEntrypointId(undefined);
    setInlineValuesBySlot({});
    setStoryboardOutputCount(1);
    setStoryboardPanelCount(6);
    setGenerationParameters(defaultGenerationPreparationParameters);
    setReferenceSettings({});
    setMentions([]);
  }, []);

  const selectEntryPoint = useCallback((nextEntrypointId: string): void => {
    setEntrypointId(nextEntrypointId);
    setInlineValuesBySlot({});
    setStoryboardOutputCount(1);
    setStoryboardPanelCount(6);
    setGenerationParameters(defaultGenerationPreparationParameters);
    setReferenceSettings({});
    setMentions([]);
  }, []);

  const setComposerMode = useCallback((mode: ComposerMode): void => {
    setComposerModeState(mode);
    setEntrypointId(undefined);
    setInlineValuesBySlot({});
    setStoryboardOutputCount(1);
    setStoryboardPanelCount(6);
    setGenerationParameters(defaultGenerationPreparationParameters);
    setReferenceSettings({});
    setMentions([]);
    setImageReferenceRoles({});
    setImageGenerationParamsTouched(false);
  }, []);

  const startWorkflowContinuation = useCallback((
    handoff: WorkflowContinuationComposerHandoff,
  ): void => {
    setComposerModeState('agent');
    setEntrypointId(handoff.entrypointId);
    setInstruction('');
    setInlineValuesBySlot(structuredClone(handoff.inlineValuesBySlot));
    setStoryboardOutputCount(1);
    setStoryboardPanelCount(6);
    setGenerationParameters(defaultGenerationPreparationParameters);
    setReferenceSettings({});
    setMentions(structuredClone(handoff.mentions));
    setImageReferenceRoles({});
    setImageGenerationParamsTouched(false);
  }, []);

  const isDirty = Boolean(
    composerMode !== 'agent'
    || entrypointId
    || instruction.trim()
    || mentions.length > 0
    || Object.values(inlineValuesBySlot).some((value) => value.trim()),
  );

  const value = useMemo<UnifiedComposerDraftController>(() => ({
    agentPreferences,
    clearEntryPoint,
    composerMode,
    entrypointId,
    generationParameters,
    imageConnectionId,
    imageGenerationParams,
    imageGenerationParamsTouched,
    imageReferenceRoles,
    inlineValuesBySlot,
    instruction,
    isDirty,
    mentions,
    referenceSettings,
    reset,
    resetImageSubmission,
    selectEntryPoint,
    setComposerMode,
    setAgentPreferences,
    setGenerationParameters,
    setImageConnectionId,
    setImageGenerationParams,
    setImageGenerationParamsTouched,
    setImageReferenceRoles,
    setInlineValuesBySlot,
    setInstruction,
    setMentions,
    setReferenceSettings,
    setStoryboardOutputCount,
    setStoryboardPanelCount,
    startWorkflowContinuation,
    storyboardOutputCount,
    storyboardPanelCount,
    videoConnectionId,
    videoParameters,
    setVideoConnectionId,
    setVideoParameters,
  }), [
    agentPreferences,
    clearEntryPoint,
    composerMode,
    entrypointId,
    generationParameters,
    imageConnectionId,
    imageGenerationParams,
    imageGenerationParamsTouched,
    imageReferenceRoles,
    inlineValuesBySlot,
    instruction,
    isDirty,
    mentions,
    referenceSettings,
    reset,
    resetImageSubmission,
    selectEntryPoint,
    setComposerMode,
    startWorkflowContinuation,
    storyboardOutputCount,
    storyboardPanelCount,
    videoConnectionId,
    videoParameters,
  ]);

  return <UnifiedComposerContext.Provider value={value}>{children}</UnifiedComposerContext.Provider>;
}

export function useUnifiedComposerDraft(): UnifiedComposerDraftController {
  const value = useContext(UnifiedComposerContext);
  if (!value) throw new Error('Unified Composer must be rendered inside UnifiedComposerProvider.');
  return value;
}
