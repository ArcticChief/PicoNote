import { api } from './api';

import { CodeMirrorEditor } from './editor';
import { FileExplorer } from './explorer';
import { parseMarkdown, renderFrontmatterHtml } from './markdown';
import { CommandPalette } from './palette';
import { SpotlightSearch } from './spotlight';
import { TabManager } from './tabs';
import { ThemeManager } from './theme';
import { Tab } from './types';



class PicoNoteApp {
  private editor!: CodeMirrorEditor;
  private tabManager!: TabManager;
  private themeManager!: ThemeManager;
  private palette!: CommandPalette;
  private spotlight!: SpotlightSearch;
  private explorer!: FileExplorer;
  private editor2: CodeMirrorEditor | null = null;
  private isSplitView: boolean = false;
  private pane2Path: string | null = null;
  private autoSaveEnabled: boolean = true;
  private autoSaveTimer: any = null;


  private diaryEditor: CodeMirrorEditor | null = null;
  private currentDiaryDate: Date = new Date();
  private diaryAutoSaveTimer: any = null;


  private previewVisible: boolean = false;
  private outlineVisible: boolean = false;
  private sidebarVisible: boolean = true;

  private editorContainer: HTMLElement;
  private mdPreviewContainer: HTMLElement;
  private outlineDrawer: HTMLElement;
  private outlineList: HTMLElement;
  private welcomeScreen: HTMLElement;
  private setupModal: HTMLElement;
  private tabsContainer: HTMLElement;

  private statusFilename: HTMLElement;
  private statusCursor: HTMLElement;
  private statusLang: HTMLElement;

  constructor() {
    this.editorContainer = document.getElementById('editor-container') as HTMLElement;
    this.mdPreviewContainer = document.getElementById('md-preview') as HTMLElement;
    this.outlineDrawer = document.getElementById('outline-drawer') as HTMLElement;
    this.outlineList = document.getElementById('outline-list') as HTMLElement;
    this.welcomeScreen = document.getElementById('welcome-screen') as HTMLElement;
    this.setupModal = document.getElementById('setup-modal') as HTMLElement;
    this.tabsContainer = document.getElementById('tabs-container') as HTMLElement;

    this.statusFilename = document.getElementById('status-filename') as HTMLElement;
    this.statusCursor = document.getElementById('status-cursor') as HTMLElement;
    this.statusLang = document.getElementById('status-lang') as HTMLElement;

    this.init();
  }

  private async init(): Promise<void> {
    this.themeManager = new ThemeManager();

    this.editor = new CodeMirrorEditor(this.editorContainer);
    this.editor.setTheme(this.themeManager.getTheme() === 'dark');
    this.editor.setOnChange((content) => this.handleDocChange(content));


    this.tabManager = new TabManager(
      (activeTab) => this.onActiveTabChanged(activeTab),
      (tabs) => this.renderTabs(tabs)
    );

    this.explorer = new FileExplorer(
      'file-explorer',
      'folder-path-input',
      'explorer-search-input',
      (filePath) => this.openFileByPath(filePath)
    );

    this.palette = new CommandPalette();
    this.spotlight = new SpotlightSearch(
      () => this.explorer.getCurrentFolder(),
      async (path, lineNumber) => {
        await this.openFileByPath(path);
        if (lineNumber > 1) {
          this.editor.scrollLineIntoView(lineNumber);
        }
      }
    );

    this.setupCommands();
    this.setupEventListeners();

    // Check for saved Main Workspace Folder Entry Point
    const savedMainFolder = localStorage.getItem('piconote-main-folder');
    if (savedMainFolder) {
      const exists = await api.pathExists(savedMainFolder);
      if (exists) {
        await this.explorer.openFolder(savedMainFolder);
        this.setupModal.classList.add('hidden');
      } else {
        this.showSetupModal();
      }
    } else {
      this.showSetupModal();
    }

    // Check for file opened from command line / Windows Explorer double-click
    const cliFile = await api.getCliFile();
    if (cliFile) {
      await this.openFileByPath(cliFile);
    } else {
      this.newFile();
    }
  }




  private showSetupModal(): void {
    this.setupModal.classList.remove('hidden');
  }

  private setupEventListeners(): void {
    // Titlebar window controls & dragging via native Rust IPC
    const btnMin = document.getElementById('titlebar-minimize');
    const btnMax = document.getElementById('titlebar-maximize');
    const btnClose = document.getElementById('titlebar-close');

    btnMin?.addEventListener('click', (e) => {
      e.stopPropagation();
      api.windowMinimize();
    });

    btnMax?.addEventListener('click', (e) => {
      e.stopPropagation();
      api.windowToggleMaximize();
    });

    btnClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      api.windowClose();
    });

    document.getElementById('titlebar')?.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (e.buttons === 1 && !target.closest('.titlebar-controls') && !target.closest('.titlebar-btn')) {
        api.windowStartDrag();
      }
    });



    // Setup modal button
    document.getElementById('btn-select-main-folder')?.addEventListener('click', async () => {

      await this.setMainWorkspaceFolder();
    });

    // Editor listeners
    this.editor.setOnChange((content) => {
      this.tabManager.updateActiveContent(content);
      this.updateMarkdownPreview(content);
      this.updateOutline(content);
    });

    this.editor.setOnCursorChange((line, col) => {
      this.statusCursor.textContent = `Ln ${line}, Col ${col}`;
    });

    this.editor.setOnOpenLink((target, type) => {
      if (type === 'url') {
        api.openUrl(target);
      } else {
        const mainFolder = this.explorer.getCurrentFolder();
        let fullPath = target;
        if (mainFolder && !target.includes(':') && !target.startsWith('/') && !target.startsWith('\\')) {
          fullPath = `${mainFolder}\\${target}`;
        }
        this.openFileByPath(fullPath);
      }
    });

    this.editor.setOnPasteImage(async (bytes, ext) => {
      const activeTab = this.tabManager.getActiveTab();
      let mainFolder = this.explorer.getCurrentFolder() || localStorage.getItem('piconote-main-folder');

      let noteDir = mainFolder;
      if (activeTab && activeTab.path) {
        const lastSlash = Math.max(activeTab.path.lastIndexOf('\\'), activeTab.path.lastIndexOf('/'));
        if (lastSlash !== -1) {
          noteDir = activeTab.path.substring(0, lastSlash);
        }
      }

      if (!noteDir) {
        alert('Please open or select a workspace folder first to save pasted images.');
        return;
      }

      const filename = `image-${Date.now()}.${ext}`;
      const relativePath = `assets/${filename}`;
      const fullPath = `${noteDir}\\assets\\${filename}`;

      try {
        await api.saveBinaryFile(fullPath, bytes);
        this.editor.insertTextAtCursor(`![Image](${relativePath})\n`);
        if (this.explorer.getCurrentFolder()) {
          this.explorer.refresh();
        }

        // Auto-toggle live preview panel so user instantly sees the image!
        if (!this.previewVisible) {
          this.togglePreview();
        } else {
          const cur = this.tabManager.getActiveTab();
          if (cur) this.updateMarkdownPreview(cur.content);
        }
      } catch (err: any) {
        alert(`Failed to save pasted image: ${err}`);
      }
    });




    // Preview close button
    document.getElementById('btn-close-preview')?.addEventListener('click', () => this.togglePreview());

    // Editor & Preview Resizer Divider
    const resizer = document.getElementById('preview-resizer');
    const workspace = document.getElementById('workspace');
    let isResizing = false;

    resizer?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing || !workspace) return;
      const rect = workspace.getBoundingClientRect();
      const newWidth = rect.right - e.clientX;
      const clampedWidth = Math.max(180, Math.min(newWidth, rect.width - 180));
      this.mdPreviewContainer.style.width = `${clampedWidth}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer?.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // Split View Resizer Dragging
    const splitResizer = document.getElementById('split-resizer');
    const editorPane1 = document.getElementById('editor-container');
    let isSplitResizing = false;

    splitResizer?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isSplitResizing = true;
      splitResizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (isSplitResizing && workspace && editorPane1) {
        const rect = workspace.getBoundingClientRect();
        const leftOffset = e.clientX - rect.left;
        const clampedWidth = Math.max(200, Math.min(leftOffset, rect.width - 200));
        editorPane1.style.width = `${clampedWidth}px`;
        editorPane1.style.flex = 'none';
      }
    });

    window.addEventListener('mouseup', () => {
      if (isSplitResizing) {
        isSplitResizing = false;
        splitResizer?.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // Split Pane Controls
    document.getElementById('btn-close-split')?.addEventListener('click', () => this.toggleSplitView());
    document.getElementById('split-pane-file-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val) this.openInPane2(val);
    });

    // Buttons
    document.getElementById('btn-open-folder')?.addEventListener('click', () => this.openFolderDialog());
    document.getElementById('btn-new-file')?.addEventListener('click', () => this.newFile());


    document.getElementById('btn-new-folder')?.addEventListener('click', async () => {
      const folder = this.explorer.getCurrentFolder();
      if (!folder) {
        alert('Please open a workspace folder first.');
        return;
      }
      const folderName = prompt('Enter new folder name:');
      if (folderName) {
        await api.createFolder(`${folder}\\${folderName}`);
        await this.explorer.refresh();
      }
    });

    document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
      this.explorer.toggleCollapseExpandAll();
    });

    // Formatting Toolbar Buttons (prevent editor focus loss on mousedown)
    document.querySelectorAll('.fmt-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const fmt = (e.currentTarget as HTMLElement).getAttribute('data-fmt');
        if (fmt === 'table') {
          const colsInput = prompt('Enter number of columns:', '3');
          if (colsInput === null) return;
          const rowsInput = prompt('Enter number of rows:', '3');
          if (rowsInput === null) return;

          const cols = Math.max(1, Math.min(parseInt(colsInput, 10) || 3, 20));
          const rows = Math.max(1, Math.min(parseInt(rowsInput, 10) || 3, 50));
          this.editor.insertTable(cols, rows);
        } else if (fmt) {
          this.editor.applyFormatting(fmt);
        }
      });

    });


    // Minimal Daily Diary Sidebar Row & Centered Modal Controls
    const now = new Date();
    const diaryBadge = document.getElementById('diary-date-badge');
    if (diaryBadge) {
      diaryBadge.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    document.getElementById('btn-open-diary')?.addEventListener('click', () => this.openDiaryModal());
    document.getElementById('diary-modal-close')?.addEventListener('click', () => {
      document.getElementById('diary-modal')?.classList.add('hidden');
    });

    document.getElementById('diary-prev-day')?.addEventListener('click', () => {
      const prev = new Date(this.currentDiaryDate);
      prev.setDate(prev.getDate() - 1);
      this.openDiaryModal(prev);
    });

    document.getElementById('diary-next-day')?.addEventListener('click', () => {
      const next = new Date(this.currentDiaryDate);
      next.setDate(next.getDate() + 1);
      this.openDiaryModal(next);
    });

    document.getElementById('diary-today')?.addEventListener('click', () => {
      this.openDiaryModal(new Date());
    });

    document.getElementById('diary-modal-save')?.addEventListener('click', async () => {
      if (this.diaryEditor) {
        const rootFolder = this.explorer.getCurrentFolder() || localStorage.getItem('piconote-main-folder');
        if (rootFolder) {
          const d = this.currentDiaryDate;
          const year = d.getFullYear().toString();
          const monthNum = String(d.getMonth() + 1).padStart(2, '0');
          const monthName = d.toLocaleString('en-US', { month: 'long' });
          const monthFolder = `${monthNum}-${monthName}`;
          const dayNum = String(d.getDate()).padStart(2, '0');
          const dayName = d.toLocaleString('en-US', { weekday: 'long' });
          const fullPath = `${rootFolder}\\Journal\\${year}\\${monthFolder}\\${year}-${monthNum}-${dayNum}_${dayName}.md`;
          await api.writeFile(fullPath, this.diaryEditor.getContent());
          const statusEl = document.getElementById('diary-modal-status');
          if (statusEl) statusEl.textContent = 'Saved manually';
        }
      }
    });

    document.getElementById('btn-preview-toggle')?.addEventListener('click', () => this.togglePreview());

    document.getElementById('btn-outline-toggle')?.addEventListener('click', () => this.toggleOutline());
    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => this.toggleTheme());


    document.getElementById('welcome-open-folder')?.addEventListener('click', () => this.setMainWorkspaceFolder());
    document.getElementById('welcome-open-file')?.addEventListener('click', () => this.openFileDialog());
    document.getElementById('welcome-new-file')?.addEventListener('click', () => this.newFile());

    // Tab scroll buttons
    document.getElementById('btn-tab-scroll-left')?.addEventListener('click', () => {
      this.tabsContainer.scrollBy({ left: -220, behavior: 'smooth' });
    });

    document.getElementById('btn-tab-scroll-right')?.addEventListener('click', () => {
      this.tabsContainer.scrollBy({ left: 220, behavior: 'smooth' });
    });

    // All open tabs dropdown menu button
    const allTabsBtn = document.getElementById('btn-all-tabs');
    const allTabsDropdown = document.getElementById('all-tabs-dropdown');
    const allTabsSearch = document.getElementById('all-tabs-search') as HTMLInputElement;

    allTabsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      allTabsDropdown?.classList.toggle('hidden');
      if (!allTabsDropdown?.classList.contains('hidden')) {
        allTabsSearch.value = '';
        allTabsSearch.focus();
        this.renderAllTabsDropdown('');
      }
    });

    allTabsSearch?.addEventListener('input', () => {
      this.renderAllTabsDropdown(allTabsSearch.value.trim().toLowerCase());
    });

    document.addEventListener('click', (e) => {
      if (allTabsDropdown && !allTabsDropdown.contains(e.target as Node) && e.target !== allTabsBtn) {
        allTabsDropdown.classList.add('hidden');
      }
    });

    // Mouse wheel horizontal scrolling for tab bar
    this.tabsContainer.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        this.tabsContainer.scrollLeft += e.deltaY;
      }
    });


    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('diary-modal')?.classList.add('hidden');
      }

      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        this.openDiaryModal();
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'k' || e.key === 'K') {
          e.preventDefault();
          this.spotlight.toggle();
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          this.palette.toggle();
        } else if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          this.newFile();
        } else if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          if (e.shiftKey) {
            this.setMainWorkspaceFolder();
          } else {
            this.openFileDialog();
          }
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          if (e.shiftKey) {
            this.saveFileAs();
          } else {
            this.saveFile();
          }
        } else if (e.key === 'w' || e.key === 'W') {
          e.preventDefault();
          const active = this.tabManager.getActiveTab();
          if (active) this.tabManager.closeTab(active.id);
        } else if (e.key === 'b' || e.key === 'B') {
          e.preventDefault();
          this.toggleSidebar();
        } else if (e.shiftKey && (e.key === 'm' || e.key === 'M')) {
          e.preventDefault();
          this.togglePreview();
        } else if (e.shiftKey && (e.key === 't' || e.key === 'T')) {
          e.preventDefault();
          this.toggleTheme();
        }
      }
    });
  }


  private setupCommands(): void {
    this.palette.registerCommands([
      { id: 'spotlight-search', label: 'Workspace: Global Spotlight Search...', shortcut: 'Ctrl+K', action: () => this.spotlight.show() },
      { id: 'daily-journal', label: 'Journal: Open / Create Today\'s Daily Journal', shortcut: 'Ctrl+Alt+N', action: () => this.openDiaryModal() },

      { id: 'split-view', label: 'View: Toggle Split Editor Pane', shortcut: 'Ctrl+\\', action: () => this.toggleSplitView() },
      { id: 'set-main-folder', label: 'Workspace: Set Main Folder (Entry Point)...', shortcut: 'Ctrl+Shift+O', action: () => this.setMainWorkspaceFolder() },
      { id: 'new-file', label: 'File: New File', shortcut: 'Ctrl+N', action: () => this.newFile() },
      { id: 'open-file', label: 'File: Open File...', shortcut: 'Ctrl+O', action: () => this.openFileDialog() },
      { id: 'save-file', label: 'File: Save', shortcut: 'Ctrl+S', action: () => this.saveFile() },
      { id: 'save-file-as', label: 'File: Save As...', shortcut: 'Ctrl+Shift+S', action: () => this.saveFileAs() },
      { id: 'toggle-preview', label: 'View: Toggle Markdown Preview', shortcut: 'Ctrl+Shift+M', action: () => this.togglePreview() },
      { id: 'toggle-outline', label: 'View: Toggle Heading Outline', action: () => this.toggleOutline() },
      { id: 'toggle-theme', label: 'View: Toggle Theme (Dark/Light)', shortcut: 'Ctrl+Shift+T', action: () => this.toggleTheme() },
      { id: 'toggle-sidebar', label: 'View: Toggle Sidebar', shortcut: 'Ctrl+B', action: () => this.toggleSidebar() },
    ]);
  }

  private async setMainWorkspaceFolder(): Promise<void> {
    const selected = await api.showOpenFolderDialog();
    if (selected) {
      localStorage.setItem('piconote-main-folder', selected);
      await this.explorer.openFolder(selected);
      this.setupModal.classList.add('hidden');
    }
  }

  private isImageFile(filename: string): boolean {
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext);
  }

  private async openFileByPath(filePath: string): Promise<void> {
    try {
      const filename = filePath.replace(/\\/g, '/').split('/').pop() || 'file';
      if (this.isImageFile(filename)) {
        this.tabManager.openTab(filePath, filename, `[IMAGE_VIEWER:${filePath}]`);
        return;
      }

      const content = await api.readFile(filePath);
      this.tabManager.openTab(filePath, filename, content);
    } catch (err: any) {
      alert(`Could not open file: ${err}`);
    }
  }

  private async openFileDialog(): Promise<void> {
    const selected = await api.showOpenFileDialog();
    if (selected) {
      await this.openFileByPath(selected);
    }
  }

  private async openFolderDialog(): Promise<void> {
    await this.setMainWorkspaceFolder();
  }

  private newFile(): void {
    this.tabManager.openTab(null, 'untitled.md', '# Untitled Note\n\nStart writing in markdown...');
  }

  private async saveFile(): Promise<void> {
    const active = this.tabManager.getActiveTab();
    if (!active) return;

    if (active.path) {
      await api.writeFile(active.path, active.content);
      this.tabManager.markActiveSaved();
    } else {
      await this.saveFileAs();
    }
  }

  private async saveFileAs(): Promise<void> {
    const active = this.tabManager.getActiveTab();
    if (!active) return;

    const selectedPath = await api.showSaveFileDialog(active.name);
    if (selectedPath) {
      await api.writeFile(selectedPath, active.content);
      const newName = selectedPath.replace(/\\/g, '/').split('/').pop() || active.name;
      this.tabManager.markActiveSaved(selectedPath, newName);
      if (this.explorer.getCurrentFolder()) {
        await this.explorer.refresh();
      }
    }
  }

  private togglePreview(): void {
    this.previewVisible = !this.previewVisible;
    const btn = document.getElementById('btn-preview-toggle');
    const resizer = document.getElementById('preview-resizer');
    if (this.previewVisible) {
      this.mdPreviewContainer.classList.remove('hidden');
      resizer?.classList.remove('hidden');
      btn?.classList.add('active');
      const active = this.tabManager.getActiveTab();
      if (active) this.updateMarkdownPreview(active.content);
    } else {
      this.mdPreviewContainer.classList.add('hidden');
      resizer?.classList.add('hidden');
      btn?.classList.remove('active');
    }
  }


  private toggleOutline(): void {
    this.outlineVisible = !this.outlineVisible;
    const btn = document.getElementById('btn-outline-toggle');
    if (this.outlineVisible) {
      this.outlineDrawer.classList.remove('hidden');
      btn?.classList.add('active');
      const active = this.tabManager.getActiveTab();
      if (active) this.updateOutline(active.content);
    } else {
      this.outlineDrawer.classList.add('hidden');
      btn?.classList.remove('active');
    }
  }

  private toggleTheme(): void {
    const theme = this.themeManager.toggle();
    this.editor.setTheme(theme === 'dark');
  }

  private toggleSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      this.sidebarVisible = !this.sidebarVisible;
      sidebar.style.display = this.sidebarVisible ? 'flex' : 'none';
    }
  }

  private onActiveTabChanged(activeTab: Tab | null): void {
    const titlebarDoc = document.getElementById('titlebar-doc-name');
    const imageViewer = document.getElementById('image-viewer');
    const imageImg = document.getElementById('image-viewer-img') as HTMLImageElement;
    const imageInfo = document.getElementById('image-viewer-info');

    if (!activeTab) {
      this.welcomeScreen.style.display = 'flex';
      this.editorContainer.style.display = 'block';
      if (imageViewer) imageViewer.classList.add('hidden');
      this.statusFilename.textContent = 'No file open';
      this.statusLang.textContent = 'Plain Text';
      if (titlebarDoc) titlebarDoc.textContent = 'PicoNote Studio';
      return;
    }

    this.welcomeScreen.style.display = 'none';
    this.statusFilename.textContent = activeTab.name + (activeTab.isDirty ? ' ●' : '');
    this.statusLang.textContent = activeTab.language;
    if (titlebarDoc) titlebarDoc.textContent = `${activeTab.name}${activeTab.isDirty ? ' ●' : ''} — PicoNote`;

    if (activeTab.content.startsWith('[IMAGE_VIEWER:')) {
      const filePath = activeTab.content.slice(14, -1);
      this.editorContainer.style.display = 'none';
      if (imageViewer) imageViewer.classList.remove('hidden');

      api.getImageDataUrl(filePath).then((dataUrl) => {
        if (imageImg) {
          imageImg.src = dataUrl;
          imageImg.onload = () => {
            if (imageInfo) {
              imageInfo.textContent = `${activeTab.name} — ${imageImg.naturalWidth} × ${imageImg.naturalHeight} px`;
            }
          };
        }
      }).catch((err) => {
        if (imageInfo) imageInfo.textContent = `Error loading image: ${err}`;
      });
      return;
    }

    const fmtBar = document.getElementById('formatting-toolbar');
    const ext = activeTab ? (activeTab.name.includes('.') ? activeTab.name.slice(activeTab.name.lastIndexOf('.')).toLowerCase() : '') : '';
    const isMd = ext === '.md' || ext === '.markdown' || !ext;
    if (fmtBar) {
      if (activeTab && isMd && !activeTab.content.startsWith('[IMAGE_VIEWER:')) {
        fmtBar.classList.remove('hidden');
      } else {
        fmtBar.classList.add('hidden');
      }
    }

    this.editorContainer.style.display = 'block';
    if (imageViewer) imageViewer.classList.add('hidden');

    this.editor.setContent(activeTab.content, activeTab.path || activeTab.name);
    if (this.previewVisible) this.updateMarkdownPreview(activeTab.content);
    if (this.outlineVisible) this.updateOutline(activeTab.content);
    if (this.isSplitView) this.populateSplitFileSelect();
  }





  private getTabFileIcon(filename: string): string {
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
    const mdSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
    const codeSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
    const configSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
    const fileSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;

    if (ext === '.md' || ext === '.markdown') return mdSvg;
    if (['.js', '.ts', '.jsx', '.tsx', '.py', '.rs', '.go', '.c', '.cpp', '.h', '.sh', '.html', '.css'].includes(ext)) return codeSvg;
    if (['.json', '.yaml', '.yml', '.toml', '.xml'].includes(ext)) return configSvg;
    return fileSvg;
  }

  private renderTabs(tabs: Tab[]): void {
    this.tabsContainer.innerHTML = '';
    const active = this.tabManager.getActiveTab();

    const allTabsText = document.getElementById('btn-all-tabs-text');
    if (allTabsText) {
      allTabsText.textContent = `Tabs (${tabs.length})`;
    }


    tabs.forEach((tab) => {
      const el = document.createElement('div');
      el.className = `tab ${active && active.id === tab.id ? 'active' : ''} ${tab.pinned ? 'pinned' : ''}`;
      if (tab.colorTag) {
        el.setAttribute('data-color-tag', tab.colorTag);
      }

      const icon = this.getTabFileIcon(tab.name);
      el.innerHTML = `
        <span class="tab-icon">${icon}</span>
        <span>${tab.name}</span>
        ${tab.pinned ? '<span class="tab-pin-icon" title="Pinned">📌</span>' : ''}
        ${tab.isDirty ? '<span class="tab-dot" title="Unsaved changes"></span>' : ''}
        ${!tab.pinned ? `<span class="tab-close" data-id="${tab.id}">&times;</span>` : ''}
      `;

      el.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('tab-close')) {
          e.stopPropagation();
          this.tabManager.closeTab(tab.id);
        } else {
          this.tabManager.setActiveTab(tab.id);
        }
      });

      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showTabContextMenu(e.clientX, e.clientY, tab);
      });

      this.tabsContainer.appendChild(el);
    });

    // Auto-scroll active tab into view so active tab is never hidden off-screen
    setTimeout(() => {
      const activeEl = this.tabsContainer.querySelector('.tab.active') as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      }
    }, 50);
  }

  private renderAllTabsDropdown(query: string = ''): void {
    const listEl = document.getElementById('all-tabs-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const tabs = this.tabManager.getTabs();
    const active = this.tabManager.getActiveTab();

    const filtered = tabs.filter(
      (t) => t.name.toLowerCase().includes(query) || (t.path && t.path.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="welcome-msg">No matching open tabs</div>';
      return;
    }

    filtered.forEach((tab) => {
      const item = document.createElement('div');
      item.className = `tabs-dropdown-item ${active && active.id === tab.id ? 'active' : ''}`;
      const icon = this.getTabFileIcon(tab.name);

      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <span>${icon}</span>
          <span style="font-weight:600; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${tab.name}</span>
          ${tab.pinned ? '📌' : ''}
          ${tab.isDirty ? '●' : ''}
        </div>
        <span class="tab-close" data-id="${tab.id}">&times;</span>
      `;

      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('tab-close')) {
          e.stopPropagation();
          this.tabManager.closeTab(tab.id);
          this.renderAllTabsDropdown(query);
        } else {
          this.tabManager.setActiveTab(tab.id);
          document.getElementById('all-tabs-dropdown')?.classList.add('hidden');
        }
      });

      listEl.appendChild(item);
    });
  }


  private showTabContextMenu(x: number, y: number, tab: Tab): void {
    const existing = document.getElementById('context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'context-menu';

    menu.innerHTML = `
      <div class="ctx-item" id="tab-ctx-pin">${tab.pinned ? '📌 Unpin Tab' : '📌 Pin Tab'}</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" id="tab-ctx-color-purple">🟣 Purple Tag</div>
      <div class="ctx-item" id="tab-ctx-color-blue">🔵 Blue Tag</div>
      <div class="ctx-item" id="tab-ctx-color-green">🟢 Green Tag</div>
      <div class="ctx-item" id="tab-ctx-color-amber">🟠 Amber Tag</div>
      <div class="ctx-item" id="tab-ctx-color-red">🔴 Red Tag</div>
      <div class="ctx-item" id="tab-ctx-color-none">⚪ Remove Color Tag</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" id="tab-ctx-close-others">🚫 Close Other Tabs</div>
      <div class="ctx-item" id="tab-ctx-close-right">➡️ Close Tabs to Right</div>
      <div class="ctx-item danger" id="tab-ctx-close">❌ Close Tab</div>
    `;

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    const margin = 10;

    let posX = x;
    let posY = y;

    if (posX + rect.width > window.innerWidth - margin) {
      posX = window.innerWidth - rect.width - margin;
    }
    if (posY + rect.height > window.innerHeight - margin) {
      posY = window.innerHeight - rect.height - margin;
    }

    menu.style.left = `${Math.max(margin, posX)}px`;
    menu.style.top = `${Math.max(margin, posY)}px`;

    const closeCtx = () => menu.remove();
    setTimeout(() => document.addEventListener('click', closeCtx, { once: true }), 10);


    menu.querySelector('#tab-ctx-pin')?.addEventListener('click', () => {
      this.tabManager.togglePin(tab.id);
    });
    menu.querySelector('#tab-ctx-color-purple')?.addEventListener('click', () => {
      this.tabManager.setColorTag(tab.id, 'purple');
    });
    menu.querySelector('#tab-ctx-color-blue')?.addEventListener('click', () => {
      this.tabManager.setColorTag(tab.id, 'blue');
    });
    menu.querySelector('#tab-ctx-color-green')?.addEventListener('click', () => {
      this.tabManager.setColorTag(tab.id, 'green');
    });
    menu.querySelector('#tab-ctx-color-amber')?.addEventListener('click', () => {
      this.tabManager.setColorTag(tab.id, 'amber');
    });
    menu.querySelector('#tab-ctx-color-red')?.addEventListener('click', () => {
      this.tabManager.setColorTag(tab.id, 'red');
    });
    menu.querySelector('#tab-ctx-color-none')?.addEventListener('click', () => {
      this.tabManager.setColorTag(tab.id, undefined);
    });
    menu.querySelector('#tab-ctx-close-others')?.addEventListener('click', () => {
      this.tabManager.closeOtherTabs(tab.id);
    });
    menu.querySelector('#tab-ctx-close-right')?.addEventListener('click', () => {
      this.tabManager.closeTabsToRight(tab.id);
    });
    menu.querySelector('#tab-ctx-close')?.addEventListener('click', () => {
      this.tabManager.closeTab(tab.id);
    });
  }


  private updateMarkdownPreview(content: string): void {
    if (!this.previewVisible) return;
    const activeTab = this.tabManager.getActiveTab();
    let noteDir = this.explorer.getCurrentFolder();
    if (activeTab && activeTab.path) {
      const lastSlash = Math.max(activeTab.path.lastIndexOf('\\'), activeTab.path.lastIndexOf('/'));
      if (lastSlash !== -1) {
        noteDir = activeTab.path.substring(0, lastSlash);
      }
    }

    const parsed = parseMarkdown(content, noteDir);
    let html = '';
    if (parsed.frontmatter) {
      html += renderFrontmatterHtml(parsed.frontmatter);
    }
    html += parsed.html;

    const previewContent = document.getElementById('md-preview-content');
    if (previewContent) {
      previewContent.innerHTML = html;

      const imgs = previewContent.querySelectorAll('img[data-local-path]');
      imgs.forEach(async (img) => {
        const el = img as HTMLImageElement;
        const rawPath = el.getAttribute('data-local-path');
        if (rawPath) {
          try {
            const fullPath = decodeURIComponent(rawPath);
            const dataUrl = await api.getImageDataUrl(fullPath);
            el.src = dataUrl;
          } catch (e) {
            console.error('Failed to load preview image:', e);
          }
        }
      });
    }
  }




  private updateOutline(content: string): void {
    if (!this.outlineVisible) return;
    const parsed = parseMarkdown(content);
    this.outlineList.innerHTML = '';

    if (parsed.toc.length === 0) {
      this.outlineList.innerHTML = '<div class="welcome-msg">No headings found</div>';
      return;
    }

    parsed.toc.forEach((item) => {
      const el = document.createElement('div');
      el.className = `outline-item outline-h${item.level}`;
      el.textContent = item.text;
      el.addEventListener('click', () => {
        this.editor.scrollLineIntoView(item.line);
      });
      this.outlineList.appendChild(el);
    });
  }

  private handleDocChange(content: string): void {
    const words = (content.match(/\b[\w'-]+\b/g) || []).length;
    const chars = content.length;
    const readTime = Math.max(1, Math.ceil(words / 200));
    const wordEl = document.getElementById('status-word-count');
    if (wordEl) {
      wordEl.textContent = `${words.toLocaleString()} words · ${chars.toLocaleString()} chars · ~${readTime} min read`;
    }

    const activeTab = this.tabManager.getActiveTab();
    if (activeTab) {
      this.tabManager.updateActiveContent(content);
      if (this.previewVisible) this.updateMarkdownPreview(content);
      if (this.outlineVisible) this.updateOutline(content);

      if (this.isSplitView && this.editor2 && activeTab.path === this.pane2Path) {
        if (this.editor2.getContent() !== content) {
          this.editor2.setContent(content, activeTab.path || '');
        }
      }


      if (this.autoSaveEnabled && activeTab.path) {
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
        const dot = document.getElementById('autosave-dot');
        if (dot) dot.style.background = '#fbbf24';

        this.autoSaveTimer = setTimeout(async () => {
          const cur = this.tabManager.getActiveTab();
          if (cur && cur.path && cur.isDirty) {
            await api.writeFile(cur.path, cur.content);
            this.tabManager.markActiveSaved(cur.path, cur.name);
            if (dot) dot.style.background = '#10b981';
          }
        }, 1000);
      }
    }
  }

  private async openDiaryModal(targetDate?: Date): Promise<void> {
    if (targetDate) this.currentDiaryDate = new Date(targetDate);
    const date = this.currentDiaryDate;

    const rootFolder = this.explorer.getCurrentFolder() || localStorage.getItem('piconote-main-folder');
    if (!rootFolder) {
      alert('Please select or open a workspace folder first to initialize your Daily Diary.');
      return;
    }

    const year = date.getFullYear().toString();
    const monthNum = String(date.getMonth() + 1).padStart(2, '0');
    const monthName = date.toLocaleString('en-US', { month: 'long' });
    const monthFolder = `${monthNum}-${monthName}`;
    const dayNum = String(date.getDate()).padStart(2, '0');
    const dayName = date.toLocaleString('en-US', { weekday: 'long' });
    const fullDateStr = `${year}-${monthNum}-${dayNum}`;
    const filename = `${fullDateStr}_${dayName}.md`;

    // Ensure nested folder structure: Journal / Year / Month
    const journalBase = `${rootFolder}\\Journal`;
    const yearDir = `${journalBase}\\${year}`;
    const monthDir = `${yearDir}\\${monthFolder}`;

    await api.createFolder(journalBase);
    await api.createFolder(yearDir);
    await api.createFolder(monthDir);

    const fullPath = `${monthDir}\\${filename}`;
    const exists = await api.pathExists(fullPath);

    let content = '';
    if (exists) {
      content = await api.readFile(fullPath);
    } else {
      content = `---\ntitle: Daily Entry - ${dayName}, ${monthName} ${dayNum}, ${year}\ndate: ${fullDateStr}\nday: ${dayName}\nyear: ${year}\nmonth: ${monthName}\ntags: [diary, journal]\n---\n\n# 📓 ${dayName}, ${monthName} ${dayNum}, ${year}\n\n## 🌟 Daily Reflection & Focus\n- [ ] \n\n## 📝 Notes & Thoughts\n\n`;
      await api.writeFile(fullPath, content);
      await this.explorer.refresh();
    }

    // Update modal UI
    const modalDate = document.getElementById('diary-modal-date');
    if (modalDate) {
      modalDate.textContent = `${dayName}, ${monthName} ${dayNum}, ${year}`;
    }

    const modal = document.getElementById('diary-modal');
    modal?.classList.remove('hidden');

    const editorContainer = document.getElementById('diary-modal-editor');
    if (!this.diaryEditor && editorContainer) {
      this.diaryEditor = new CodeMirrorEditor(editorContainer);
      this.diaryEditor.setTheme(this.themeManager.getTheme() === 'dark');
      this.diaryEditor.setOnChange((newContent) => {
        const statusEl = document.getElementById('diary-modal-status');
        if (statusEl) statusEl.textContent = 'Saving...';

        if (this.diaryAutoSaveTimer) clearTimeout(this.diaryAutoSaveTimer);
        this.diaryAutoSaveTimer = setTimeout(async () => {
          await api.writeFile(fullPath, newContent);
          if (statusEl) statusEl.textContent = 'Saved silently';
        }, 800);
      });
    }

    if (this.diaryEditor) {
      this.diaryEditor.setContent(content, fullPath);
      this.diaryEditor.focus();
    }
  }



  private populateSplitFileSelect(): void {
    const select = document.getElementById('split-pane-file-select') as HTMLSelectElement;
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Document to View --</option>';

    const tabs = this.tabManager.getTabs();
    tabs.forEach((t) => {
      if (t.path) {
        const opt = document.createElement('option');
        opt.value = t.path;
        opt.textContent = t.name;
        if (t.path === this.pane2Path) opt.selected = true;
        select.appendChild(opt);
      }
    });
  }

  private async openInPane2(filePath: string): Promise<void> {
    this.pane2Path = filePath;
    const container2 = document.getElementById('editor-container-2');
    if (!this.editor2 && container2) {
      this.editor2 = new CodeMirrorEditor(container2);
      this.editor2.setTheme(this.themeManager.getTheme() === 'dark');
    }

    if (this.editor2) {
      try {
        const content = await api.readFile(filePath);
        this.editor2.setContent(content, filePath);
        this.editor2.setOnChange((newContent) => {
          const tab = this.tabManager.getTabs().find((t) => t.path === filePath);
          if (tab) {
            tab.content = newContent;
            tab.isDirty = true;
          }
          const active = this.tabManager.getActiveTab();
          if (active && active.path === filePath && this.editor) {
            if (this.editor.getContent() !== newContent) {
              this.editor.setContent(newContent, filePath);
            }
          }
          if (this.autoSaveEnabled) {
            api.writeFile(filePath, newContent);
          }
        });
      } catch (err) {
        console.error('Failed to open file in Pane 2:', err);
      }
    }
  }

  private toggleSplitView(): void {
    this.isSplitView = !this.isSplitView;
    const pane2 = document.getElementById('editor-pane-2');
    const resizer = document.getElementById('split-resizer');

    if (this.isSplitView) {
      pane2?.classList.remove('hidden');
      resizer?.classList.remove('hidden');

      this.populateSplitFileSelect();

      const activeTab = this.tabManager.getActiveTab();
      if (activeTab && activeTab.path) {
        this.openInPane2(activeTab.path);
      }
    } else {
      pane2?.classList.add('hidden');
      resizer?.classList.add('hidden');
      const pane1 = document.getElementById('editor-container');
      if (pane1) {
        pane1.style.width = '';
        pane1.style.flex = '1';
      }
    }
  }


}


// Start application
document.addEventListener('DOMContentLoaded', () => {
  new PicoNoteApp();
});
