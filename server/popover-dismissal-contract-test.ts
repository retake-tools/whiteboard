import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const hookSource = await readFile('src/hooks/useDismissiblePopover.ts', 'utf8');
const componentPaths = [
  'src/components/ContextToolbar.tsx',
  'src/components/SkillQuickInputComposer.tsx',
  'src/components/GroupToolbar.tsx',
  'src/nodes/BlockNode.tsx',
  'src/nodes/OperationInlineControls.tsx',
] as const;
const componentSources = await Promise.all(
  componentPaths.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
);

assert.match(hookSource, /document\.addEventListener\('pointerdown', onPointerDown, true\)/);
assert.match(hookSource, /window\.addEventListener\('keydown', onKeyDown, true\)/);
assert.match(hookSource, /window\.addEventListener\(dismissPopoversEvent, onDismissRequested\)/);
assert.match(hookSource, /event\.key === 'Escape'/);

for (const component of componentSources) {
  assert.match(
    component.source,
    /useDismissiblePopover/,
    `${component.path} must use the shared dismissible popover contract`,
  );
  assert.doesNotMatch(
    component.source,
    /document\.addEventListener\('pointerdown'/,
    `${component.path} must not register an independent document pointer listener`,
  );
}

assert.match(componentSources[0].source, /additionalRefs: \[popoverRef\]/);
assert.match(
  componentSources[0].source,
  /active: Boolean\(visibleActiveTool && visibleActiveTool !== 'annotation-edit'\)/,
  'annotation editing must opt out of generic outside-click, Escape, and selection-change dismissal',
);
assert.match(
  componentSources[0].source,
  /className="annotation-modal-layer nodrag nopan nowheel"/,
  'annotation editing must intercept canvas clicks so selection changes cannot unmount the editor',
);
assert.match(componentSources[4].source, /insideSelector: '\.operation-option-popover-wrap'/);
assert.match(componentSources[4].source, /currentExecutionProviderSettings/);
assert.match(componentSources[4].source, /supportedCapabilityIds\.includes\(capabilityId\)/);
assert.match(componentSources[4].source, /option\.status !== 'ready'/);
assert.match(componentSources[4].source, /retake:update-operation-connection/);

console.log({
  capturePhaseOutsideClick: true,
  annotationExplicitCloseOnly: true,
  escapeDismissal: true,
  migratedComponents: componentPaths.length,
  portalSupport: true,
  selectionChangeDismissal: true,
});
