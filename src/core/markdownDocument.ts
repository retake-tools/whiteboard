export interface MarkdownDocumentSummary {
  characterCount: number;
  excerpt: string;
  outline: string[];
  title: string;
}

export interface MarkdownHeading {
  level: number;
  line: number;
  text: string;
}

const maxExcerptLength = 720;
const maxOutlineItems = 12;

export function summarizeMarkdown(markdown: string, fallbackTitle = 'Markdown document'): MarkdownDocumentSummary {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  const headings = markdownHeadings(normalized);
  const plainText = markdownToPlainText(normalized);
  const excerpt = plainText.length > maxExcerptLength
    ? `${plainText.slice(0, maxExcerptLength).trimEnd()}…`
    : plainText;

  return {
    characterCount: Array.from(plainText.replace(/\s/g, '')).length,
    excerpt,
    outline: headings.slice(0, maxOutlineItems).map((heading) => `${'  '.repeat(heading.level - 1)}${heading.text}`),
    title: headings[0]?.level === 1 ? headings[0].text : fallbackTitle,
  };
}

export function markdownHeadings(markdown: string): MarkdownHeading[] {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
      if (!match) return [];
      const text = inlineMarkdownToText(match[2]);
      return text ? [{ level: match[1].length, line: index + 1, text }] : [];
    });
}

export function markdownHeadingAnchorId(prefix: string, line: number): string {
  return `${prefix}-heading-${line}`;
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(`{1,3})(.*?)\1/gs, '$2')
    .replace(/[*_~]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inlineMarkdownToText(value: string): string {
  return markdownToPlainText(value).replace(/\s+/g, ' ').trim();
}
