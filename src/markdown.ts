import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { TocItem } from './types';
import { escapeHtml } from './util';


// Configure marked with GFM options
marked.setOptions({
  gfm: true,
  breaks: true,
});

export interface MarkdownParseResult {
  html: string;
  frontmatter: Record<string, string> | null;
  toc: TocItem[];
}

export function parseMarkdown(content: string, baseFolder?: string | null): MarkdownParseResult {
  let markdownText = content;
  let frontmatter: Record<string, string> | null = null;

  // Extract YAML frontmatter if present (--- ... ---)
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    frontmatter = {};
    const yamlLines = frontmatterMatch[1].split(/\r?\n/);
    for (const line of yamlLines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim();
        if (key) {
          frontmatter[key] = value;
        }
      }
    }
    markdownText = content.slice(frontmatterMatch[0].length).trimStart();
  }

  // Extract TOC outline items
  const toc: TocItem[] = [];
  const lines = markdownText.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[\*\_\`]/g, '').trim();
      const id = 'heading-' + index + '-' + text.toLowerCase().replace(/[^\w]+/g, '-');
      toc.push({ level, text, id, line: index + 1 });
    }
  });

  // Render HTML via marked
  const rawHtml = marked.parse(markdownText) as string;
  let sanitizedHtml = DOMPurify.sanitize(rawHtml);

  // Tag relative image URLs for async Blob URL resolution
  if (baseFolder) {
    sanitizedHtml = sanitizedHtml.replace(/<img\s+([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, before, src, after) => {
      if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
        const normalizedSrc = src.replace(/\//g, '\\');
        const fullImagePath = src.includes(':') ? src : `${baseFolder}\\${normalizedSrc}`;
        return `<img ${before}data-local-path="${encodeURIComponent(fullImagePath)}" src=""${after}>`;
      }
      return match;
    });
  }


  return {
    html: sanitizedHtml,
    frontmatter,
    toc,
  };
}


export function renderFrontmatterHtml(frontmatter: Record<string, string>): string {
  const rows = Object.entries(frontmatter)
    .map(
      ([k, v]) =>
        `<tr><td class="fm-key">${escapeHtml(k)}</td><td class="fm-val">${escapeHtml(v)}</td></tr>`
    )
    .join('');
  return `<div class="frontmatter-card"><div class="frontmatter-title">META DATA (FRONTMATTER)</div><table class="frontmatter-table">${rows}</table></div>`;
}
