import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { createStandardBlockRecord } from '../src/core/application/createStandardBlockRecord';
import type { BoardSnapshot } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import {
  createCanvasNodeProjector,
  type HostReactPluginSurfaceV1,
} from '../src/host-kit/react';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';

const counts = [1, 100, 500] as const;
const snapshots = counts.map(createSnapshot);
const storage = new InMemoryHostStorageAdapter(snapshots);
const host = await createCanvasHost({
  connections: createNoopHostConnections(),
  environment: {
    colorScheme: 'light',
    contrast: 'normal',
    direction: 'ltr',
    locale: 'en',
    reducedMotion: true,
    themeId: 'retake.performance',
  },
  experience: {
    commandOverrides: [],
    profileId: 'retake.host.performance',
    schemaVersion: 1,
  },
  initialScope: scopeFor(snapshots[0]),
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});

const switchMedianMs: Record<string, number> = {};
for (const snapshot of snapshots) {
  const samples: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now();
    await host.setScope(scopeFor(snapshot));
    samples.push(performance.now() - startedAt);
  }
  switchMedianMs[String(snapshot.blocks.length)] = median(samples);
}

let rendererCalls = 0;
const pluginSurface: HostReactPluginSurfaceV1 = {
  commands: [],
  renderers: [{
    rendererId: 'performance.text',
    supportedBlockTypes: ['text'],
    render(block) {
      rendererCalls += 1;
      return createElement('span', null, block.data.title);
    },
  }],
  revision: 'performance:1',
};
const projector = createCanvasNodeProjector();
const projectionMedianMs: Record<string, number> = {};
for (const snapshot of snapshots) {
  const samples: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const cloned = structuredClone(snapshot);
    const startedAt = performance.now();
    const nodes = projector.project({
      assetById: new Map(),
      pluginSurface,
      selectedIds: [],
      snapshot: cloned,
    });
    samples.push(performance.now() - startedAt);
    assert.equal(nodes.length, snapshot.blocks.length);
  }
  projectionMedianMs[String(snapshot.blocks.length)] = median(samples);
}

await host.setScope(scopeFor(snapshots[2]));
const rendererCallsBeforeMove = rendererCalls;
const beforeMoveNodes = projector.project({
  assetById: new Map(),
  pluginSurface,
  selectedIds: [],
  snapshot: host.readModel.getSnapshot(),
});
await host.commands.moveBlocks({
  moves: [{ blockId: snapshots[2].blocks[0]!.blockId, position: { x: 999, y: 777 } }],
});
const afterMoveNodes = projector.project({
  assetById: new Map(),
  pluginSurface,
  selectedIds: [],
  snapshot: host.readModel.getSnapshot(),
});
assert.notEqual(afterMoveNodes[0], beforeMoveNodes[0]);
for (let index = 1; index < afterMoveNodes.length; index += 1) {
  assert.equal(afterMoveNodes[index], beforeMoveNodes[index]);
}
assert.equal(rendererCalls - rendererCallsBeforeMove, 1);

assert(switchMedianMs['500']! < 100, `500 Block Host switch is too slow: ${switchMedianMs['500']}ms.`);
assert(projectionMedianMs['500']! < 100, `500 Block projection is too slow: ${projectionMedianMs['500']}ms.`);

await host.dispose();
console.log({
  hostKitPerformance: 'passed',
  projectionMedianMs,
  rendererRecomputesAfterOneMove: 1,
  switchMedianMs,
});

function createSnapshot(blockCount: number): BoardSnapshot {
  const snapshot = createBlankBoardSnapshot({
    boardId: `board_host_performance_${blockCount}`,
    boardName: `${blockCount} Block Board`,
    projectId: `project_host_performance_${blockCount}`,
    projectName: 'Host Performance',
  });
  for (let index = 0; index < blockCount; index += 1) {
    snapshot.blocks.push(createStandardBlockRecord({
      body: `Body ${index}`,
      position: { x: (index % 25) * 240, y: Math.floor(index / 25) * 160 },
      snapshot,
      title: `Block ${index}`,
      type: 'text',
    }));
  }
  return snapshot;
}

function scopeFor(snapshot: BoardSnapshot) {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.floor(sorted.length / 2)]!.toFixed(3));
}
