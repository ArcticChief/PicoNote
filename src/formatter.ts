/**
 * PicoNote Markdown Auto-Beautifier & Table Formatter
 * Normalizes headings, list items, code fences, and aligns Markdown tables vertically.
 */

export function formatMarkdown(content: string): string {
  const lines = content.split(/\r?\n/);
  const formattedLines: string[] = [];
  let inCodeBlock = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Check code block fence
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      formattedLines.push(line.trimEnd());
      i++;
      continue;
    }

    if (inCodeBlock) {
      formattedLines.push(line);
      i++;
      continue;
    }

    // Check if start of a Markdown table block
    if (isTableLine(line) && i + 1 < lines.length && isTableDelimiterLine(lines[i + 1])) {
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      formattedLines.push(...formatTableBlock(tableLines));
      continue;
    }

    // Heading normalization (e.g. "#Heading" -> "# Heading")
    let formattedLine = line;
    const headingMatch = formattedLine.match(/^(#{1,6})([^\s#].*)$/);
    if (headingMatch) {
      formattedLine = `${headingMatch[1]} ${headingMatch[2]}`;
    }

    // List item normalization (e.g. "*item" -> "* item")
    const listMatch = formattedLine.match(/^(\s*)([*+-])([^\s*+-].*)$/);
    if (listMatch) {
      formattedLine = `${listMatch[1]}${listMatch[2]} ${listMatch[3]}`;
    }

    // Task list normalization (e.g. "-[x]item" -> "- [x] item")
    const taskMatch = formattedLine.match(/^(\s*[*+-]\s*)\[([ xX])\]([^\s].*)$/);
    if (taskMatch) {
      const check = taskMatch[2].toLowerCase() === 'x' ? 'x' : ' ';
      formattedLine = `${taskMatch[1]}[${check}] ${taskMatch[3]}`;
    }

    // Trim trailing whitespace
    formattedLines.push(formattedLine.trimEnd());
    i++;
  }

  // Remove excessive consecutive blank lines (max 2 consecutive blank lines)
  const result: string[] = [];
  let blankCount = 0;
  for (const line of formattedLines) {
    if (line.trim() === '') {
      blankCount++;
      if (blankCount <= 2) {
        result.push('');
      }
    } else {
      blankCount = 0;
      result.push(line);
    }
  }

  return result.join('\n');
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(trimmed);
}

function formatTableBlock(lines: string[]): string[] {
  const rows: string[][] = lines.map((l) => {
    let text = l.trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|')) text = text.slice(0, -1);
    return text.split('|').map((cell) => cell.trim());
  });

  if (rows.length === 0) return lines;

  const colCount = Math.max(...rows.map((r) => r.length));

  // Determine alignments from line index 1 (delimiter row)
  const alignments: ('left' | 'center' | 'right')[] = [];
  if (rows.length > 1) {
    const delimRow = rows[1];
    for (let c = 0; c < colCount; c++) {
      const cell = delimRow[c] || '';
      const alignLeft = cell.startsWith(':');
      const alignRight = cell.endsWith(':');
      if (alignLeft && alignRight) alignments.push('center');
      else if (alignRight) alignments.push('right');
      else alignments.push('left');
    }
  }

  // Calculate max width for each column (min width 3)
  const colWidths: number[] = new Array(colCount).fill(3);
  rows.forEach((row, rowIdx) => {
    if (rowIdx === 1) return;
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] || '';
      colWidths[c] = Math.max(colWidths[c], cell.length);
    }
  });

  // Reformat rows with exact padding
  const result: string[] = [];
  rows.forEach((row, rowIdx) => {
    if (rowIdx === 1) {
      const delimCells = colWidths.map((w, c) => {
        const align = alignments[c] || 'left';
        if (align === 'center') return `:${'-'.repeat(Math.max(1, w - 2))}:`;
        if (align === 'right') return `${'-'.repeat(Math.max(2, w - 1))}:`;
        return `${'-'.repeat(w)}`;
      });
      result.push(`| ${delimCells.join(' | ')} |`);
    } else {
      const contentCells = colWidths.map((w, c) => {
        const cell = row[c] || '';
        const align = alignments[c] || 'left';
        if (align === 'center') {
          const totalPad = w - cell.length;
          const leftPad = Math.floor(totalPad / 2);
          const rightPad = totalPad - leftPad;
          return ' '.repeat(leftPad) + cell + ' '.repeat(rightPad);
        } else if (align === 'right') {
          return cell.padStart(w);
        } else {
          return cell.padEnd(w);
        }
      });
      result.push(`| ${contentCells.join(' | ')} |`);
    }
  });

  return result;
}
