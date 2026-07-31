// Shared geometry for popup context menus: append to the body and clamp the
// menu inside the viewport at the requested (x, y). Callers own their own
// open/close lifecycle since that differs per menu.
export function positionContextMenu(menu: HTMLElement, x: number, y: number): void {
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const margin = 10;
  let posX = x;
  let posY = y;
  if (posX + rect.width > window.innerWidth - margin) posX = window.innerWidth - rect.width - margin;
  if (posY + rect.height > window.innerHeight - margin) posY = window.innerHeight - rect.height - margin;
  menu.style.left = `${Math.max(margin, posX)}px`;
  menu.style.top = `${Math.max(margin, posY)}px`;
}
