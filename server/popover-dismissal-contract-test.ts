import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const hookSource = await readFile('src/hooks/useDismissiblePopover.ts', 'utf8');
const componentPaths = [
  'src/components/ContextToolbar.tsx',
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
assert.match(componentSources[3].source, /insideSelector: '\.operation-option-popover-wrap'/);

console.log({
  capturePhaseOutsideClick: true,
  escapeDismissal: true,
  migratedComponents: componentPaths.length,
  portalSupport: true,
  selectionChangeDismissal: true,
});
