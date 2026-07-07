import { nowIso } from './id';
import type { BoardSnapshot } from './types';

const createdAt = nowIso();

export const defaultSnapshot: BoardSnapshot = {
  schemaVersion: 1,
  project: {
    projectId: 'proj_demo_retake',
    name: 'Retake Demo Project',
    createdAt,
    updatedAt: createdAt,
    defaultBoardId: 'board_demo_video_001',
    localRoot: '.retake/projects/proj_demo_retake',
  },
  board: {
    boardId: 'board_demo_video_001',
    projectId: 'proj_demo_retake',
    name: 'Video 001 Board',
    createdAt,
    updatedAt: createdAt,
  },
  layers: [
    {
      id: 'layer_default',
      boardId: 'board_demo_video_001',
      name: 'Default',
      visible: true,
      locked: false,
      order: 0,
    },
  ],
  blocks: [
    {
      blockId: 'block_brief',
      boardId: 'board_demo_video_001',
      type: 'text',
      layerId: 'layer_default',
      position: { x: -420, y: -150 },
      size: { width: 260, height: 180 },
      zIndex: 2,
      data: {
        title: 'Creative brief',
        body: 'A short product-style video concept. Select this block, then run mock Codex to create an image result block.',
      },
      createdAt,
      updatedAt: createdAt,
    },
    {
      blockId: 'block_task',
      boardId: 'board_demo_video_001',
      type: 'task',
      layerId: 'layer_default',
      position: { x: -40, y: -130 },
      size: { width: 280, height: 160 },
      zIndex: 2,
      data: {
        title: 'image.generate',
        body: 'Capability: image.generate\nAdapter: mcp_agent.codex or direct_api in the future',
        capabilityId: 'image.generate',
        status: 'queued',
      },
      createdAt,
      updatedAt: createdAt,
    },
    {
      blockId: 'frame_storyboard',
      boardId: 'board_demo_video_001',
      type: 'frame',
      layerId: 'layer_default',
      position: { x: -500, y: 140 },
      size: { width: 800, height: 320 },
      zIndex: 0,
      data: {
        title: 'Storyboard / generation area',
        body: 'Frame is only spatial organization in the MVP spike.',
      },
      createdAt,
      updatedAt: createdAt,
    },
  ],
  edges: [
    {
      edgeId: 'edge_brief_task',
      sourceBlockId: 'block_brief',
      targetBlockId: 'block_task',
      kind: 'execution_input',
    },
  ],
  assets: [],
  executions: [],
  historyEvents: [],
  viewport: { x: 550, y: 280, zoom: 0.9 },
};
