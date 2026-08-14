import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionProgressSummary } from '../src/components/ExecutionProgressSummary';
import { WorkspaceCreateMenu } from '../src/components/WorkspaceCreateMenu';
import { I18nProvider } from '../src/i18n';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => 'en',
    setItem: () => undefined,
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'en-US' },
});

const triggerMarkup = renderToStaticMarkup(
  <I18nProvider>
    <WorkspaceCreateMenu
      onAddBlock={() => undefined}
      onCreateImageToImage={() => undefined}
      onCreateTextToImage={() => undefined}
      onOpenAgent={() => undefined}
      onOpenWorkflow={() => undefined}
    />
  </I18nProvider>,
);
assert.match(triggerMarkup, /aria-label="Create on canvas"/);
assert.match(triggerMarkup, /aria-expanded="false"/);

const runningMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ExecutionProgressSummary
      execution={{
        outputAssetIds: ['asset_1', 'asset_2'],
        outputBlockIds: ['result_1', 'result_2', 'result_3', 'result_4'],
        resultSummary: { requested: 4, succeeded: 2, failed: 0 },
        status: 'running',
      }}
    />
  </I18nProvider>,
);
assert.match(runningMarkup, />2\/4</);
assert.match(runningMarkup, />running</);
assert.match(runningMarkup, /role="status"/);

const partialMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ExecutionProgressSummary
      execution={{
        outputAssetIds: ['asset_1', 'asset_2'],
        outputBlockIds: ['result_1', 'result_2', 'result_3', 'result_4'],
        resultSummary: { requested: 4, succeeded: 2, failed: 2 },
        status: 'failed',
      }}
      onRetry={() => undefined}
    />
  </I18nProvider>,
);
assert.match(partialMarkup, />2\/4</);
assert.match(partialMarkup, />partial</);
assert.match(partialMarkup, />2 failed</);
assert.match(partialMarkup, />Retry</);

const singleSucceededMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ExecutionProgressSummary
      execution={{
        outputAssetIds: ['asset_1'],
        outputBlockIds: ['result_1'],
        status: 'succeeded',
      }}
    />
  </I18nProvider>,
);
assert.equal(singleSucceededMarkup, '');

const [toolbarSource, composerSource, createMenuSource, progressStyles] = await Promise.all([
  readFile(new URL('../src/components/FloatingToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/WorkspaceCreateMenu.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/nodes/operation-inline-controls.css', import.meta.url), 'utf8'),
]);
assert.match(toolbarSource, /<WorkspaceCreateMenu/);
assert.doesNotMatch(toolbarSource, /<ToolbarMenu/);
assert.match(createMenuSource, /listPackageEntryPoints/);
assert.match(createMenuSource, /onOpenAgent/);
assert.match(createMenuSource, /onOpenWorkflow/);
assert.match(composerSource, /detail\?\.entrypointId/);
assert.match(progressStyles, /\.execution-progress-summary/);

console.log({
  agentAndWorkflowUseComposer: true,
  blocksAndGenerationShareOneMenu: true,
  dynamicWorkflowEntries: true,
  progressSummaryProjectsTwoOfFour: true,
  singleSucceededExecutionStaysCompact: true,
});
