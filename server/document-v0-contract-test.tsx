import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown, safeMarkdownUrl } from '../src/components/SafeMarkdown';
import { appendDocumentStream, beginDocumentStream, documentStreamContent } from '../src/core/documentStreamStore';
import { markdownHeadingAnchorId, markdownHeadings, summarizeMarkdown } from '../src/core/markdownDocument';
import { I18nProvider } from '../src/i18n';
import { DocumentBlockBody } from '../src/nodes/DocumentBlockBody';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => undefined },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'en-US' },
});

const summary = summarizeMarkdown(`# Title\n\n## Scene one\n\nHello **world**.\n\n### Shot A\n\nAction.`);
assert.equal(summary.title, 'Title');
assert.deepEqual(summary.outline, ['Title', '  Scene one', '    Shot A']);
assert.equal(summary.excerpt, 'Title\n\nScene one\n\nHello world.\n\nShot A\n\nAction.');
assert.equal(summary.characterCount, 36);
assert.deepEqual(markdownHeadings('# Title\n\n## Scene one'), [
  { level: 1, line: 1, text: 'Title' },
  { level: 2, line: 3, text: 'Scene one' },
]);
assert.equal(markdownHeadingAnchorId('document-block', 3), 'document-block-heading-3');
beginDocumentStream('block_streaming_document');
appendDocumentStream('block_streaming_document', '# Live');
appendDocumentStream('block_streaming_document', '\n\nFirst delta.');
assert.equal(documentStreamContent('block_streaming_document'), '# Live\n\nFirst delta.');

assert.equal(safeMarkdownUrl('https://example.com/doc'), 'https://example.com/doc');
assert.equal(safeMarkdownUrl('#scene-one'), '#scene-one');
assert.equal(safeMarkdownUrl('javascript:alert(1)'), '');
assert.equal(safeMarkdownUrl('data:text/html,unsafe'), '');

const rendered = renderToStaticMarkup(
  <SafeMarkdown
    externalImageBlockedLabel="External image blocked"
    markdown={'# Safe\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![tracker](https://example.com/tracker.png)\n\n[good](https://example.com)'}
  />,
);
assert.doesNotMatch(rendered, /<script|<iframe|<img|javascript:/i);
assert.match(rendered, /External image blocked: tracker/);
assert.match(rendered, /href="https:\/\/example.com"/);

const documentBlock = renderToStaticMarkup(
  <I18nProvider>
    <DocumentBlockBody
      blockId="block_document"
      data={{
        documentCharacterCount: 12,
        documentExcerpt: 'A short document excerpt.',
        sourceExecutionId: 'exec_document',
        title: 'Document',
      }}
    />
  </I18nProvider>,
);
assert.match(documentBlock, /^<div class="document-block-body"/);
assert.match(documentBlock, /aria-label="Open review"/);
assert.doesNotMatch(documentBlock, /aria-label="Show execution details"/);
assert.doesNotMatch(documentBlock, /^<button/);

const documentBlockSource = await readFile('src/nodes/DocumentBlockBody.tsx', 'utf8');
const executionDetailSource = await readFile('src/components/ExecutionDetailContent.tsx', 'utf8');
const executionInspectorSource = await readFile('src/components/ExecutionInspector.tsx', 'utf8');
assert.match(documentBlockSource, /'retake:open-execution-inspector'\s*:\s*'retake:open-document-review'/);
assert.match(executionInspectorSource, /executionOutputDocuments/);
assert.match(executionInspectorSource, /<ExecutionDocumentViewer document=\{selectedDocument\}/);
assert.match(executionInspectorSource, /<SafeMarkdown[^>]*markdown=\{markdown\}/);
assert.match(executionInspectorSource, /aria-controls="execution-document-outline"/);
assert.match(executionInspectorSource, /setIsOutlineOpen\(\(current\) => !current\)/);
assert.match(executionInspectorSource, /markdownHeadings\(markdown\)\.slice\(0, 12\)/);
assert.match(executionInspectorSource, /asset\?: AssetRecord/);
assert.match(executionInspectorSource, /if \(!assetPreviewUrl\) return/);
assert.match(executionInspectorSource, /setPendingHeadingAnchorId\(item\.anchorId\)/);
assert.match(executionInspectorSource, /heading\.scrollIntoView/);
assert.match(executionInspectorSource, /heading\.focus/);
assert.match(executionDetailSource, /annotatedCompositeAsset \|\| inputImages\.length/);

console.log(JSON.stringify({
  ok: true,
  safeMarkdown: true,
  selectableDocumentBody: true,
  unifiedDocumentInspector: true,
  streamingDocumentInspector: true,
  clickableOutline: true,
  outlineItems: summary.outline.length,
}));
