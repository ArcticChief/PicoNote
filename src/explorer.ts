import { api } from './api';
import { FileItem } from './types';
import { getBasename, getDirname } from './util';
import { getFileIconSvg } from './icons';
import { positionContextMenu } from './menu';
import { confirmDialog, promptDialog } from './dialogs';

let draggedItemPath: string | null = null;

export function getDraggedExplorerItemPath(): string | null {
  return draggedItemPath;
}

export class FileExplorer {


  private container: HTMLElement;
  private pathInput: HTMLInputElement;
  private searchInput: HTMLInputElement;
  private currentFolder: string | null = null;
  private expandedFolders: Set<string> = new Set();
  private filterQuery: string = '';
  private favorites: Set<string> = new Set(JSON.parse(localStorage.getItem('piconote-favorites') || '[]'));
  private onFileSelect?: (filePath: string) => void;
  private onOpenFileInSplit?: (filePath: string) => void;
  private onToast?: (message: string, variant?: 'info' | 'error' | 'success') => void;
  private onFileRenamed?: (oldPath: string, newPath: string) => void;
  private onFileDeleted?: (path: string) => void;
  private activeFilePath: string | null = null;

  private toast(message: string, variant: 'info' | 'error' | 'success' = 'info'): void {
    if (this.onToast) this.onToast(message, variant);
    else console.warn('[explorer]', message);
  }

  public setActiveFilePath(filePath: string | null): void {
    this.activeFilePath = filePath;
    this.updateActiveHighlight();
  }

  public updateActiveHighlight(): void {
    if (!this.container) return;

    const prevActive = this.container.querySelectorAll('.tree-row.active-file');
    prevActive.forEach((el) => el.classList.remove('active-file'));

    if (!this.activeFilePath) return;

    try {
      const targetRow = this.container.querySelector(`.tree-row[data-path="${CSS.escape(this.activeFilePath)}"]`);
      if (targetRow) {
        targetRow.classList.add('active-file');
      }
    } catch {
      // Ignore querySelector syntax errors if any
    }
  }


  constructor(
    containerId: string,
    pathInputId: string,
    searchInputId: string,
    onFileSelect?: (filePath: string) => void,
    onOpenFileInSplit?: (filePath: string) => void,
    onToast?: (message: string, variant?: 'info' | 'error' | 'success') => void,
    onFileRenamed?: (oldPath: string, newPath: string) => void,
    onFileDeleted?: (path: string) => void
  ) {
    this.container = document.getElementById(containerId) as HTMLElement;
    this.pathInput = document.getElementById(pathInputId) as HTMLInputElement;
    this.searchInput = document.getElementById(searchInputId) as HTMLInputElement;
    this.onFileSelect = onFileSelect;
    this.onOpenFileInSplit = onOpenFileInSplit;
    this.onToast = onToast;
    this.onFileRenamed = onFileRenamed;
    this.onFileDeleted = onFileDeleted;


    this.pathInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = this.pathInput.value.trim();
        if (val) this.openFolder(val);
      }
    });

    this.searchInput?.addEventListener('input', () => {
      this.filterQuery = this.searchInput.value.trim().toLowerCase();
      if (this.currentFolder) this.refresh();
    });

    this.renderFavorites();
  }

  public renderFavorites(): void {
    const container = document.getElementById('favorites-container');
    const listEl = document.getElementById('favorites-list');
    if (!container || !listEl) return;

    if (this.favorites.size === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    listEl.innerHTML = '';

    this.favorites.forEach((favPath) => {
      const filename = getBasename(favPath) || favPath;
      const item = document.createElement('div');
      item.className = 'favorite-item';
      item.innerHTML = `<span>⭐</span><span>${filename}</span>`;
      item.addEventListener('click', () => {
        if (this.onFileSelect) this.onFileSelect(favPath);
      });
      listEl.appendChild(item);
    });
  }


  public getCurrentFolder(): string | null {
    return this.currentFolder;
  }

  public async openFolder(folderPath: string): Promise<void> {
    const exists = await api.pathExists(folderPath);
    if (!exists) {
      this.toast(`Folder does not exist: ${folderPath}`, 'error');
      return;
    }

    this.currentFolder = folderPath;
    if (this.pathInput) this.pathInput.value = folderPath;
    this.expandedFolders.clear();
    this.expandedFolders.add(folderPath);
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.container) return;

    if (!this.currentFolder) {
      this.container.innerHTML = '<div class="welcome-msg">Open a folder to view files</div>';
      return;
    }


    this.container.innerHTML = '';
    const rootEl = await this.renderDirectory(this.currentFolder);
    this.container.appendChild(rootEl);
  }

  private async renderDirectory(dirPath: string): Promise<HTMLElement> {
    const ul = document.createElement('ul');
    ul.className = 'file-tree';

    try {
      const items = await api.listDir(dirPath);

      for (const item of items) {
        if (
          this.filterQuery &&
          !item.is_directory &&
          !item.name.toLowerCase().includes(this.filterQuery)
        ) {
          continue;
        }

        const li = document.createElement('li');
        li.className = item.is_directory ? 'tree-folder' : 'tree-file';

        const row = document.createElement('div');
        row.className = 'tree-row';
        if (this.activeFilePath && item.path === this.activeFilePath) {
          row.classList.add('active-file');
        }
        row.setAttribute('data-path', item.path);


        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        if (item.is_directory) {
          const isExpanded = this.expandedFolders.has(item.path);
          icon.innerHTML = isExpanded
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 14l1-6h14l-2 10H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v2"></path></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        } else {
          icon.innerHTML = getFileIconSvg(item.name);
        }


        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = item.name;

        row.appendChild(icon);
        row.appendChild(name);
        li.appendChild(row);

        if (item.is_directory) {
          const isExpanded = this.expandedFolders.has(item.path);
          if (isExpanded) {
            const subDir = await this.renderDirectory(item.path);
            li.appendChild(subDir);
          }

          row.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (this.expandedFolders.has(item.path)) {
              this.expandedFolders.delete(item.path);
            } else {
              this.expandedFolders.add(item.path);
            }
            await this.refresh();
          });
        } else {
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.onFileSelect) {
              this.onFileSelect(item.path);
            }
          });
        }

        // Context Menu Event
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.showContextMenu(e.clientX, e.clientY, item);
        });

        // Drag & Drop Reordering & External File Moving
        row.draggable = true;

        row.addEventListener('dragstart', (e) => {
          draggedItemPath = item.path;
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', item.path);
            e.dataTransfer.effectAllowed = 'all';
          }
          row.classList.add('dragging-source');
        });


        row.addEventListener('dragend', () => {
          row.classList.remove('dragging-source');
          draggedItemPath = null;
        });

        row.addEventListener('dragenter', (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.add('drop-target-active');
        });

        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          row.classList.add('drop-target-active');
        });

        row.addEventListener('dragleave', (e) => {
          e.stopPropagation();
          row.classList.remove('drop-target-active');
        });

        row.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drop-target-active');

          const srcPath = draggedItemPath || e.dataTransfer?.getData('text/plain');
          draggedItemPath = null;

          const targetDir = item.is_directory ? item.path : (getDirname(item.path) ?? item.path);

          // 1. External files dropped from Windows File Explorer
          if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            const files = e.dataTransfer.files;
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const buffer = await file.arrayBuffer();
              const destPath = `${targetDir}\\${file.name}`;
              await api.saveBinaryFile(destPath, new Uint8Array(buffer));
            }
            await this.refresh();
            return;
          }

          // 2. Internal file / folder move
          if (srcPath && srcPath !== item.path) {
            const filename = getBasename(srcPath);
            if (!filename) return;
            const destPath = `${targetDir}\\${filename}`;
            if (srcPath !== destPath) {
              try {
                await api.renameItem(srcPath, destPath);
                if (this.onFileRenamed) this.onFileRenamed(srcPath, destPath);
                await this.refresh();
              } catch (err: any) {
                this.toast(`Could not move item: ${err}`, 'error');
              }
            }
          }
        });


        ul.appendChild(li);
      }
    } catch (err: any) {
      const errLi = document.createElement('li');
      errLi.className = 'tree-error';
      errLi.textContent = `Error: ${err}`;
      ul.appendChild(errLi);
    }

    return ul;
  }

  public async toggleCollapseExpandAll(): Promise<void> {
    if (!this.currentFolder) return;
    if (this.expandedFolders.size > 1) {
      this.expandedFolders.clear();
      this.expandedFolders.add(this.currentFolder);
    } else {
      await this.expandAllRecursively(this.currentFolder);
    }
    await this.refresh();
  }

  private async expandAllRecursively(dirPath: string): Promise<void> {
    this.expandedFolders.add(dirPath);
    try {
      const items = await api.listDir(dirPath);
      for (const item of items) {
        if (item.is_directory) {
          await this.expandAllRecursively(item.path);
        }
      }
    } catch (_) {}
  }

  private showContextMenu(x: number, y: number, item: FileItem): void {
    const existing = document.getElementById('context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'context-menu';

    const isFav = this.favorites.has(item.path);
    const splitOption = !item.is_directory ? `<div class="ctx-item" id="ctx-open-split">↔️ Open in Split View</div><div class="ctx-divider"></div>` : '';

    menu.innerHTML = `
      <div class="ctx-item" id="ctx-fav">${isFav ? '⭐ Remove Favorite' : '⭐ Pin to Favorites'}</div>
      ${splitOption}
      <div class="ctx-item" id="ctx-new-file">➕ New File Here</div>
      <div class="ctx-item" id="ctx-new-folder">📁 New Folder Here</div>
      <div class="ctx-item" id="ctx-reveal">📂 Reveal in System Explorer</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" id="ctx-rename">✏️ Rename</div>
      <div class="ctx-item danger" id="ctx-delete">🗑️ Delete</div>
    `;

    positionContextMenu(menu, x, y);

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('contextmenu', onDocumentClick);
    };

    const onDocumentClick = (evt: MouseEvent) => {
      if (!menu.contains(evt.target as Node)) {
        closeMenu();
      }
    };

    setTimeout(() => {
      document.addEventListener('click', onDocumentClick);
      document.addEventListener('contextmenu', onDocumentClick);
    }, 0);

    if (!item.is_directory) {
      menu.querySelector('#ctx-open-split')?.addEventListener('click', () => {
        closeMenu();
        if (this.onOpenFileInSplit) {
          this.onOpenFileInSplit(item.path);
        }
      });
    }

    menu.querySelector('#ctx-fav')?.addEventListener('click', () => {

      closeMenu();
      if (this.favorites.has(item.path)) {
        this.favorites.delete(item.path);
      } else {
        this.favorites.add(item.path);
      }
      localStorage.setItem('piconote-favorites', JSON.stringify(Array.from(this.favorites)));
      this.renderFavorites();
    });

    const targetDir = item.is_directory ? item.path : (getDirname(item.path) ?? item.path);

    menu.querySelector('#ctx-new-file')?.addEventListener('click', async () => {
      closeMenu();
      const fileName = await promptDialog('', {
        title: 'New File',
        defaultValue: 'untitled.md',
        placeholder: 'File name',
        confirmText: 'Create',
      });
      if (fileName) {
        const fullPath = `${targetDir}\\${fileName}`;
        await api.createFile(fullPath);
        await this.refresh();
        if (this.onFileSelect) this.onFileSelect(fullPath);
      }
    });

    menu.querySelector('#ctx-new-folder')?.addEventListener('click', async () => {
      closeMenu();
      const folderName = await promptDialog('', {
        title: 'New Folder',
        placeholder: 'Folder name',
        confirmText: 'Create',
      });
      if (folderName) {
        const fullPath = `${targetDir}\\${folderName}`;
        await api.createFolder(fullPath);
        await this.refresh();
      }
    });

    menu.querySelector('#ctx-reveal')?.addEventListener('click', () => {
      closeMenu();
      const folderToReveal = item.is_directory ? item.path : (getDirname(item.path) ?? item.path);
      api.openUrl(folderToReveal);
    });

    menu.querySelector('#ctx-rename')?.addEventListener('click', async () => {
      closeMenu();
      const newName = await promptDialog('', {
        title: 'Rename',
        defaultValue: item.name,
        confirmText: 'Rename',
      });
      if (newName && newName !== item.name) {
        const parent = getDirname(item.path) ?? item.path;
        const newPath = `${parent}\\${newName}`;
        try {
          await api.renameItem(item.path, newPath);
          if (this.onFileRenamed) this.onFileRenamed(item.path, newPath);
          await this.refresh();
        } catch (err: any) {
          this.toast(`Could not rename: ${err}`, 'error');
        }
      }
    });

    menu.querySelector('#ctx-delete')?.addEventListener('click', async () => {
      closeMenu();
      const ok = await confirmDialog(`Move "${item.name}" to Trash (.trash/)?`, {
        title: 'Move to Trash',
        confirmText: 'Move to Trash',
        danger: true,
      });
      if (ok) {
        try {
          if (this.currentFolder) {
            await api.trashItem(item.path, this.currentFolder);
          } else {
            await api.deleteItem(item.path);
          }
          if (this.onFileDeleted) this.onFileDeleted(item.path);
          await this.refresh();
        } catch (err: any) {
          this.toast(`Could not delete: ${err}`, 'error');
        }
      }
    });
  }
}


