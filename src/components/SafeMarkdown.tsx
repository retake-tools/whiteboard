import type { ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownHeadingAnchorId } from '../core/markdownDocument';

export function SafeMarkdown({
  externalImageBlockedLabel,
  headingIdPrefix,
  markdown,
}: {
  externalImageBlockedLabel: string;
  headingIdPrefix?: string;
  markdown: string;
}): ReactElement {
  const components: Components = {
    img: ({ alt }) => (
      <span className="document-blocked-image">
        [{externalImageBlockedLabel}{alt ? `: ${alt}` : ''}]
      </span>
    ),
    a: ({ children, href }) => (
      <a href={href || undefined} target="_blank" rel="noreferrer noopener">{children}</a>
    ),
  };
  if (headingIdPrefix) {
    components.h1 = ({ children, node }) => <h1 id={headingIdForNode(headingIdPrefix, node)} tabIndex={-1}>{children}</h1>;
    components.h2 = ({ children, node }) => <h2 id={headingIdForNode(headingIdPrefix, node)} tabIndex={-1}>{children}</h2>;
    components.h3 = ({ children, node }) => <h3 id={headingIdForNode(headingIdPrefix, node)} tabIndex={-1}>{children}</h3>;
    components.h4 = ({ children, node }) => <h4 id={headingIdForNode(headingIdPrefix, node)} tabIndex={-1}>{children}</h4>;
    components.h5 = ({ children, node }) => <h5 id={headingIdForNode(headingIdPrefix, node)} tabIndex={-1}>{children}</h5>;
    components.h6 = ({ children, node }) => <h6 id={headingIdForNode(headingIdPrefix, node)} tabIndex={-1}>{children}</h6>;
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={safeMarkdownUrl}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function headingIdForNode(
  prefix: string,
  node: { position?: { start?: { line?: number } } } | undefined,
): string | undefined {
  const line = node?.position?.start?.line;
  return typeof line === 'number' ? markdownHeadingAnchorId(prefix, line) : undefined;
}

export function safeMarkdownUrl(url: string): string {
  const normalized = url.trim();
  return normalized.startsWith('#') || /^(https?:|mailto:)/i.test(normalized) ? normalized : '';
}
