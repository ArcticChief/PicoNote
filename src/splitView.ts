import { api } from './api';
import { CodeMirrorEditor } from './editor';
import { TabManager } from './tabs';
import { Tab } from './types';

interface SplitViewDeps {
  tabManager: TabManager;
  getMainEditor: () => CodeMirrorEditor;
  isDark: () => boolean;
  isAutoSaveEnabled: () => boolean;
  isDiskNewer: (tab: Tab) => Promise<boolean>;
  refreshTabDiskMtime: (tab: Tab | null) => Promise<void>;
  showExternalChangeBanner: (tab: Tab) => void;
}

/**
 * Owns the second editor pane: its CodeMirror instance, the snapshot/read-only
 * parity logic, the pane file selectors, and pane-2 autosave. The app orchestrates
 * when to enable/disable it (so it can manage preview/outline buttons) and
 * delegates all pane mechanics here.
 */
export class SplitViewController {
  private editor2: CodeMirrorEditor | null = null;
  private pane2Id: string | null = null;
  private active = false;

  constructor(private deps: SplitViewDeps) {}

  public isActive(): boolean {
    return this.active;
  }

  /** Tab id currently shown in pane 2 (session-persistable). */
  public get pane2TabId(): string | null {
    return this.pane2Id;
  }

  public setTheme(isDark: boolean): void {
    this.editor2?.setTheme(isDark);
  }

  /** Show the split panes and open a sensible second document. */
  public enable(): void {
    this.active = true;
    const pane1Header = document.getElementById('pane1-header');
    const pane2 = document.getElementById('editor-pane-2');
    const resizer = document.getElementById('split-resizer');
    document.getElementById('btn-split-editor')?.classList.add('active');

    pane1Header?.classList.remove('hidden');
    if (pane1Header) pane1Header.style.display = 'flex';
    pane2?.classList.remove('hidden');
    resizer?.classList.remove('hidden');

    this.populateSelects();

    const tabs = this.deps.tabManager.getTabs();
    const activeTab = this.deps.tabManager.getActiveTab();
    const secondTab = tabs.find((t) => t.id !== activeTab?.id) || activeTab;
    if (secondTab) {
      this.openInPane2({ id: secondTab.id, path: secondTab.path || undefined, name: secondTab.name });
    }
    this.checkReadOnly();
  }

  /** Hide the split panes and release the second editor instance. */
  public disable(): void {
    this.active = false;
    const pane1Header = document.getElementById('pane1-header');
    const pane2 = document.getElementById('editor-pane-2');
    const resizer = document.getElementById('split-resizer');
    document.getElementById('btn-split-editor')?.classList.remove('active');

    pane1Header?.classList.add('hidden');
    if (pane1Header) pane1Header.style.display = 'none';
    pane2?.classList.add('hidden');
    resizer?.classList.add('hidden');

    const pane1 = document.getElementById('editor-pane-1');
    if (pane1) {
      pane1.style.width = '';
      pane1.style.flex = '1';
    }

    if (this.editor2) {
      this.editor2.destroy();
      this.editor2 = null;
    }
    this.pane2Id = null;
  }

  public syncToLatest(): void {
    if (!this.active || !this.editor2) return;
    const activeTab = this.deps.tabManager.getActiveTab();
    if (activeTab) {
      this.editor2.setContent(activeTab.content, activeTab.path || activeTab.name);
      this.checkReadOnly();
    }
  }

  public populateSelects(): void {
    const select1 = document.getElementById('pane1-file-select') as HTMLSelectElement | null;
    const select2 = document.getElementById('pane2-file-select') as HTMLSelectElement | null;
    if (!select1 || !select2) return;

    const activeTab = this.deps.tabManager.getActiveTab();
    select1.innerHTML = '<option value="">-- Select Document --</option>';
    select2.innerHTML = '<option value="">-- Select Document --</option>';

    const tabs = this.deps.tabManager.getTabs();
    tabs.forEach((t) => {
      const opt1 = document.createElement('option');
      opt1.value = t.id;
      opt1.textContent = `📄 ${t.name}${t.isDirty ? ' ●' : ''}`;
      if (activeTab && t.id === activeTab.id) opt1.selected = true;
      select1.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = t.id;
      opt2.textContent = `📄 ${t.name}${t.isDirty ? ' ●' : ''}`;
      if (this.pane2Id && t.id === this.pane2Id) opt2.selected = true;
      select2.appendChild(opt2);
    });

    if (activeTab) select1.value = activeTab.id;
    if (this.pane2Id) {
      const targetTab = tabs.find((t) => t.id === this.pane2Id);
      if (targetTab) select2.value = targetTab.id;
    }
  }

  public checkReadOnly(): void {
    if (!this.active || !this.editor2) return;

    const activeTab = this.deps.tabManager.getActiveTab();
    const isSame = !!(activeTab && this.pane2Id && activeTab.id === this.pane2Id);
    this.editor2.setReadOnly(isSame);

    const badge = document.getElementById('pane2-parity-badge');
    const syncBtn = document.getElementById('btn-sync-pane2');
    const pane2Title = document.querySelector('#editor-pane-2 .split-pane-title') as HTMLElement | null;

    if (isSame && activeTab) {
      const inSync = activeTab.content === this.editor2.getContent();

      if (badge) {
        badge.classList.remove('hidden');
        if (inSync) {
          badge.className = 'split-parity-badge in-sync';
          badge.innerHTML = `<span class="parity-dot"></span><span class="parity-text">In Sync</span>`;
          badge.title = 'Pane 2 snapshot is identical to Pane 1 (Latest)';
        } else {
          badge.className = 'split-parity-badge out-of-sync';
          badge.innerHTML = `<span class="parity-dot"></span><span class="parity-text">Out of Sync</span>`;
          badge.title = 'Pane 1 has new changes. Click to sync Pane 2 to latest version.';
        }
      }

      if (syncBtn) syncBtn.classList.toggle('hidden', inSync);

      if (pane2Title) {
        pane2Title.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          <span style="color:#fbbf24; font-weight:700;">SNAPSHOT</span>
        `;
        pane2Title.title = 'Pane 2 is a static reference snapshot. Click Sync to refresh to latest version.';
      }
    } else {
      if (badge) badge.classList.add('hidden');
      if (syncBtn) syncBtn.classList.add('hidden');
      if (pane2Title) {
        pane2Title.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
          PANE 2
        `;
        pane2Title.title = '';
      }
    }
  }

  public async openInPane2(target: { id?: string; path?: string; name: string }): Promise<void> {
    const container2 = document.getElementById('editor-container-2');
    if (!this.editor2 && container2) {
      this.editor2 = new CodeMirrorEditor(container2);
      this.editor2.setTheme(this.deps.isDark());
    }

    let content = '';
    const existingTab = target.id
      ? this.deps.tabManager.getTabs().find((t) => t.id === target.id)
      : this.deps.tabManager.getTabs().find((t) => t.path === target.path);

    // Track pane 2 strictly by tab id to avoid mismatching files with equal names.
    this.pane2Id = existingTab ? existingTab.id : (target.id || null);

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

    if (!this.editor2) return;
    this.editor2.setContent(content, target.path || target.name);
    this.checkReadOnly();
    this.populateSelects();

    this.editor2.setOnChange(async (newContent) => {
      const tab = target.id
        ? this.deps.tabManager.getTabs().find((t) => t.id === target.id)
        : this.deps.tabManager.getTabs().find((t) => t.path === target.path);

      if (tab) {
        tab.content = newContent;
        tab.isDirty = true;
      }

      const active = this.deps.tabManager.getActiveTab();
      if (active && (active.id === target.id || (active.path && active.path === target.path))) {
        const mainEditor = this.deps.getMainEditor();
        if (mainEditor.getContent() !== newContent) {
          mainEditor.setContent(newContent, target.path || target.name);
        }
      }

      if (this.deps.isAutoSaveEnabled() && target.path) {
        const tab2 = this.deps.tabManager.getTabs().find((t) => t.path === target.path);
        if (tab2 && (await this.deps.isDiskNewer(tab2))) {
          this.deps.showExternalChangeBanner(tab2);
        } else {
          await api.writeFile(target.path, newContent);
          if (tab2) await this.deps.refreshTabDiskMtime(tab2);
        }
      }
    });
  }
}
