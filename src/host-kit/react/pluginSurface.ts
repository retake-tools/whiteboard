import type { ReactNode } from 'react';
import type { BlockRecord, BlockType } from '../../core/types';
import type { CanvasHostCommandsV1, DeepReadonly } from '../contracts';

export interface HostReactPluginCommandV1 {
  readonly commandId: string;
  readonly label: string;
  run(commands: CanvasHostCommandsV1): Promise<void>;
}

export interface HostReactBlockRendererV1 {
  readonly rendererId: string;
  readonly supportedBlockTypes: readonly BlockType[];
  render(block: DeepReadonly<BlockRecord>): ReactNode;
}

export interface HostReactPluginSurfaceV1 {
  readonly commands: readonly HostReactPluginCommandV1[];
  readonly renderers: readonly HostReactBlockRendererV1[];
  readonly revision: string;
}
