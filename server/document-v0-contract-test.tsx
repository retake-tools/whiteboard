import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown, safeMarkdownUrl } from '../src/components/SafeMarkdown';
import { summarizeMarkdown } from '../src/core/markdownDocument';

const summary = summarizeMarkdown(`# Title\n\n## Scene one\n\nHello **world**.\n\n### Shot A\n\nAction.`);
assert.equal(summary.title, 'Title');
assert.deepEqual(summary.outline, ['Title', '  Scene one', '    Shot A']);
assert.equal(summary.excerpt, 'Title\n\nScene one\n\nHello world.\n\nShot A\n\nAction.');
assert.equal(summary.characterCount, 36);

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

console.log(JSON.stringify({ ok: true, safeMarkdown: true, outlineItems: summary.outline.length }));
