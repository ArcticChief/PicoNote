import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { LanguageDescription } from '@codemirror/language';

export interface DetectedLink {
  target: string;
  type: 'url' | 'file';
}

export class CodeMirrorEditor {
  private view: EditorView;
  private languageCompartment = new Compartment();
  private themeCompartment = new Compartment();
  private readOnlyCompartment = new Compartment();
  private langToken = 0;
  private onChangeCallback?: (content: string) => void;
  private onCursorCallback?: (line: number, col: number) => void;
  private onOpenLinkCallback?: (target: string, type: 'url' | 'file') => void;
  private onPasteImageCallback?: (bytes: Uint8Array, ext: string) => void;


  constructor(container: HTMLElement, initialContent: string = '', initialPath: string = '') {
    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        history(),
        closeBrackets(),
        highlightSelectionMatches(),
        this.themeCompartment.of(oneDark),
        this.languageCompartment.of(markdown({ codeLanguages: languages })),
        this.readOnlyCompartment.of(EditorState.readOnly.of(false)),

        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && this.onChangeCallback) {
            this.onChangeCallback(update.state.doc.toString());
          }
          if (update.selectionSet && this.onCursorCallback) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            this.onCursorCallback(line.number, head - line.from + 1);
          }
        }),
        EditorView.domEventHandlers({
          paste: (e) => {

            const files = e.clipboardData?.files;
            const items = e.clipboardData?.items;
            let imageFile: File | null = null;

            if (files && files.length > 0) {
              for (let i = 0; i < files.length; i++) {
                if (files[i].type.startsWith('image/')) {
                  imageFile = files[i];
                  break;
                }
              }
            }

            if (!imageFile && items) {
              for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                  imageFile = items[i].getAsFile();
                  if (imageFile) break;
                }
              }
            }

            if (imageFile && this.onPasteImageCallback) {
              e.preventDefault();
              e.stopPropagation();
              let ext = imageFile.type.split('/')[1] || 'png';
              if (ext.includes('+') || ext.includes('svg')) ext = 'png';
              
              const cb = this.onPasteImageCallback;
              imageFile.arrayBuffer().then((buffer) => {
                const bytes = new Uint8Array(buffer);
                cb(bytes, ext);
              });
              return true;
            }
            return false;
          },
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px', fontFamily: "'Consolas', 'Cascadia Code', 'Fira Code', monospace" },

          '.cm-scroller': {
            overflow: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--scrollbar-thumb) transparent',
          },
          '.cm-scroller::-webkit-scrollbar': {
            width: '8px',
            height: '8px',
          },
          '.cm-scroller::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '.cm-scroller::-webkit-scrollbar-thumb': {
            backgroundColor: 'var(--scrollbar-thumb)',
            borderRadius: '4px',
          },
          '.cm-scroller::-webkit-scrollbar-thumb:hover': {
            backgroundColor: 'var(--scrollbar-thumb-hover)',
          },
          '.cm-gutters': { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)', borderRight: '1px solid var(--border-color)' },
        }),

      ],
    });

    this.view = new EditorView({
      state,
      parent: container,
    });

    this.setupLinkClickHandlers(container);
    this.setupPasteHandlers(container);

    if (initialPath) {
      this.setLanguageForFile(initialPath);
    }
  }

  private setupPasteHandlers(container: HTMLElement): void {
    container.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file && this.onPasteImageCallback) {
            e.preventDefault();
            e.stopPropagation();
            const ext = item.type.split('/')[1] || 'png';
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            this.onPasteImageCallback(bytes, ext);
            break;
          }
        }
      }
    });
  }

  private setupLinkClickHandlers(container: HTMLElement): void {

    container.addEventListener('mousemove', (e) => {
      if (e.ctrlKey || e.metaKey) {
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos !== null) {
          const docText = this.view.state.doc.toString();
          const link = getLinkAtPos(docText, pos);
          if (link) {
            this.view.dom.style.cursor = 'pointer';
            this.view.dom.title = `Ctrl+Click to open ${link.type === 'url' ? link.target : link.target}`;
            return;
          }
        }
      }
      this.view.dom.style.cursor = 'text';
      this.view.dom.removeAttribute('title');
    });

    container.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos !== null) {
          const docText = this.view.state.doc.toString();
          const link = getLinkAtPos(docText, pos);
          if (link && this.onOpenLinkCallback) {
            e.preventDefault();
            e.stopPropagation();
            this.onOpenLinkCallback(link.target, link.type);
          }
        }
      }
    });
  }

  public setContent(content: string, filePath: string = ''): void {
    const currentDoc = this.view.state.doc.toString();
    if (currentDoc !== content) {
      this.view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content },
      });
    }
    if (filePath) {
      this.setLanguageForFile(filePath);
    }
  }

  public getContent(): string {
    return this.view.state.doc.toString();
  }

  public async setLanguageForFile(filePath: string): Promise<void> {
    const ext = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase() : '';
    // Guard against out-of-order async loads when the user switches files quickly.
    const token = ++this.langToken;

    if (ext === '.md' || ext === '.markdown' || !ext) {
      this.view.dispatch({
        effects: this.languageCompartment.reconfigure(markdown({ codeLanguages: languages })),
      });
      return;
    }

    const langDesc = LanguageDescription.matchFilename(languages, filePath);
    if (langDesc) {
      const support = await langDesc.load();
      if (token !== this.langToken) return; // a newer file was opened meanwhile
      this.view.dispatch({
        effects: this.languageCompartment.reconfigure(support),
      });
    } else {
      this.view.dispatch({
        effects: this.languageCompartment.reconfigure([]),
      });
    }
  }

  public setTheme(isDark: boolean): void {
    this.view.dispatch({
      effects: this.themeCompartment.reconfigure(isDark ? oneDark : []),
    });
  }

  public setReadOnly(readOnly: boolean): void {
    this.view.dispatch({
      effects: this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }


  public setOnChange(callback: (content: string) => void): void {
    this.onChangeCallback = callback;
  }

  public setOnCursorChange(callback: (line: number, col: number) => void): void {
    this.onCursorCallback = callback;
  }

  public setOnOpenLink(callback: (target: string, type: 'url' | 'file') => void): void {
    this.onOpenLinkCallback = callback;
  }

  public setOnPasteImage(callback: (bytes: Uint8Array, ext: string) => void): void {
    this.onPasteImageCallback = callback;
  }

  public insertTextAtCursor(text: string): void {
    const mainSel = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from: mainSel.from, to: mainSel.to, insert: text },
      selection: { anchor: mainSel.from + text.length },
    });
  }


  public focus(): void {
    this.view.focus();
  }

  public scrollLineIntoView(line: number): void {
    const docLine = this.view.state.doc.line(Math.min(line, this.view.state.doc.lines));
    this.view.dispatch({
      selection: { anchor: docLine.from },
      scrollIntoView: true,
    });
    this.focus();
  }

  public applyFormatting(type: string): void {
    const sel = this.view.state.selection.main;
    const selectedText = this.view.state.sliceDoc(sel.from, sel.to);

    let replacement = '';
    let anchorOffset = 0;
    let headOffset = 0;

    switch (type) {
      case 'bold':
        if (selectedText) {
          replacement = `**${selectedText}**`;
          anchorOffset = 2;
          headOffset = replacement.length - 2;
        } else {
          replacement = `****`;
          anchorOffset = 2;
          headOffset = 2;
        }
        break;
      case 'italic':
        if (selectedText) {
          replacement = `*${selectedText}*`;
          anchorOffset = 1;
          headOffset = replacement.length - 1;
        } else {
          replacement = `**`;
          anchorOffset = 1;
          headOffset = 1;
        }
        break;
      case 'strike':
        if (selectedText) {
          replacement = `~~${selectedText}~~`;
          anchorOffset = 2;
          headOffset = replacement.length - 2;
        } else {
          replacement = `~~~~`;
          anchorOffset = 2;
          headOffset = 2;
        }
        break;
      case 'h1':
        replacement = `# ${selectedText}`;
        anchorOffset = replacement.length;
        headOffset = replacement.length;
        break;
      case 'h2':
        replacement = `## ${selectedText}`;
        anchorOffset = replacement.length;
        headOffset = replacement.length;
        break;
      case 'h3':
        replacement = `### ${selectedText}`;
        anchorOffset = replacement.length;
        headOffset = replacement.length;
        break;
      case 'code':
        if (selectedText.includes('\n')) {
          replacement = `\`\`\`\n${selectedText}\n\`\`\``;
          anchorOffset = 4;
          headOffset = 4 + selectedText.length;
        } else if (selectedText) {
          replacement = `\`${selectedText}\``;
          anchorOffset = 1;
          headOffset = replacement.length - 1;
        } else {
          replacement = `\`\``;
          anchorOffset = 1;
          headOffset = 1;
        }
        break;
      case 'link':
        if (selectedText) {
          replacement = `[${selectedText}](https://)`;
          anchorOffset = selectedText.length + 3;
          headOffset = replacement.length - 1;
        } else {
          replacement = `[link](https://)`;
          anchorOffset = 1;
          headOffset = 5;
        }
        break;
      case 'task':
        replacement = `- [ ] ${selectedText}`;
        anchorOffset = replacement.length;
        headOffset = replacement.length;
        break;
      case 'quote':
        replacement = `> ${selectedText}`;
        anchorOffset = replacement.length;
        headOffset = replacement.length;
        break;
      case 'table':
        this.insertTable(3, 3);
        return;
    }

    if (replacement) {
      this.view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: replacement },
        selection: { anchor: sel.from + anchorOffset, head: sel.from + headOffset },
      });
      this.view.focus();
    }
  }

  public insertTable(cols: number = 3, rows: number = 3): void {

    const sel = this.view.state.selection.main;
    let headerRow = '| ';
    let dividerRow = '| ';

    for (let c = 1; c <= cols; c++) {
      headerRow += `Header ${c} | `;
      dividerRow += `-------- | `;
    }

    let tableText = `\n${headerRow.trim()}\n${dividerRow.trim()}\n`;

    let cellCounter = 1;
    for (let r = 1; r <= rows; r++) {
      let rowText = '| ';
      for (let c = 1; c <= cols; c++) {
        rowText += `Cell ${cellCounter++} | `;
      }
      tableText += `${rowText.trim()}\n`;
    }

    this.view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: tableText },
      selection: { anchor: sel.from + tableText.length, head: sel.from + tableText.length },
    });
    this.view.focus();
  }

  public destroy(): void {
    this.view.destroy();
  }
}



function getLinkAtPos(docText: string, pos: number): DetectedLink | null {
  const lineStart = docText.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = docText.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = docText.length;
  const lineText = docText.slice(lineStart, lineEnd);
  const offset = pos - lineStart;

  // 1. Web URLs (https://... or http://...)
  const urlRegex = /https?:\/\/[^\s\)\]\>]+/g;
  let match;
  while ((match = urlRegex.exec(lineText)) !== null) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      return { target: match[0], type: 'url' };
    }
  }

  // 2. Markdown links [text](url_or_path)
  const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = mdLinkRegex.exec(lineText)) !== null) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      const linkTarget = match[2].trim();
      const isWeb = linkTarget.startsWith('http://') || linkTarget.startsWith('https://');
      return { target: linkTarget, type: isWeb ? 'url' : 'file' };
    }
  }

  // 3. WikiLinks [[Note Name]]
  const wikiRegex = /\[\[([^\]]+)\]\]/g;
  while ((match = wikiRegex.exec(lineText)) !== null) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      let target = match[1].trim();
      if (target.includes('|')) {
        target = target.split('|')[0].trim();
      }
      if (!target.endsWith('.md')) target += '.md';
      return { target, type: 'file' };
    }
  }

  return null;
}
