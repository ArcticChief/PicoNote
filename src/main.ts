import { api } from './api';

import { CodeMirrorEditor } from './editor';
import { FileExplorer } from './explorer';
import { parseMarkdown, renderFrontmatterHtml } from './markdown';
import { CommandPalette } from './palette';
import { SpotlightSearch } from './spotlight';
import { TabManager } from './tabs';
import { ThemeManager } from './theme';
import { Tab, TabGroup } from './types';




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
      (tabs, groups) => this.renderTabs(tabs, groups)
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
    document.getElementById('btn-split-editor')?.addEventListener('click', () => this.toggleSplitView());
    document.getElementById('btn-close-split')?.addEventListener('click', () => this.toggleSplitView());

    document.getElementById('pane1-file-select')?.addEventListener('change', (e) => {
      const tabId = (e.target as HTMLSelectElement).value;
      if (tabId) {
        this.tabManager.setActiveTab(tabId);
      }
    });


    document.getElementById('pane2-file-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val) {
        const tab = this.tabManager.getTabs().find((t) => t.id === val || t.path === val);
        if (tab) {
          this.openInPane2({ id: tab.id, path: tab.path || undefined, name: tab.name });
        }
      }
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
      { id: 'create-tab-group', label: 'Tabs: Create New Tab Group...', action: () => {
        const active = this.tabManager.getActiveTab();
        const grpName = prompt('Enter new Tab Group name:');
        if (grpName) {
          const grp = this.tabManager.createGroup(grpName);
          if (active) this.tabManager.assignTabToGroup(active.id, grp.id);
        }
      }},
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
    if (this.isSplitView) return;
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
    if (this.isSplitView) return;
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

  private renderTabs(tabs: Tab[], groups: TabGroup[] = []): void {
    this.tabsContainer.innerHTML = '';
    const active = this.tabManager.getActiveTab();

    const allTabsText = document.getElementById('btn-all-tabs-text');
    if (allTabsText) {
      allTabsText.textContent = `Tabs (${tabs.length})`;
    }

    // 1. Render Group Pills and their assigned tabs
    groups.forEach((g) => {
      const groupTabs = tabs.filter((t) => t.groupId === g.id);

      const pill = document.createElement('div');
      pill.className = `tab-group-pill color-${g.color} ${g.collapsed ? 'collapsed' : ''}`;
      pill.title = `Group: ${g.name} (${groupTabs.length} tabs) — Click to ${g.collapsed ? 'expand' : 'collapse'}, Right-click to manage`;
      pill.innerHTML = `
        <span class="group-dot color-${g.color}"></span>
        <span class="group-name">${g.name}</span>
        <span class="group-count">(${groupTabs.length})</span>
        <span class="group-arrow">▾</span>
      `;

      pill.addEventListener('click', () => {
        this.tabManager.toggleGroupCollapse(g.id);
      });

      pill.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showGroupContextMenu(e.clientX, e.clientY, g);
      });

      this.tabsContainer.appendChild(pill);

      if (!g.collapsed) {
        groupTabs.forEach((tab) => {
          this.appendTabElement(tab, active, g.color);
        });
      }
    });

    // 2. Render Ungrouped Tabs
    const ungroupedTabs = tabs.filter((t) => !t.groupId);
    ungroupedTabs.forEach((tab) => {
      this.appendTabElement(tab, active);
    });

    // Auto-scroll active tab into view
    setTimeout(() => {
      const activeEl = this.tabsContainer.querySelector('.tab.active') as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      }
    }, 50);
  }

  private appendTabElement(tab: Tab, active: Tab | null, groupColor?: string): void {
    const el = document.createElement('div');
    const inGroupClass = groupColor ? `in-group-${groupColor}` : '';
    el.className = `tab ${active && active.id === tab.id ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${inGroupClass}`;
    el.setAttribute('title', tab.path || tab.name);
    el.setAttribute('draggable', 'true');
    if (tab.colorTag) {
      el.setAttribute('data-color-tag', tab.colorTag);
    }

    const icon = this.getTabFileIcon(tab.name);
    el.innerHTML = `
      <span class="tab-icon">${icon}</span>
      <span class="tab-title">${tab.name}</span>
      ${tab.pinned ? '<span class="tab-pin-icon" title="Pinned">📌</span>' : ''}
      ${tab.isDirty ? '<span class="tab-dot" title="Unsaved changes"></span>' : ''}
      ${!tab.pinned ? `<span class="tab-close" data-id="${tab.id}">&times;</span>` : ''}
    `;

    // HTML5 Drag & Drop Reordering
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', tab.id);
      el.classList.add('dragging');
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const sourceId = e.dataTransfer?.getData('text/plain');
      if (sourceId && sourceId !== tab.id) {
        this.tabManager.reorderTab(sourceId, tab.id);
      }
    });

    el.addEventListener('dragend', () => {
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.remove('dragging', 'drag-over');
      });
    });

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

    const groups = this.tabManager.getGroups();

    const menu = document.createElement('div');
    menu.id = 'context-menu';

    let groupsHtml = '';
    if (groups.length > 0) {
      groupsHtml += `<div class="ctx-divider"></div>`;
      groups.forEach((g) => {
        if (tab.groupId !== g.id) {
          groupsHtml += `<div class="ctx-item tab-ctx-assign-grp" data-grp-id="${g.id}">📂 Move to Group: ${g.name}</div>`;
        }
      });
    }

    menu.innerHTML = `
      <div class="ctx-item" id="tab-ctx-pin">${tab.pinned ? '📌 Unpin Tab' : '📌 Pin Tab'}</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" id="tab-ctx-new-grp">📁 Create New Tab Group...</div>
      ${tab.groupId ? '<div class="ctx-item" id="tab-ctx-ungrp">🚫 Remove from Group</div>' : ''}
      ${groupsHtml}
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

    menu.querySelector('#tab-ctx-new-grp')?.addEventListener('click', () => {
      const groupName = prompt('Enter new Tab Group name:');
      if (groupName) {
        const grp = this.tabManager.createGroup(groupName);
        this.tabManager.assignTabToGroup(tab.id, grp.id);
      }
    });

    menu.querySelector('#tab-ctx-ungrp')?.addEventListener('click', () => {
      this.tabManager.assignTabToGroup(tab.id, null);
    });

    menu.querySelectorAll('.tab-ctx-assign-grp').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const grpId = (e.currentTarget as HTMLElement).getAttribute('data-grp-id');
        if (grpId) {
          this.tabManager.assignTabToGroup(tab.id, grpId);
        }
      });
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

  private showGroupContextMenu(x: number, y: number, group: TabGroup): void {
    const existing = document.getElementById('context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'context-menu';

    menu.innerHTML = `
      <div class="ctx-item" id="grp-ctx-rename">✏️ Rename Group...</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" id="grp-ctx-color-purple">🟣 Purple Accent</div>
      <div class="ctx-item" id="grp-ctx-color-blue">🔵 Blue Accent</div>
      <div class="ctx-item" id="grp-ctx-color-emerald">🟢 Emerald Accent</div>
      <div class="ctx-item" id="grp-ctx-color-amber">🟠 Amber Accent</div>
      <div class="ctx-item" id="grp-ctx-color-rose">🔴 Rose Accent</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" id="grp-ctx-toggle">${group.collapsed ? '▸ Expand Group' : '▾ Collapse Group'}</div>
      <div class="ctx-item" id="grp-ctx-ungroup-all">📂 Ungroup All Tabs</div>
      <div class="ctx-item danger" id="grp-ctx-close-tabs">❌ Close All Tabs in Group</div>
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

    menu.querySelector('#grp-ctx-rename')?.addEventListener('click', () => {
      const newName = prompt('Enter new group name:', group.name);
      if (newName) {
        this.tabManager.renameGroup(group.id, newName);
      }
    });

    menu.querySelector('#grp-ctx-color-purple')?.addEventListener('click', () => {
      this.tabManager.setGroupColor(group.id, 'purple');
    });
    menu.querySelector('#grp-ctx-color-blue')?.addEventListener('click', () => {
      this.tabManager.setGroupColor(group.id, 'blue');
    });
    menu.querySelector('#grp-ctx-color-emerald')?.addEventListener('click', () => {
      this.tabManager.setGroupColor(group.id, 'emerald');
    });
    menu.querySelector('#grp-ctx-color-amber')?.addEventListener('click', () => {
      this.tabManager.setGroupColor(group.id, 'amber');
    });
    menu.querySelector('#grp-ctx-color-rose')?.addEventListener('click', () => {
      this.tabManager.setGroupColor(group.id, 'rose');
    });

    menu.querySelector('#grp-ctx-toggle')?.addEventListener('click', () => {
      this.tabManager.toggleGroupCollapse(group.id);
    });

    menu.querySelector('#grp-ctx-ungroup-all')?.addEventListener('click', () => {
      this.tabManager.removeGroup(group.id, false);
    });

    menu.querySelector('#grp-ctx-close-tabs')?.addEventListener('click', () => {
      this.tabManager.removeGroup(group.id, true);
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





  private populateSplitFileSelect(): void {
    const select1 = document.getElementById('pane1-file-select') as HTMLSelectElement;
    const select2 = document.getElementById('pane2-file-select') as HTMLSelectElement;
    if (!select1 || !select2) return;

    const activeTab = this.tabManager.getActiveTab();

    select1.innerHTML = '<option value="">-- Select Document --</option>';
    select2.innerHTML = '<option value="">-- Select Document --</option>';

    const tabs = this.tabManager.getTabs();
    tabs.forEach((t) => {
      const opt1 = document.createElement('option');
      opt1.value = t.id;
      opt1.textContent = `📄 ${t.name}${t.isDirty ? ' ●' : ''}`;
      if (activeTab && t.id === activeTab.id) opt1.selected = true;
      select1.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = t.id;
      opt2.textContent = `📄 ${t.name}${t.isDirty ? ' ●' : ''}`;
      if (t.id === this.pane2Path || t.path === this.pane2Path) opt2.selected = true;
      select2.appendChild(opt2);
    });
  }

  private async openInPane2(target: { id?: string; path?: string; name: string }): Promise<void> {
    const container2 = document.getElementById('editor-container-2');
    if (!this.editor2 && container2) {
      this.editor2 = new CodeMirrorEditor(container2);
      this.editor2.setTheme(this.themeManager.getTheme() === 'dark');
    }

    this.pane2Path = target.id || target.path || target.name;

    let content = '';
    const existingTab = target.id
      ? this.tabManager.getTabs().find((t) => t.id === target.id)
      : this.tabManager.getTabs().find((t) => t.path === target.path);

    if (existingTab) {
      content = existingTab.content;
    } else if (target.path) {
      try {
        content = await api.readFile(target.path);
      } catch (err) {
        console.error('Failed to read file for Pane 2:', err);
        return;
      }
    }

    if (this.editor2) {
      this.editor2.setContent(content, target.path || target.name);
      this.editor2.setOnChange((newContent) => {
        const tab = target.id
          ? this.tabManager.getTabs().find((t) => t.id === target.id)
          : this.tabManager.getTabs().find((t) => t.path === target.path);

        if (tab) {
          tab.content = newContent;
          tab.isDirty = true;
        }

        const active = this.tabManager.getActiveTab();
        if (active && (active.id === target.id || (active.path && active.path === target.path))) {
          if (this.editor.getContent() !== newContent) {
            this.editor.setContent(newContent, target.path || target.name);
          }
        }

        if (this.autoSaveEnabled && target.path) {
          api.writeFile(target.path, newContent);
        }
      });
    }
  }

  private toggleSplitView(): void {
    this.isSplitView = !this.isSplitView;
    const pane1Header = document.getElementById('pane1-header');
    const pane2 = document.getElementById('editor-pane-2');
    const resizer = document.getElementById('split-resizer');
    const btn = document.getElementById('btn-split-editor');

    const btnPreview = document.getElementById('btn-preview-toggle') as HTMLButtonElement | null;
    const btnOutline = document.getElementById('btn-outline-toggle') as HTMLButtonElement | null;

    if (this.isSplitView) {
      if (this.previewVisible) this.togglePreview();
      if (this.outlineVisible) this.toggleOutline();

      if (btnPreview) {
        btnPreview.disabled = true;
        btnPreview.title = 'Preview is disabled in Split Mode';
      }
      if (btnOutline) {
        btnOutline.disabled = true;
        btnOutline.title = 'Outline is disabled in Split Mode';
      }

      pane1Header?.classList.remove('hidden');
      pane2?.classList.remove('hidden');
      resizer?.classList.remove('hidden');
      btn?.classList.add('active');

      this.populateSplitFileSelect();

      const tabs = this.tabManager.getTabs();
      const activeTab = this.tabManager.getActiveTab();

      const secondTab = tabs.find((t) => t.id !== activeTab?.id);
      const targetTab = secondTab || activeTab;

      if (targetTab) {
        this.openInPane2({ id: targetTab.id, path: targetTab.path || undefined, name: targetTab.name });
      }
    } else {
      if (btnPreview) {
        btnPreview.disabled = false;
        btnPreview.title = 'Toggle Markdown Preview (Ctrl+Shift+M)';
      }
      if (btnOutline) {
        btnOutline.disabled = false;
        btnOutline.title = 'Toggle Heading Outline (Ctrl+Shift+O)';
      }

      pane1Header?.classList.add('hidden');
      pane2?.classList.add('hidden');
      resizer?.classList.add('hidden');
      btn?.classList.remove('active');
      const pane1 = document.getElementById('editor-pane-1');
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
