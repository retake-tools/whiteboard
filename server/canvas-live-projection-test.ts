import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { RetakeNode } from '../src/canvas/reactFlowTypes';
import {
  flowNodeLayoutSignature,
  retainFlowNodeMeasurements,
} from '../src/app/canvasLiveProjection';

const currentNodes = [{
  data: {},
  id: 'block_existing',
  measured: { height: 180, width: 240 },
  position: { x: 0, y: 0 },
  type: 'image',
}] satisfies RetakeNode[];
const projectedNodes = [{
  data: { status: 'succeeded' },
  id: 'block_existing',
  initialHeight: 180,
  initialWidth: 240,
  position: { x: 20, y: 30 },
  type: 'image',
}, {
  data: {},
  id: 'block_new',
  initialHeight: 190,
  initialWidth: 320,
  position: { x: 300, y: 30 },
  type: 'operation',
}] satisfies RetakeNode[];

const retained = retainFlowNodeMeasurements(projectedNodes, currentNodes);
assert.deepEqual(retained[0]?.measured, { height: 180, width: 240 });
assert.equal(retained[0]?.position.x, 20);
assert.equal(retained[0]?.data.status, 'succeeded');
assert.equal(retained[1]?.measured, undefined);

assert.equal(
  flowNodeLayoutSignature(projectedNodes),
  flowNodeLayoutSignature(projectedNodes.map((node) => ({
    ...node,
    data: { ...node.data, selected: true },
    selected: true,
  }))),
  'selection and data-only changes must not force a full node remeasurement',
);
assert.notEqual(
  flowNodeLayoutSignature(projectedNodes),
  flowNodeLayoutSignature(projectedNodes.slice(0, 1)),
  'structural changes must force node internals to refresh',
);

const viewportControlsSource = await readFile(
  new URL('../src/components/CanvasViewportControls.tsx', import.meta.url),
  'utf8',
);
assert.match(viewportControlsSource, /reactFlow\.fitView/);
assert.match(viewportControlsSource, /updateNodeInternals\(reactFlow\.getNodes\(\)/);

const canvasSource = await readFile(
  new URL('../src/app/WhiteboardCanvas.tsx', import.meta.url),
  'utf8',
);
assert.match(canvasSource, /<CanvasProjectionSynchronizer nodes=\{canvas\.nodes\} \/>/);

const workspaceShellCss = await readFile(
  new URL('../src/components/workspace-shell.css', import.meta.url),
  'utf8',
);
assert.match(
  workspaceShellCss,
  /\.workspace-shell\.has-workbench \.canvas-utility-dock\s*\{\s*bottom: 174px;/,
);
assert.match(
  workspaceShellCss,
  /\.workspace-shell\.has-workbench \.canvas-minimap\s*\{\s*bottom: 226px !important;/,
);

console.log('canvas live projection tests passed');
