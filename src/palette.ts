import { Command } from './types';

export class CommandPalette {
  private overlayEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private listEl: HTMLElement;
  private commands: Command[] = [];
  private selectedIndex: number = 0;
  private filteredCommands: Command[] = [];

  constructor() {
    this.overlayEl = document.getElementById('command-palette') as HTMLElement;
    this.inputEl = document.getElementById('command-input') as HTMLInputElement;
    this.listEl = document.getElementById('command-list') as HTMLElement;

    this.inputEl.addEventListener('input', () => this.onInput());
    this.inputEl.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.hide();
      }
    });
  }

  public registerCommands(commands: Command[]): void {
    this.commands = commands;
  }

  public show(): void {
    this.overlayEl.classList.remove('hidden');
    this.inputEl.value = '';
    this.inputEl.focus();
    this.filter('');
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

  private filter(query: string): void {
    const q = query.toLowerCase().trim();
    this.filteredCommands = this.commands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.shortcut && c.shortcut.toLowerCase().includes(q))
    );
    this.selectedIndex = 0;
    this.render();
  }

  private onInput(): void {
    this.filter(this.inputEl.value);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.hide();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (this.filteredCommands.length > 0) {
        this.selectedIndex = (this.selectedIndex + 1) % this.filteredCommands.length;
        this.render();
      }
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      if (this.filteredCommands.length > 0) {
        this.selectedIndex =
          (this.selectedIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
        this.render();
      }
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (this.filteredCommands[this.selectedIndex]) {
        const cmd = this.filteredCommands[this.selectedIndex];
        this.hide();
        cmd.action();
      }
      e.preventDefault();
    }
  }

  private render(): void {
    this.listEl.innerHTML = '';

    if (this.filteredCommands.length === 0) {
      this.listEl.innerHTML = '<div class="palette-empty">No matching commands</div>';
      return;
    }

    this.filteredCommands.forEach((cmd, idx) => {
      const item = document.createElement('div');
      item.className = `palette-item ${idx === this.selectedIndex ? 'selected' : ''}`;
      item.innerHTML = `
        <span class="palette-label">${cmd.label}</span>
        ${cmd.shortcut ? `<span class="palette-shortcut">${cmd.shortcut}</span>` : ''}
      `;
      item.addEventListener('click', () => {
        this.hide();
        cmd.action();
      });
      this.listEl.appendChild(item);
    });
  }
}
