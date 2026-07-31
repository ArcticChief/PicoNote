import { TabManager } from './tabs';
import { Tab, TabGroup } from './types';
import { escapeHtml } from './util';
import { getFileIconSvg } from './icons';
import { positionContextMenu } from './menu';
import { promptDialog } from './dialogs';

interface TabBarDeps {
  tabManager: TabManager;
  requestCloseTab: (id: string) => Promise<void>;
  requestBulkClose: (willClose: Tab[], run: () => void) => void;
  newFile: () => void;
}

/**
 * Owns the editor tab bar: rendering tabs + groups, drag reorder/grouping, the
 * all-tabs dropdown, and the tab/group/tabs-bar context menus and group modals.
 * The app drives it via render(); everything else is wired internally.
 */
export class TabBarView {
  private tabsContainer: HTMLElement;

  constructor(private deps: TabBarDeps) {
    this.tabsContainer = document.getElementById('tabs-container') as HTMLElement;
    this.wireStaticControls();
  }

  private get tabManager(): TabManager {
    return this.deps.tabManager;
  }

  // ---- Rendering ----

  public render(tabs: Tab[], groups: TabGroup[] = []): void {
    this.tabsContainer.innerHTML = '';
    const active = this.tabManager.getActiveTab();

    const allTabsText = document.getElementById('btn-all-tabs-text');
    if (allTabsText) allTabsText.textContent = `Tabs (${tabs.length})`;

    // 1. Render group containers and their assigned tabs
    groups.forEach((g) => {
      const groupTabs = tabs.filter((t) => t.groupId === g.id);

      const groupContainer = document.createElement('div');
      groupContainer.className = `tab-group-container color-${g.color}`;

      const pill = document.createElement('div');
      pill.className = `tab-group-pill ${g.collapsed ? 'collapsed' : ''}`;
      pill.title = `Group: ${g.name} (${groupTabs.length} tabs) — Click to ${g.collapsed ? 'expand' : 'collapse'}, Right-click to manage`;
      pill.innerHTML = `
        <span class="group-dot color-${g.color}"></span>
        <span class="group-name">${escapeHtml(g.name)}</span>
        <span class="group-count">(${groupTabs.length})</span>
        <span class="group-arrow">▾</span>
      `;

      pill.addEventListener('click', () => this.tabManager.toggleGroupCollapse(g.id));
      pill.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showGroupContextMenu(e.clientX, e.clientY, g);
      });

      // Drag & drop onto group container to join group
      groupContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        groupContainer.classList.add('drag-over');
      });
      groupContainer.addEventListener('dragleave', () => groupContainer.classList.remove('drag-over'));
      groupContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        groupContainer.classList.remove('drag-over');
        const sourceId = e.dataTransfer?.getData('text/plain');
        if (sourceId) this.tabManager.assignTabToGroup(sourceId, g.id);
      });

      groupContainer.appendChild(pill);

      if (!g.collapsed) {
        groupTabs.forEach((tab) => this.appendTabElement(tab, active, g.color, groupContainer));
      }

      this.tabsContainer.appendChild(groupContainer);
    });

    // 2. Render ungrouped tabs
    tabs.filter((t) => !t.groupId).forEach((tab) => this.appendTabElement(tab, active));

    // Auto-scroll active tab into view
    setTimeout(() => {
      const activeEl = this.tabsContainer.querySelector('.tab.active') as HTMLElement | null;
      activeEl?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }, 50);
  }

  private appendTabElement(tab: Tab, active: Tab | null, groupColor?: string, targetContainer?: HTMLElement): void {
    const el = document.createElement('div');
    const inGroupClass = groupColor ? `in-group-${groupColor}` : '';
    el.className = `tab ${active && active.id === tab.id ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${inGroupClass}`;
    el.setAttribute('title', tab.path || tab.name);
    el.setAttribute('draggable', 'true');
    if (tab.colorTag) el.setAttribute('data-color-tag', tab.colorTag);

    el.innerHTML = `
      <span class="tab-icon">${getFileIconSvg(tab.name, 13)}</span>
      <span class="tab-title">${escapeHtml(tab.name)}</span>
      ${tab.pinned ? '<span class="tab-pin-icon" title="Pinned">📌</span>' : ''}
      ${tab.isDirty ? '<span class="tab-dot" title="Unsaved changes"></span>' : ''}
      ${!tab.pinned ? `<span class="tab-close" data-id="${tab.id}">&times;</span>` : ''}
    `;

    // HTML5 drag & drop reordering & grouping
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', tab.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      const sourceId = e.dataTransfer?.getData('text/plain');
      if (sourceId && sourceId !== tab.id) {
        this.tabManager.reorderTab(sourceId, tab.id);
        this.tabManager.assignTabToGroup(sourceId, tab.groupId || null);
      }
    });
    el.addEventListener('dragend', () => {
      document.querySelectorAll('.tab, .tab-group-pill, .tab-group-container').forEach((t) => {
        t.classList.remove('dragging', 'drag-over');
      });
    });

    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('tab-close')) {
        e.stopPropagation();
        this.deps.requestCloseTab(tab.id);
      } else {
        this.tabManager.setActiveTab(tab.id);
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showTabContextMenu(e.clientX, e.clientY, tab);
    });

    (targetContainer || this.tabsContainer).appendChild(el);
  }

  // ---- All-tabs dropdown ----

  private renderAllTabsDropdown(query: string = ''): void {
    const listEl = document.getElementById('all-tabs-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const active = this.tabManager.getActiveTab();
    const filtered = this.tabManager.getTabs().filter(
      (t) => t.name.toLowerCase().includes(query) || (t.path && t.path.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="welcome-msg">No matching open tabs</div>';
      return;
    }

    filtered.forEach((tab) => {
      const item = document.createElement('div');
      item.className = `tabs-dropdown-item ${active && active.id === tab.id ? 'active' : ''}`;
      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <span>${getFileIconSvg(tab.name, 13)}</span>
          <span style="font-weight:600; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(tab.name)}</span>
          ${tab.pinned ? '📌' : ''}
          ${tab.isDirty ? '●' : ''}
        </div>
        <span class="tab-close" data-id="${tab.id}">&times;</span>
      `;

      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('tab-close')) {
          e.stopPropagation();
          this.deps.requestCloseTab(tab.id).then(() => this.renderAllTabsDropdown(query));
        } else {
          this.tabManager.setActiveTab(tab.id);
          document.getElementById('all-tabs-dropdown')?.classList.add('hidden');
        }
      });

      listEl.appendChild(item);
    });
  }

  // ---- Static wiring (scroll, dropdown, tabs-bar context menu) ----

  private wireStaticControls(): void {
    // Tabs-bar right-click (empty area) context menu
    this.tabsContainer.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (target === this.tabsContainer || target.id === 'editor-tabs-bar' || target.id === 'tabs-container') {
        e.preventDefault();
        e.stopPropagation();
        this.showTabsBarContextMenu(e.clientX, e.clientY);
      }
    });

    const tabsBar = document.getElementById('editor-tabs-bar');
    tabsBar?.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (target === tabsBar || target.classList.contains('tabs-left') || target.classList.contains('tabs-scroll')) {
        e.preventDefault();
        e.stopPropagation();
        this.showTabsBarContextMenu(e.clientX, e.clientY);
      }
    });

    document.getElementById('btn-tab-scroll-left')?.addEventListener('click', () => {
      this.tabsContainer.scrollBy({ left: -220, behavior: 'smooth' });
    });
    document.getElementById('btn-tab-scroll-right')?.addEventListener('click', () => {
      this.tabsContainer.scrollBy({ left: 220, behavior: 'smooth' });
    });

    const allTabsBtn = document.getElementById('btn-all-tabs');
    const allTabsDropdown = document.getElementById('all-tabs-dropdown');
    const allTabsSearch = document.getElementById('all-tabs-search') as HTMLInputElement | null;

    allTabsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      allTabsDropdown?.classList.toggle('hidden');
      if (allTabsDropdown && !allTabsDropdown.classList.contains('hidden') && allTabsSearch) {
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

    // Mouse wheel → horizontal scroll of the tab strip
    this.tabsContainer.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        this.tabsContainer.scrollLeft += e.deltaY;
      }
    });
  }

  // ---- Context menus ----

  private positionMenu(menu: HTMLElement, x: number, y: number): void {
    positionContextMenu(menu, x, y);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
  }

  private showTabContextMenu(x: number, y: number, tab: Tab): void {
    document.getElementById('context-menu')?.remove();
    const groups = this.tabManager.getGroups();

    const menu = document.createElement('div');
    menu.id = 'context-menu';

    let groupsHtml = '';
    if (groups.length > 0) {
      groupsHtml += `<div class="ctx-divider"></div>`;
      groups.forEach((g) => {
        if (tab.groupId !== g.id) {
          groupsHtml += `<div class="ctx-item tab-ctx-assign-grp" data-grp-id="${g.id}">📂 Move to Group: ${escapeHtml(g.name)}</div>`;
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

    this.positionMenu(menu, x, y);

    menu.querySelector('#tab-ctx-pin')?.addEventListener('click', () => this.tabManager.togglePin(tab.id));
    menu.querySelector('#tab-ctx-new-grp')?.addEventListener('click', () => this.promptNewGroup(tab.id));
    menu.querySelector('#tab-ctx-ungrp')?.addEventListener('click', () => this.tabManager.assignTabToGroup(tab.id, null));

    menu.querySelectorAll('.tab-ctx-assign-grp').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const grpId = (e.currentTarget as HTMLElement).getAttribute('data-grp-id');
        if (grpId) this.tabManager.assignTabToGroup(tab.id, grpId);
      });
    });

    const colors: Array<[string, string | undefined]> = [
      ['purple', 'purple'], ['blue', 'blue'], ['green', 'green'],
      ['amber', 'amber'], ['red', 'red'], ['none', undefined],
    ];
    colors.forEach(([id, value]) => {
      menu.querySelector(`#tab-ctx-color-${id}`)?.addEventListener('click', () => this.tabManager.setColorTag(tab.id, value));
    });

    menu.querySelector('#tab-ctx-close-others')?.addEventListener('click', () => {
      const willClose = this.tabManager.getTabs().filter((t) => t.id !== tab.id && !t.pinned);
      this.deps.requestBulkClose(willClose, () => this.tabManager.closeOtherTabs(tab.id));
    });
    menu.querySelector('#tab-ctx-close-right')?.addEventListener('click', () => {
      const tabs = this.tabManager.getTabs();
      const idx = tabs.findIndex((t) => t.id === tab.id);
      const willClose = idx === -1 ? [] : tabs.filter((t, i) => i > idx && !t.pinned);
      this.deps.requestBulkClose(willClose, () => this.tabManager.closeTabsToRight(tab.id));
    });
    menu.querySelector('#tab-ctx-close')?.addEventListener('click', () => this.deps.requestCloseTab(tab.id));
  }

  private showGroupContextMenu(x: number, y: number, group: TabGroup): void {
    document.getElementById('context-menu')?.remove();

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

    this.positionMenu(menu, x, y);

    menu.querySelector('#grp-ctx-rename')?.addEventListener('click', () => this.promptRenameGroup(group));
    (['purple', 'blue', 'emerald', 'amber', 'rose'] as const).forEach((color) => {
      menu.querySelector(`#grp-ctx-color-${color}`)?.addEventListener('click', () => this.tabManager.setGroupColor(group.id, color));
    });
    menu.querySelector('#grp-ctx-toggle')?.addEventListener('click', () => this.tabManager.toggleGroupCollapse(group.id));
    menu.querySelector('#grp-ctx-ungroup-all')?.addEventListener('click', () => this.tabManager.removeGroup(group.id, false));
    menu.querySelector('#grp-ctx-close-tabs')?.addEventListener('click', () => this.tabManager.removeGroup(group.id, true));
  }

  private showTabsBarContextMenu(x: number, y: number): void {
    document.getElementById('context-menu')?.remove();
    const groups = this.tabManager.getGroups();

    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.innerHTML = `
      <div class="ctx-item" id="tabsbar-ctx-new-group">📁 Create New Empty Group...</div>
      <div class="ctx-item" id="tabsbar-ctx-new-tab">➕ New Tab</div>
      ${groups.length > 0 ? '<div class="ctx-divider"></div><div class="ctx-item" id="tabsbar-ctx-toggle-groups">↕️ Toggle Collapse / Expand All Groups</div>' : ''}
      <div class="ctx-divider"></div>
      <div class="ctx-item danger" id="tabsbar-ctx-close-all">❌ Close All Unpinned Tabs</div>
    `;

    this.positionMenu(menu, x, y);

    menu.querySelector('#tabsbar-ctx-new-group')?.addEventListener('click', () => this.promptNewGroup());
    menu.querySelector('#tabsbar-ctx-new-tab')?.addEventListener('click', () => this.deps.newFile());
    menu.querySelector('#tabsbar-ctx-toggle-groups')?.addEventListener('click', () => {
      const gs = this.tabManager.getGroups();
      const anyExpanded = gs.some((g) => !g.collapsed);
      gs.forEach((g) => {
        if (g.collapsed !== anyExpanded) this.tabManager.toggleGroupCollapse(g.id);
      });
    });
    menu.querySelector('#tabsbar-ctx-close-all')?.addEventListener('click', () => {
      const willClose = this.tabManager.getTabs().filter((t) => !t.pinned);
      this.deps.requestBulkClose(willClose, () => this.tabManager.closeAllTabs());
    });
  }

  // ---- Group modals ----

  private promptNewGroup(defaultTabId?: string): void {
    document.getElementById('new-group-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'new-group-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="grp-modal-card">
        <div class="grp-modal-header">
          <h3 class="grp-modal-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Create Tab Group
          </h3>
          <button id="close-grp-modal" class="preview-close-btn">&times;</button>
        </div>

        <div class="grp-modal-field">
          <label class="grp-modal-label">GROUP NAME</label>
          <input type="text" id="grp-name-input" class="search-input" placeholder="e.g. Project Docs, Ideas..." autofocus />
        </div>

        <div class="grp-modal-field">
          <label class="grp-modal-label">ACCENT COLOR</label>
          <div class="grp-color-picker" id="grp-color-picker">
            <button type="button" class="color-opt-btn selected" data-color="purple"></button>
            <button type="button" class="color-opt-btn" data-color="blue"></button>
            <button type="button" class="color-opt-btn" data-color="emerald"></button>
            <button type="button" class="color-opt-btn" data-color="amber"></button>
            <button type="button" class="color-opt-btn" data-color="rose"></button>
          </div>
        </div>

        <div class="grp-modal-actions">
          <button id="cancel-grp-btn" class="tb-btn">Cancel</button>
          <button id="confirm-grp-btn" class="tb-btn primary">Create Group</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let selectedColor = 'purple';
    const input = overlay.querySelector('#grp-name-input') as HTMLInputElement;
    input.focus();

    overlay.querySelectorAll('.color-opt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.color-opt-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedColor = btn.getAttribute('data-color') || 'purple';
      });
    });

    const submit = () => {
      const name = input.value.trim() || 'New Group';
      const grp = this.tabManager.createGroup(name, selectedColor);
      if (defaultTabId) this.tabManager.assignTabToGroup(defaultTabId, grp.id);
      overlay.remove();
    };

    overlay.querySelector('#confirm-grp-btn')?.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') overlay.remove();
    });
    overlay.querySelector('#close-grp-modal')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#cancel-grp-btn')?.addEventListener('click', () => overlay.remove());
  }

  private async promptRenameGroup(group: TabGroup): Promise<void> {
    const name = await promptDialog('', {
      title: 'Rename Group',
      defaultValue: group.name,
      confirmText: 'Save',
    });
    if (name) this.tabManager.renameGroup(group.id, name);
  }
}
