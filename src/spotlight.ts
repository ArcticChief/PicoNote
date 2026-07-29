import { api } from './api';
import { SearchResult } from './types';

export class SpotlightSearch {
  private overlayEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private resultsEl: HTMLElement;
  private selectedIndex: number = 0;
  private results: SearchResult[] = [];
  private onSelectCallback?: (path: string, lineNumber: number) => void;
  private getMainFolderCallback: () => string | null;

  constructor(
    getMainFolderCallback: () => string | null,
    onSelectCallback?: (path: string, lineNumber: number) => void
  ) {
    this.getMainFolderCallback = getMainFolderCallback;
    this.onSelectCallback = onSelectCallback;

    this.overlayEl = document.getElementById('spotlight-modal') as HTMLElement;
    this.inputEl = document.getElementById('spotlight-input') as HTMLInputElement;
    this.resultsEl = document.getElementById('spotlight-results') as HTMLElement;

    let debounceTimer: any = null;
    this.inputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.performSearch(), 120);
    });

    this.inputEl.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.hide();
      }
    });
  }

  public show(): void {
    this.overlayEl.classList.remove('hidden');
    this.inputEl.value = '';
    this.inputEl.focus();
    this.results = [];
    this.render();
  }

  public hide(): void {
    this.overlayEl.classList.add('hidden');
  }

  public toggle(): void {
    if (this.overlayEl.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  private async performSearch(): Promise<void> {
    const query = this.inputEl.value.trim();
    const mainFolder = this.getMainFolderCallback();

    if (!query || !mainFolder) {
      this.results = [];
      this.render();
      return;
    }

    try {
      this.results = await api.searchVault(mainFolder, query);
      this.selectedIndex = 0;
      this.render();
    } catch (err: any) {
      this.resultsEl.innerHTML = `<div class="spotlight-placeholder">Search error: ${err}</div>`;
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.hide();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (this.results.length > 0) {
        this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
        this.render();
      }
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      if (this.results.length > 0) {
        this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
        this.render();
      }
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (this.results[this.selectedIndex]) {
        const item = this.results[this.selectedIndex];
        this.hide();
        if (this.onSelectCallback) {
          this.onSelectCallback(item.path, item.line_number);
        }
      }
      e.preventDefault();
    }
  }

  private render(): void {
    this.resultsEl.innerHTML = '';

    if (!this.inputEl.value.trim()) {
      this.resultsEl.innerHTML =
        '<div class="spotlight-placeholder">Type to search notes and headings in your workspace...</div>';
      return;
    }

    if (this.results.length === 0) {
      this.resultsEl.innerHTML =
        '<div class="spotlight-placeholder">No matching notes or lines found</div>';
      return;
    }

    this.results.forEach((item, idx) => {
      const el = document.createElement('div');
      el.className = `spotlight-item ${idx === this.selectedIndex ? 'selected' : ''}`;
      el.innerHTML = `
        <div class="spotlight-item-header">
          <span>${escapeHtml(item.file_name)} ${item.line_number > 1 ? `(Ln ${item.line_number})` : ''}</span>
          <span class="spotlight-badge">${item.match_type}</span>
        </div>
        <div class="spotlight-item-line">${escapeHtml(item.line_content)}</div>
      `;

      el.addEventListener('click', () => {
        this.hide();
        if (this.onSelectCallback) {
          this.onSelectCallback(item.path, item.line_number);
        }
      });

      this.resultsEl.appendChild(el);
    });
  }
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}
