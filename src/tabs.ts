import { Tab } from './types';

export class TabManager {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private onTabChange?: (activeTab: Tab | null) => void;
  private onTabsUpdated?: (tabs: Tab[]) => void;

  constructor(
    onTabChange?: (activeTab: Tab | null) => void,
    onTabsUpdated?: (tabs: Tab[]) => void
  ) {
    this.onTabChange = onTabChange;
    this.onTabsUpdated = onTabsUpdated;
  }

  public getTabs(): Tab[] {
    return this.tabs;
  }

  public getActiveTab(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeTabId) || null;
  }

  public openTab(path: string | null, name: string, content: string): Tab {
    // Check if already open by path
    if (path) {
      const existing = this.tabs.find((t) => t.path === path);
      if (existing) {
        this.activeTabId = existing.id;
        this.notify();
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
    this.activeTabId = id;
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
    if (this.onTabsUpdated) this.onTabsUpdated(this.tabs);
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

  private notify(): void {
    if (this.onTabsUpdated) this.onTabsUpdated(this.tabs);
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
