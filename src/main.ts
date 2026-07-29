import { api } from './api';

import { CodeMirrorEditor } from './editor';
import { FileExplorer, getDraggedExplorerItemPath } from './explorer';
import { ImageViewerController } from './imageViewer';
import { SplitViewController } from './splitView';
import { TabBarView } from './tabBar';

import { parseMarkdown, renderFrontmatterHtml } from './markdown';
import { formatMarkdown } from './formatter';
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
  private splitView!: SplitViewController;
  private autoSaveEnabled: boolean = true;
  private autoSaveTimer: any = null;

  private snapshotInterval: any = null;
  private fileWatchInterval: any = null;
  private externalCheckInFlight: boolean = false;
  private toastTimer: any = null;
  private previewImageUrls: string[] = [];
  private livePanesTimer: any = null;

  private imageViewer!: ImageViewerController;
  private tabBar!: TabBarView;

  private previewVisible: boolean = false;
  private outlineVisible: boolean = false;
  private sidebarVisible: boolean = true;

  private editorContainer: HTMLElement;
  private mdPreviewContainer: HTMLElement;
  private outlineDrawer: HTMLElement;
  private outlineList: HTMLElement;
  private welcomeScreen: HTMLElement;
  private setupModal: HTMLElement;

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

    this.statusFilename = document.getElementById('status-filename') as HTMLElement;
    this.statusCursor = document.getElementById('status-cursor') as HTMLElement;
    this.statusLang = document.getElementById('status-lang') as HTMLElement;

    this.init();
  }

  private async init(): Promise<void> {
    this.themeManager = new ThemeManager();

    this.editor = new CodeMirrorEditor(this.editorContainer);
    this.editor.setTheme(this.themeManager.getTheme() === 'dark');
    // Note: the editor's onChange is registered once in setupEventListeners().


    this.tabManager = new TabManager(
      (activeTab) => {
        this.onActiveTabChanged(activeTab);
        this.saveSessionState();
      },
      (tabs, groups) => {
        this.tabBar.render(tabs, groups);
        this.saveSessionState();
      }
    );

    this.explorer = new FileExplorer(
      'file-explorer',
      'folder-path-input',
      'explorer-search-input',
      (filePath) => this.openFileByPath(filePath),
      (filePath) => this.openFileInSplitPane(filePath),
      (message, variant) => this.showToast(message, variant),
      (oldPath, newPath) => this.tabManager.handleExternalRename(oldPath, newPath),
      (path) => this.tabManager.handleExternalDelete(path)
    );


    this.imageViewer = new ImageViewerController(
      (message, variant) => this.showToast(message, variant),
      () => this.tabManager.getActiveTab()
    );

    this.splitView = new SplitViewController({
      tabManager: this.tabManager,
      getMainEditor: () => this.editor,
      isDark: () => this.themeManager.getTheme() === 'dark',
      isAutoSaveEnabled: () => this.autoSaveEnabled,
      isDiskNewer: (tab) => this.isDiskNewer(tab),
      refreshTabDiskMtime: (tab) => this.refreshTabDiskMtime(tab),
      showExternalChangeBanner: (tab) => this.showExternalChangeBanner(tab),
    });

    this.tabBar = new TabBarView({
      tabManager: this.tabManager,
      requestCloseTab: (id) => this.requestCloseTab(id),
      requestBulkClose: (willClose, run) => this.requestBulkClose(willClose, run),
      newFile: () => this.newFile(),
    });

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

    // Restore Session State or open CLI file / blank file
    const cliFile = await api.getCliFile();
    if (cliFile) {
      await this.openFileByPath(cliFile);
    } else {
      const restored = await this.restoreSessionState();
      if (!restored) {
        this.newFile();
      }
    }

    this.setupReliabilityGuards();
  }

  /**
   * Wires the zero-data-loss safety net: periodic session snapshots (survives
   * force-close), focus/interval external-change polling, and a global error
   * boundary that surfaces uncaught failures as toasts instead of dying silently.
   */
  private setupReliabilityGuards(): void {
    // Periodic draft snapshot so an abrupt force-close still leaves a <5s draft.
    this.snapshotInterval = setInterval(() => this.saveSessionState(), 5000);

    // External file mutation watcher (focus-based polling).
    window.addEventListener('focus', () => this.checkActiveFileForExternalChange());
    this.fileWatchInterval = setInterval(() => this.checkActiveFileForExternalChange(), 3000);

    // Global error boundary — never fail silently.
    window.addEventListener('error', (e) => {
      console.error('Uncaught error:', e.error || e.message);
      this.showToast(`Something went wrong — ${e.message || 'unknown error'}`, 'error');
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('Unhandled rejection:', e.reason);
      const msg = e.reason?.message || String(e.reason || 'unknown error');
      this.showToast(`Something went wrong — ${msg}`, 'error');
    });
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

    // Auto-save workspace session state on exit + release timers/resources
    window.addEventListener('beforeunload', () => {
      this.saveSessionState();
      if (this.snapshotInterval) clearInterval(this.snapshotInterval);
      if (this.fileWatchInterval) clearInterval(this.fileWatchInterval);
      if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
      if (this.livePanesTimer) clearTimeout(this.livePanesTimer);
      this.imageViewer.dispose();
      this.releasePreviewImageUrls();
    });

    // External file change banner actions
    document.getElementById('external-reload-btn')?.addEventListener('click', () => this.reloadActiveFromDisk());
    document.getElementById('external-keeplocal-btn')?.addEventListener('click', () => this.keepLocalVersion());




    // Setup modal button
    document.getElementById('btn-select-main-folder')?.addEventListener('click', async () => {

      await this.setMainWorkspaceFolder();
    });

    // Editor listeners — route through handleDocChange so word count, live
    // preview/outline, and autosave all fire on every edit.
    this.editor.setOnChange((content) => this.handleDocChange(content));

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
        this.showToast('Open a workspace folder first to save pasted images.', 'error');
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
        this.showToast(`Failed to save pasted image: ${err}`, 'error');
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
          this.splitView.openInPane2({ id: tab.id, path: tab.path || undefined, name: tab.name });
        }
      }
    });

    document.getElementById('btn-sync-pane2')?.addEventListener('click', () => this.splitView.syncToLatest());
    document.getElementById('pane2-parity-badge')?.addEventListener('click', () => {
      if (document.getElementById('pane2-parity-badge')?.classList.contains('out-of-sync')) {
        this.splitView.syncToLatest();
      }
    });

    // Dedicated Sub-Header & Toolbar Button Drop Targets for Split Panes
    const header1 = document.getElementById('pane1-header');
    const header2 = document.getElementById('pane2-header');
    const btnSplitBtn = document.getElementById('btn-split-editor');

    [
      { element: header1, isPane2: false },
      { element: header2, isPane2: true },
      { element: btnSplitBtn, isPane2: true },
    ].forEach(({ element, isPane2 }) => {
      if (!element) return;

      element.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
        element.classList.add('drop-header-active');
      });

      element.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        element.classList.remove('drop-header-active');
      });

      element.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        element.classList.remove('drop-header-active');

        const explorerPath = getDraggedExplorerItemPath();
        const dropData = explorerPath || e.dataTransfer?.getData('text/plain');
        if (!dropData) return;

        const tabById = this.tabManager.getTabs().find((t) => t.id === dropData || t.path === dropData);
        let filePath = tabById ? (tabById.path || null) : dropData;
        let tabId = tabById ? tabById.id : null;

        if (!tabById && filePath) {
          const filename = filePath.replace(/\\/g, '/').split('/').pop() || 'file';
          if (this.isImageFile(filename)) {
            const t = this.tabManager.findOrOpenTab(filePath, filename, '', !isPane2, 'image');
            tabId = t.id;
          } else {
            try {
              const content = await api.readFile(filePath);
              const t = this.tabManager.findOrOpenTab(filePath, filename, content, !isPane2);
              tabId = t.id;
            } catch (err) {
              console.error('Failed to read dropped file:', err);
              return;
            }
          }
        }

        if (isPane2) {
          if (!this.splitView.isActive()) {
            this.toggleSplitView();
          }
          const targetTab = tabId ? this.tabManager.getTabs().find((t) => t.id === tabId) : null;
          if (targetTab) {
            await this.splitView.openInPane2({ id: targetTab.id, path: targetTab.path || undefined, name: targetTab.name });
          }
        } else {
          if (tabId) {
            this.tabManager.setActiveTab(tabId);
          }
        }
      });
    });

    // Tab bar rendering, context menus, dropdown, and scrolling live in TabBarView.

    // Buttons
    document.getElementById('btn-open-folder')?.addEventListener('click', () => this.openFolderDialog());

    document.getElementById('btn-new-file')?.addEventListener('click', () => this.newFile());


    document.getElementById('btn-new-folder')?.addEventListener('click', async () => {
      const folder = this.explorer.getCurrentFolder();
      if (!folder) {
        this.showToast('Open a workspace folder first.', 'error');
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

    document.getElementById('btn-format-document')?.addEventListener('click', () => this.formatDocument());
    document.getElementById('btn-preview-toggle')?.addEventListener('click', () => this.togglePreview());
    document.getElementById('btn-outline-toggle')?.addEventListener('click', () => this.toggleOutline());
    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => this.toggleTheme());

    // Image viewer canvas controls are wired inside ImageViewerController.

    document.getElementById('welcome-open-folder')?.addEventListener('click', () => this.setMainWorkspaceFolder());
    document.getElementById('welcome-open-file')?.addEventListener('click', () => this.openFileDialog());
    document.getElementById('welcome-new-file')?.addEventListener('click', () => this.newFile());

    // Tab scrolling and the all-tabs dropdown are wired inside TabBarView.


    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.altKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        this.formatDocument();
        return;
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
          if (active) this.requestCloseTab(active.id);
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
      { id: 'format-document', label: 'Format: Auto-Beautify & Align Tables', shortcut: 'Shift+Alt+F', action: () => this.formatDocument() },
      { id: 'create-tab-group', label: 'Tabs: Create New Tab Group...', action: () => {
        const active = this.tabManager.getActiveTab();
        const grpName = prompt('Enter new Tab Group name:');
        if (grpName) {
          const grp = this.tabManager.createGroup(grpName);
          if (active) this.tabManager.assignTabToGroup(active.id, grp.id);
        }
      }},
      { id: 'split-view', label: 'View: Toggle Split Editor Pane', shortcut: 'Ctrl+\\\\', action: () => this.toggleSplitView() },



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


  public showLoading(message: string = 'Loading...'): void {
    const loadingBar = document.getElementById('app-loading-bar');
    const toast = document.getElementById('global-loading-toast');
    const toastText = document.getElementById('loading-toast-text');
    const statusLoader = document.getElementById('status-loader');
    const statusText = document.getElementById('status-loader-text');

    if (loadingBar) loadingBar.classList.remove('hidden');
    if (toast) toast.classList.remove('hidden');
    if (toastText) toastText.textContent = message;
    if (statusLoader) statusLoader.classList.remove('hidden');
    if (statusText) statusText.textContent = message;
  }

  public hideLoading(): void {
    const loadingBar = document.getElementById('app-loading-bar');
    const toast = document.getElementById('global-loading-toast');
    const statusLoader = document.getElementById('status-loader');

    if (loadingBar) loadingBar.classList.add('hidden');
    if (toast) toast.classList.add('hidden');
    if (statusLoader) statusLoader.classList.add('hidden');
  }

  public async withLoading<T>(action: () => Promise<T>, message: string = 'Loading...'): Promise<T> {
    this.showLoading(message);
    try {
      return await action();
    } finally {
      this.hideLoading();
    }
  }

  private async setMainWorkspaceFolder(): Promise<void> {
    const selected = await api.showOpenFolderDialog();
    if (selected) {
      await this.withLoading(async () => {
        localStorage.setItem('piconote-main-folder', selected);
        await this.explorer.openFolder(selected);
        this.setupModal.classList.add('hidden');
      }, 'Opening workspace...');
    }
  }

  private isImageFile(filename: string): boolean {
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext);
  }

  private async openFileByPath(filePath: string): Promise<void> {
    await this.withLoading(async () => {
      try {
        const filename = filePath.replace(/\\/g, '/').split('/').pop() || 'file';
        if (this.isImageFile(filename)) {
          this.tabManager.openTab(filePath, filename, '', 'image');
          return;
        }

        const result = await api.readFileChecked(filePath);
        const tab = this.tabManager.openTab(filePath, filename, result.content);
        tab.readOnlyLossy = result.lossy;
        await this.refreshTabDiskMtime(tab);
        if (result.lossy) {
          this.showToast('Opened read-only: file is not valid UTF-8 text', 'error');
          this.onActiveTabChanged(this.tabManager.getActiveTab());
        }
      } catch (err: any) {
        this.showToast(`Could not open file: ${err}`, 'error');
      }
    }, 'Opening document...');
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

    if (active.kind === 'image') return; // nothing to save for image tabs

    if (active.readOnlyLossy) {
      this.showToast('This file is read-only (not valid UTF-8 text)', 'error');
      return;
    }

    if (active.path) {
      if (await this.isDiskNewer(active)) {
        this.showExternalChangeBanner(active);
        this.showToast('File changed on disk — resolve before saving', 'error');
        return;
      }
      await this.withLoading(async () => {
        await api.writeFile(active.path!, active.content);
        this.tabManager.markActiveSaved();
        await this.refreshTabDiskMtime(active);
      }, 'Saving document...');
    } else {
      await this.saveFileAs();
    }
  }

  private async saveFileAs(): Promise<void> {
    const active = this.tabManager.getActiveTab();
    if (!active) return;

    const selectedPath = await api.showSaveFileDialog(active.name);
    if (selectedPath) {
      await this.withLoading(async () => {
        await api.writeFile(selectedPath, active.content);
        const newName = selectedPath.replace(/\\/g, '/').split('/').pop() || active.name;
        this.tabManager.markActiveSaved(selectedPath, newName);
        await this.refreshTabDiskMtime(active);
        if (this.explorer.getCurrentFolder()) {
          await this.explorer.refresh();
        }
      }, 'Saving document as...');
    }
  }


  private togglePreview(): void {
    if (this.splitView.isActive()) return;
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
      this.releasePreviewImageUrls();
    }
  }


  private toggleOutline(): void {
    if (this.splitView.isActive()) return;
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
    this.splitView.setTheme(theme === 'dark');
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

    if (!activeTab) {
      this.welcomeScreen.style.display = 'flex';
      this.editorContainer.style.display = 'block';
      if (imageViewer) imageViewer.classList.add('hidden');
      this.statusFilename.textContent = 'No file open';
      this.statusLang.textContent = 'Plain Text';
      if (titlebarDoc) titlebarDoc.textContent = 'PicoNote Studio';
      this.explorer.setActiveFilePath(null);
      return;
    }

    this.welcomeScreen.style.display = 'none';
    this.statusFilename.textContent = activeTab.name + (activeTab.isDirty ? ' ●' : '');
    this.statusLang.textContent = activeTab.language;
    if (titlebarDoc) titlebarDoc.textContent = `${activeTab.name}${activeTab.isDirty ? ' ●' : ''} — PicoNote`;
    this.explorer.setActiveFilePath(activeTab.path || null);


    if (activeTab.kind === 'image' && activeTab.path) {
      this.editorContainer.style.display = 'none';
      if (imageViewer) imageViewer.classList.remove('hidden');
      this.imageViewer.showImage(activeTab.path, activeTab.name);
      return;
    }

    // Leaving the image viewer for a text document — free any blob URL.
    this.imageViewer.hide();

    const fmtBar = document.getElementById('formatting-toolbar');
    const ext = activeTab ? (activeTab.name.includes('.') ? activeTab.name.slice(activeTab.name.lastIndexOf('.')).toLowerCase() : '') : '';
    const isMd = ext === '.md' || ext === '.markdown' || !ext;
    if (fmtBar) {
      if (activeTab && isMd && activeTab.kind !== 'image') {
        fmtBar.classList.remove('hidden');
      } else {
        fmtBar.classList.add('hidden');
      }
    }

    this.editorContainer.style.display = 'block';
    if (imageViewer) imageViewer.classList.add('hidden');

    // Backfill the disk-mtime baseline for tabs opened via paths we don't
    // explicitly instrument (e.g. restored sessions) so the watcher/guard apply.
    if (activeTab.path && activeTab.diskMtime === undefined) {
      void this.refreshTabDiskMtime(activeTab);
    }

    this.editor.setContent(activeTab.content, activeTab.path || activeTab.name);
    // Non-UTF8 files are view-only so a save can't corrupt the original bytes.
    this.editor.setReadOnly(!!activeTab.readOnlyLossy);
    if (this.previewVisible) this.updateMarkdownPreview(activeTab.content);
    if (this.outlineVisible) this.updateOutline(activeTab.content);
    if (this.splitView.isActive()) {
      this.splitView.populateSelects();
      this.splitView.checkReadOnly();
    }
  }

  private saveSessionState(): void {
    try {
      const tabSession = this.tabManager.exportSessionState();
      const state = {
        tabs: tabSession.tabs,
        groups: tabSession.groups,
        activeTabId: tabSession.activeTabId,
        isSplitView: this.splitView.isActive(),
        pane2Path: this.splitView.pane2TabId,
        timestamp: Date.now(),
      };
      localStorage.setItem('piconote_workspace_session_v1', JSON.stringify(state));
    } catch (err) {
      console.error('Failed to save session state:', err);
    }
  }

  private async restoreSessionState(): Promise<boolean> {
    try {
      const raw = localStorage.getItem('piconote_workspace_session_v1');
      if (!raw) return false;

      const state = JSON.parse(raw);
      if (!state || !state.tabs || !Array.isArray(state.tabs) || state.tabs.length === 0) return false;

      // Backfill `kind` for sessions saved before it existed (they stored the
      // old [IMAGE_VIEWER:...] sentinel in content).
      for (const tab of state.tabs as Tab[]) {
        if (!tab.kind) {
          tab.kind = typeof tab.content === 'string' && tab.content.startsWith('[IMAGE_VIEWER:')
            ? 'image'
            : 'text';
        }
        if (tab.kind === 'image') tab.content = '';
      }

      // Re-read file contents for disk files (in parallel) to ensure freshness,
      // preserving unsaved changes. Image tabs render from `path`, so skip them.
      await Promise.all(
        (state.tabs as Tab[]).map(async (tab) => {
          if (!tab.path || tab.kind === 'image') return;
          try {
            if (!tab.isDirty) {
              // Clean tab: trust disk and re-baseline mtime.
              const freshContent = await api.readFile(tab.path);
              tab.content = freshContent;
              tab.savedContent = freshContent;
              const info = await api.getFileInfo(tab.path);
              tab.diskMtime = info.modified;
            } else {
              // Dirty draft: keep the cached edit, but detect if disk drifted while
              // the app was closed. diskMtime = 0 forces the watcher to flag it so
              // the user resolves the conflict instead of us silently overwriting.
              const diskContent = await api.readFile(tab.path);
              if (diskContent !== tab.savedContent) {
                tab.diskMtime = 0;
              } else {
                const info = await api.getFileInfo(tab.path);
                tab.diskMtime = info.modified;
              }
            }
          } catch {
            // File removed/unreadable — keep cached content, leave mtime unset.
          }
        })
      );

      this.tabManager.restoreSessionState({
        tabs: state.tabs,
        groups: state.groups || [],
        activeTabId: state.activeTabId,
      });

      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) {
        this.onActiveTabChanged(activeTab);
        // Surface a conflict banner immediately if the active draft drifted on disk.
        void this.checkActiveFileForExternalChange();
      }

      if (state.isSplitView) {
        this.toggleSplitView();
        if (state.pane2Path) {
          const p2Tab = state.tabs.find((t: Tab) => t.path === state.pane2Path || t.id === state.pane2Path);
          if (p2Tab) {
            this.splitView.openInPane2({ id: p2Tab.id, path: p2Tab.path || undefined, name: p2Tab.name });
          }
        }
      }

      return true;
    } catch (err) {
      console.error('Failed to restore session state:', err);
      return false;
    }
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
      // Revoke the blob URLs from the previous render before replacing the DOM,
      // otherwise every re-render leaks one Object URL per embedded local image.
      this.releasePreviewImageUrls();
      previewContent.innerHTML = html;

      const imgs = previewContent.querySelectorAll('img[data-local-path]');
      imgs.forEach(async (img) => {
        const el = img as HTMLImageElement;
        const rawPath = el.getAttribute('data-local-path');
        if (rawPath) {
          try {
            const fullPath = decodeURIComponent(rawPath);
            const dataUrl = await api.getImageDataUrl(fullPath);
            this.previewImageUrls.push(dataUrl);
            el.src = dataUrl;
          } catch (e) {
            console.error('Failed to load preview image:', e);
          }
        }
      });
    }
  }

  private releasePreviewImageUrls(): void {
    for (const url of this.previewImageUrls) {
      URL.revokeObjectURL(url);
    }
    this.previewImageUrls = [];
  }

  /** Debounced live preview + outline refresh (used on every keystroke). */
  private scheduleLivePanes(content: string): void {
    if (!this.previewVisible && !this.outlineVisible) return;
    if (this.livePanesTimer) clearTimeout(this.livePanesTimer);
    this.livePanesTimer = setTimeout(() => {
      if (this.previewVisible) this.updateMarkdownPreview(content);
      if (this.outlineVisible) this.updateOutline(content);
    }, 180);
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
      this.scheduleLivePanes(content);

      if (this.splitView.isActive()) {
        this.splitView.checkReadOnly();
      }


      if (this.autoSaveEnabled && activeTab.path && !activeTab.readOnlyLossy) {
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
        const dot = document.getElementById('autosave-dot');
        if (dot) dot.style.background = '#fbbf24';

        this.autoSaveTimer = setTimeout(async () => {
          const cur = this.tabManager.getActiveTab();
          if (cur && cur.path && cur.isDirty) {
            // Never silently clobber an external edit — surface a banner instead.
            if (await this.isDiskNewer(cur)) {
              if (dot) dot.style.background = '#ef4444';
              this.showExternalChangeBanner(cur);
              return;
            }
            await api.writeFile(cur.path, cur.content);
            this.tabManager.markActiveSaved(cur.path, cur.name);
            await this.refreshTabDiskMtime(cur);
            if (dot) dot.style.background = '#10b981';
          }
        }, 1000);
      }
    }
  }

  public async openFileInSplitPane(filePath: string): Promise<void> {
    const filename = filePath.replace(/\\/g, '/').split('/').pop() || 'file';

    let tab = this.tabManager.getTabs().find((t) => t.path === filePath);
    if (!tab) {
      if (this.isImageFile(filename)) {
        tab = this.tabManager.findOrOpenTab(filePath, filename, '', false, 'image');
      } else {
        try {
          const content = await api.readFile(filePath);
          tab = this.tabManager.findOrOpenTab(filePath, filename, content, false);
          await this.refreshTabDiskMtime(tab);
        } catch (err) {
          console.error('Failed to read file for split pane:', err);
          return;
        }
      }
    }

    if (!this.splitView.isActive()) {
      this.toggleSplitView();
    }

    if (tab) {
      await this.splitView.openInPane2({ id: tab.id, path: tab.path || undefined, name: tab.name });
    }
  }

  /**
   * Toggles split mode. The pane mechanics live in SplitViewController; the app
   * only owns the preview/outline button state that split mode overrides.
   */
  private toggleSplitView(): void {
    const btnPreview = document.getElementById('btn-preview-toggle') as HTMLButtonElement | null;
    const btnOutline = document.getElementById('btn-outline-toggle') as HTMLButtonElement | null;

    if (!this.splitView.isActive()) {
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
      this.splitView.enable();
    } else {
      if (btnPreview) {
        btnPreview.disabled = false;
        btnPreview.title = 'Toggle Markdown Preview (Ctrl+Shift+M)';
      }
      if (btnOutline) {
        btnOutline.disabled = false;
        btnOutline.title = 'Toggle Heading Outline (Ctrl+Shift+O)';
      }
      this.splitView.disable();
    }
  }

  private formatDocument(): void {
    const active = this.tabManager.getActiveTab();
    if (!active || active.kind === 'image') return;

    const currentContent = this.editor.getContent();
    const formatted = formatMarkdown(currentContent);

    if (currentContent !== formatted) {
      this.editor.setContent(formatted, active.path || active.name);
      this.handleDocChange(formatted);
      this.showToast('Document Beautified & Tables Aligned ✨');
    } else {
      this.showToast('Document Already Formatted');
    }
  }

  /** Styled, promise-based confirmation dialog (replaces blocking confirm()). */
  private confirmDialog(
    message: string,
    opts: { title?: string; confirmText?: string; cancelText?: string; danger?: boolean } = {}
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-dialog" role="dialog" aria-modal="true">
          <div class="confirm-title"></div>
          <div class="confirm-message"></div>
          <div class="confirm-actions">
            <button class="confirm-btn cancel"></button>
            <button class="confirm-btn ok ${opts.danger ? 'danger' : ''}"></button>
          </div>
        </div>`;
      (overlay.querySelector('.confirm-title') as HTMLElement).textContent = opts.title || 'Confirm';
      (overlay.querySelector('.confirm-message') as HTMLElement).textContent = message;
      const cancelBtn = overlay.querySelector('.confirm-btn.cancel') as HTMLButtonElement;
      const okBtn = overlay.querySelector('.confirm-btn.ok') as HTMLButtonElement;
      cancelBtn.textContent = opts.cancelText || 'Cancel';
      okBtn.textContent = opts.confirmText || 'OK';

      document.body.appendChild(overlay);
      okBtn.focus();

      const cleanup = (result: boolean) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(result);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      };
      document.addEventListener('keydown', onKey, true);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cleanup(false); });
      cancelBtn.addEventListener('click', () => cleanup(false));
      okBtn.addEventListener('click', () => cleanup(true));
    });
  }

  /** Close a single tab, confirming first if it has unsaved changes. */
  private async requestCloseTab(tabId: string): Promise<void> {
    const tab = this.tabManager.getTabs().find((t) => t.id === tabId);
    if (tab && tab.isDirty) {
      const ok = await this.confirmDialog(
        `"${tab.name}" has unsaved changes. Close without saving?`,
        { title: 'Unsaved Changes', confirmText: 'Close Without Saving', danger: true }
      );
      if (!ok) return;
    }
    this.tabManager.closeTab(tabId);
  }

  /** Confirm once if any of the given tabs are dirty, then run the bulk close. */
  private async requestBulkClose(willClose: Tab[], run: () => void): Promise<void> {
    const dirtyCount = willClose.filter((t) => t.isDirty).length;
    if (dirtyCount > 0) {
      const ok = await this.confirmDialog(
        `${dirtyCount} tab${dirtyCount > 1 ? 's have' : ' has'} unsaved changes. Close without saving?`,
        { title: 'Unsaved Changes', confirmText: 'Close Without Saving', danger: true }
      );
      if (!ok) return;
    }
    run();
  }

  private showToast(message: string, variant: 'info' | 'error' | 'success' = 'info'): void {
    // Dedicated element so notifications never clash with the loading indicator.
    const toast = document.getElementById('app-toast');
    const toastText = document.getElementById('app-toast-text');
    if (!toast || !toastText) return;

    toastText.textContent = message;
    toast.classList.remove('hidden', 'toast-info', 'toast-error', 'toast-success');
    toast.classList.add(`toast-${variant}`);

    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, variant === 'error' ? 3400 : 1800);
  }

  // ---- Zero-data-loss safety net helpers ----

  /** Refresh a tab's on-disk modified-time baseline (best effort). */
  private async refreshTabDiskMtime(tab: Tab | null): Promise<void> {
    if (!tab || !tab.path) return;
    try {
      const info = await api.getFileInfo(tab.path);
      tab.diskMtime = info.modified;
    } catch {
      // File may have been removed; leave the baseline as-is.
    }
  }

  /** True when the file on disk is newer than the baseline we last read/wrote. */
  private async isDiskNewer(tab: Tab): Promise<boolean> {
    if (!tab.path || tab.diskMtime === undefined) return false;
    try {
      const info = await api.getFileInfo(tab.path);
      return info.modified > tab.diskMtime;
    } catch {
      return false;
    }
  }

  /** Poll the active file's mtime and warn if it changed outside PicoNote. */
  private async checkActiveFileForExternalChange(): Promise<void> {
    if (this.externalCheckInFlight) return;
    const tab = this.tabManager.getActiveTab();
    if (!tab || !tab.path || tab.diskMtime === undefined) return;
    if (tab.kind === 'image') return;

    // Don't re-prompt while the banner is already up for this file.
    const banner = document.getElementById('external-change-banner');
    if (banner && !banner.classList.contains('hidden') && banner.dataset.path === tab.path) return;

    this.externalCheckInFlight = true;
    try {
      const info = await api.getFileInfo(tab.path);
      if (info.modified > tab.diskMtime) {
        this.showExternalChangeBanner(tab);
      }
    } catch {
      // File deleted/unreadable — ignore, saving will surface a real error.
    } finally {
      this.externalCheckInFlight = false;
    }
  }

  private showExternalChangeBanner(tab: Tab): void {
    const banner = document.getElementById('external-change-banner');
    const label = document.getElementById('external-change-label');
    if (!banner) return;
    banner.dataset.path = tab.path || '';
    if (label) label.textContent = `⚠ "${tab.name}" was modified on disk`;
    banner.classList.remove('hidden');
  }

  private hideExternalChangeBanner(): void {
    const banner = document.getElementById('external-change-banner');
    if (banner) {
      banner.classList.add('hidden');
      delete banner.dataset.path;
    }
  }

  /** Discard the in-app copy and load the current on-disk version. */
  private async reloadActiveFromDisk(): Promise<void> {
    const tab = this.tabManager.getActiveTab();
    if (!tab || !tab.path) {
      this.hideExternalChangeBanner();
      return;
    }
    try {
      const content = await api.readFile(tab.path);
      const info = await api.getFileInfo(tab.path);
      tab.content = content;
      tab.savedContent = content;
      tab.isDirty = false;
      tab.diskMtime = info.modified;
      this.editor.setContent(content, tab.path);
      this.tabManager.refresh();
      this.showToast('Reloaded from disk', 'success');
    } catch (err) {
      this.showToast(`Failed to reload: ${err}`, 'error');
    }
    this.hideExternalChangeBanner();
  }

  /** Keep the in-app copy; re-baseline mtime so we stop warning and let it win on next save. */
  private async keepLocalVersion(): Promise<void> {
    const tab = this.tabManager.getActiveTab();
    if (tab && tab.path) {
      await this.refreshTabDiskMtime(tab);
    }
    this.hideExternalChangeBanner();
  }
}




// Start application
document.addEventListener('DOMContentLoaded', () => {
  new PicoNoteApp();
});
