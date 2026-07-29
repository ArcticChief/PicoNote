import { Tab, TabGroup } from './types';

export class TabManager {
  private tabs: Tab[] = [];
  private groups: TabGroup[] = [];
  private activeTabId: string | null = null;
  private onTabChange?: (activeTab: Tab | null) => void;
  private onTabsUpdated?: (tabs: Tab[], groups: TabGroup[]) => void;

  constructor(
    onTabChange?: (activeTab: Tab | null) => void,
    onTabsUpdated?: (tabs: Tab[], groups: TabGroup[]) => void
  ) {
    this.onTabChange = onTabChange;
    this.onTabsUpdated = onTabsUpdated;
  }

  public getTabs(): Tab[] {
    return this.tabs;
  }

  public getGroups(): TabGroup[] {
    return this.groups;
  }

  public exportSessionState(): { tabs: Tab[]; groups: TabGroup[]; activeTabId: string | null } {
    return {
      tabs: this.tabs,
      groups: this.groups,
      activeTabId: this.activeTabId,
    };
  }

  public restoreSessionState(state: { tabs: Tab[]; groups: TabGroup[]; activeTabId: string | null }): void {
    if (state.groups && Array.isArray(state.groups)) {
      this.groups = state.groups;
    }
    if (state.tabs && Array.isArray(state.tabs)) {
      this.tabs = state.tabs;
    }
    if (state.activeTabId && this.tabs.some((t) => t.id === state.activeTabId)) {
      this.activeTabId = state.activeTabId;
    } else if (this.tabs.length > 0) {
      this.activeTabId = this.tabs[0].id;
    } else {
      this.activeTabId = null;
    }
    this.notify();
  }


  public createGroup(name: string, color: string = 'purple'): TabGroup {
    const id = 'group-' + Math.random().toString(36).substring(2, 9);
    const newGroup: TabGroup = { id, name, color, collapsed: false };
    this.groups.push(newGroup);
    this.notify();
    return newGroup;
  }

  public renameGroup(groupId: string, name: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (group) {
      group.name = name;
      this.notify();
    }
  }

  public setGroupColor(groupId: string, color: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (group) {
      group.color = color;
      this.tabs.forEach((t) => {
        if (t.groupId === groupId) {
          t.colorTag = color;
        }
      });
      this.notify();
    }
  }

  public toggleGroupCollapse(groupId: string): void {
    const group = this.groups.find((g) => g.id === groupId);
    if (group) {
      group.collapsed = !group.collapsed;
      this.notify();
    }
  }

  public removeGroup(groupId: string, closeTabs: boolean = false): void {
    if (closeTabs) {
      this.tabs = this.tabs.filter((t) => t.groupId !== groupId);
    } else {
      this.tabs.forEach((t) => {
        if (t.groupId === groupId) t.groupId = null;
      });
    }
    this.groups = this.groups.filter((g) => g.id !== groupId);
    if (!this.tabs.some((t) => t.id === this.activeTabId)) {
      this.activeTabId = this.tabs.length > 0 ? this.tabs[0].id : null;
    }
    this.notify();
  }

  public assignTabToGroup(tabId: string, groupId: string | null): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.groupId = groupId;
      if (groupId) {
        const grp = this.groups.find((g) => g.id === groupId);
        if (grp) tab.colorTag = grp.color;
      }
      this.notify();
    }
  }


  public reorderTab(sourceId: string, targetId: string): void {
    const sourceIdx = this.tabs.findIndex((t) => t.id === sourceId);
    const targetIdx = this.tabs.findIndex((t) => t.id === targetId);
    if (sourceIdx !== -1 && targetIdx !== -1 && sourceIdx !== targetIdx) {
      const [movedTab] = this.tabs.splice(sourceIdx, 1);
      this.tabs.splice(targetIdx, 0, movedTab);
      this.notify();
    }
  }

  public getActiveTab(): Tab | null {

    return this.tabs.find((t) => t.id === this.activeTabId) || null;
  }


  public openTab(path: string | null, name: string, content: string): Tab {
    return this.findOrOpenTab(path, name, content, true);
  }

  public findOrOpenTab(path: string | null, name: string, content: string, activate: boolean = true): Tab {
    if (path) {
      const existing = this.tabs.find((t) => t.path === path);
      if (existing) {
        if (activate) {
          this.activeTabId = existing.id;
          this.notify();
        }
        return existing;
      }
    }

    const id = 'tab-' + Math.random().toString(36).substring(2, 9);
    const newTab: Tab = {
      id,
      path,
      name,
      content,
      savedContent: content,
      isDirty: false,
      language: this.detectLanguage(name),
      pinned: false,
    };

    this.tabs.push(newTab);
    if (activate) {
      this.activeTabId = id;
    }
    this.notify();
    return newTab;
  }


  public closeTab(id: string): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    this.tabs.splice(index, 1);

    if (this.activeTabId === id) {
      if (this.tabs.length > 0) {
        const nextIndex = Math.min(index, this.tabs.length - 1);
        this.activeTabId = this.tabs[nextIndex].id;
      } else {
        this.activeTabId = null;
      }
    }

    this.notify();
  }

  public closeOtherTabs(id: string): void {
    this.tabs = this.tabs.filter((t) => t.id === id || t.pinned);
    this.activeTabId = id;
    this.notify();
  }

  public closeTabsToRight(id: string): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    this.tabs = this.tabs.filter((t, idx) => idx <= index || t.pinned);
    if (!this.tabs.some((t) => t.id === this.activeTabId)) {
      this.activeTabId = id;
    }
    this.notify();
  }

  public togglePin(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) {
      tab.pinned = !tab.pinned;
      // Sort pinned tabs to the left
      this.tabs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      this.notify();
    }
  }

  public setColorTag(id: string, colorTag: string | undefined): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab) {
      tab.colorTag = colorTag;
      this.notify();
    }
  }

  public closeAllTabs(): void {
    this.tabs = this.tabs.filter((t) => t.pinned);
    if (this.tabs.length > 0) {
      this.activeTabId = this.tabs[0].id;
    } else {
      this.activeTabId = null;
    }
    this.notify();
  }

  public setActiveTab(id: string): void {
    if (this.tabs.some((t) => t.id === id)) {
      this.activeTabId = id;
      this.notify();
    }
  }

  public updateActiveContent(content: string): void {
    const active = this.getActiveTab();
    if (!active) return;

    active.content = content;
    active.isDirty = active.content !== active.savedContent;
    if (this.onTabsUpdated) this.onTabsUpdated(this.tabs, this.groups);
  }

  public markActiveSaved(newPath?: string, newName?: string): void {
    const active = this.getActiveTab();
    if (!active) return;

    if (newPath) active.path = newPath;
    if (newName) {
      active.name = newName;
      active.language = this.detectLanguage(newName);
    }
    active.savedContent = active.content;
    active.isDirty = false;
    this.notify();
  }

  /** Force a re-render/notify without mutating tab data (used after external reload). */
  public refresh(): void {
    this.notify();
  }

  /** Keep open tabs consistent when a file/folder is renamed or moved on disk. */
  public handleExternalRename(oldPath: string, newPath: string): void {
    let changed = false;
    for (const t of this.tabs) {
      if (!t.path) continue;
      if (t.path === oldPath) {
        t.path = newPath;
        t.name = newPath.replace(/\\/g, '/').split('/').pop() || t.name;
        t.language = this.detectLanguage(t.name);
        t.diskMtime = undefined;
        changed = true;
      } else if (t.path.startsWith(oldPath + '\\') || t.path.startsWith(oldPath + '/')) {
        // Descendant of a renamed/moved folder.
        t.path = newPath + t.path.slice(oldPath.length);
        t.diskMtime = undefined;
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  /** Close tabs whose file (or containing folder) was deleted/trashed on disk. */
  public handleExternalDelete(path: string): void {
    const before = this.tabs.length;
    this.tabs = this.tabs.filter((t) => {
      if (!t.path) return true;
      return !(t.path === path || t.path.startsWith(path + '\\') || t.path.startsWith(path + '/'));
    });
    if (this.tabs.length === before) return;
    if (!this.tabs.some((t) => t.id === this.activeTabId)) {
      this.activeTabId = this.tabs.length > 0 ? this.tabs[0].id : null;
    }
    this.notify();
  }

  private notify(): void {
    if (this.onTabsUpdated) this.onTabsUpdated(this.tabs, this.groups);
    if (this.onTabChange) this.onTabChange(this.getActiveTab());
  }


  private detectLanguage(name: string): string {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    const map: Record<string, string> = {
      '.md': 'Markdown',
      '.markdown': 'Markdown',
      '.js': 'JavaScript',
      '.jsx': 'JSX',
      '.ts': 'TypeScript',
      '.tsx': 'TSX',
      '.py': 'Python',
      '.html': 'HTML',
      '.css': 'CSS',
      '.json': 'JSON',
      '.xml': 'XML',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.sh': 'Shell',
      '.rs': 'Rust',
      '.go': 'Go',
      '.c': 'C',
      '.cpp': 'C++',
      '.h': 'Header',
      '.sql': 'SQL',
      '.txt': 'Plain Text',
    };
    return map[ext] || 'Plain Text';
  }
}
