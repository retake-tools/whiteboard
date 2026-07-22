import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function SafeMarkdown({
  externalImageBlockedLabel,
  markdown,
}: {
  externalImageBlockedLabel: string;
  markdown: string;
}): ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={safeMarkdownUrl}
      components={{
        img: ({ alt }) => (
          <span className="document-blocked-image">
            [{externalImageBlockedLabel}{alt ? `: ${alt}` : ''}]
          </span>
        ),
        a: ({ children, href }) => (
          <a href={href || undefined} target="_blank" rel="noreferrer noopener">{children}</a>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

export function safeMarkdownUrl(url: string): string {
  const normalized = url.trim();
  return normalized.startsWith('#') || /^(https?:|mailto:)/i.test(normalized) ? normalized : '';
}
