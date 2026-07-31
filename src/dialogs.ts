// Styled, promise-based replacements for the browser's blocking confirm()/prompt().
// Frameless windows shouldn't surface native OS dialogs, so all in-app prompts
// route through here for a consistent look.

interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface PromptOptions {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
}

/** Confirmation dialog. Resolves true on OK/Enter, false on Cancel/Escape/backdrop. */
export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
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

/** Text-input dialog. Resolves the entered string, or null on Cancel/Escape/backdrop. */
export function promptDialog(message: string, opts: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog" role="dialog" aria-modal="true">
        <div class="confirm-title"></div>
        <div class="confirm-message"></div>
        <input type="text" class="search-input confirm-input" style="width:100%; box-sizing:border-box; margin-top:4px;" />
        <div class="confirm-actions">
          <button class="confirm-btn cancel"></button>
          <button class="confirm-btn ok"></button>
        </div>
      </div>`;
    (overlay.querySelector('.confirm-title') as HTMLElement).textContent = opts.title || 'Enter Value';
    const messageEl = overlay.querySelector('.confirm-message') as HTMLElement;
    messageEl.textContent = message;
    if (!message) messageEl.style.display = 'none';

    const input = overlay.querySelector('.confirm-input') as HTMLInputElement;
    input.value = opts.defaultValue || '';
    input.placeholder = opts.placeholder || '';
    const cancelBtn = overlay.querySelector('.confirm-btn.cancel') as HTMLButtonElement;
    const okBtn = overlay.querySelector('.confirm-btn.ok') as HTMLButtonElement;
    cancelBtn.textContent = opts.cancelText || 'Cancel';
    okBtn.textContent = opts.confirmText || 'OK';

    document.body.appendChild(overlay);
    input.focus();
    input.select();

    const cleanup = (result: string | null) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const submit = () => {
      const val = input.value.trim();
      cleanup(val ? val : null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
      else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cleanup(null); });
    cancelBtn.addEventListener('click', () => cleanup(null));
    okBtn.addEventListener('click', submit);
  });
}
