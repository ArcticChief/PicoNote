import { api } from './api';
import { Tab } from './types';

type ToastFn = (message: string, variant?: 'info' | 'error' | 'success') => void;

/**
 * Owns the image viewer canvas: zoom / pan / rotate / background modes, the
 * broken-image fallback, and blob Object-URL lifecycle. Self-contained — it wires
 * its own DOM listeners in the constructor and exposes show/hide to the app.
 */
export class ImageViewerController {
  private zoom = 1.0;
  private rotation = 0;
  private bgMode: 'dark' | 'light' | 'checkerboard' = 'dark';
  private panX = 0;
  private panY = 0;
  private isPanning = false;
  private panStart = { x: 0, y: 0 };
  private currentUrl: string | null = null;

  constructor(
    private showToast: ToastFn,
    private getActiveTab: () => Tab | null
  ) {
    this.wireControls();
  }

  private wireControls(): void {
    document.getElementById('img-btn-zoom-in')?.addEventListener('click', () => this.setZoom(this.zoom + 0.25));
    document.getElementById('img-btn-zoom-out')?.addEventListener('click', () => this.setZoom(this.zoom - 0.25));
    document.getElementById('img-btn-zoom-reset')?.addEventListener('click', () => this.reset());
    document.getElementById('img-btn-rotate')?.addEventListener('click', () => this.setRotation(this.rotation + 90));
    document.getElementById('img-btn-bg-toggle')?.addEventListener('click', () => this.toggleBgMode());

    document.getElementById('img-btn-copy-md')?.addEventListener('click', () => {
      const activeTab = this.getActiveTab();
      if (activeTab && activeTab.path) {
        const relativePath = activeTab.path.replace(/\\/g, '/');
        navigator.clipboard.writeText(`![${activeTab.name}](${relativePath})`);
        this.showToast('Markdown Tag Copied 📋');
      }
    });

    const viewport = document.getElementById('image-viewer-viewport');
    viewport?.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom + (e.deltaY < 0 ? 0.15 : -0.15));
    });
    viewport?.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isPanning = true;
        this.panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStart.x;
        this.panY = e.clientY - this.panStart.y;
        this.updateTransform();
      }
    });
    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });
  }

  /** Load and display an image; shows a graceful fallback on failure. */
  public showImage(filePath: string, name: string): void {
    const img = document.getElementById('image-viewer-img') as HTMLImageElement | null;
    const info = document.getElementById('image-viewer-info');
    const fallback = document.getElementById('image-viewer-fallback');
    const fallbackText = document.getElementById('image-viewer-fallback-text');

    // Release the previous blob URL before creating a new one.
    this.releaseUrl();

    api.getImageDataUrl(filePath).then((dataUrl) => {
      this.currentUrl = dataUrl;
      if (img) {
        fallback?.classList.add('hidden');
        img.style.display = '';
        img.src = dataUrl;
        img.onload = () => {
          if (info) info.textContent = `${name} — ${img.naturalWidth} × ${img.naturalHeight} px`;
        };
        img.onerror = () => {
          this.releaseUrl();
          img.style.display = 'none';
          if (fallbackText) fallbackText.textContent = `Image unavailable — ${name}`;
          fallback?.classList.remove('hidden');
        };
      }
    }).catch((err) => {
      if (img) img.style.display = 'none';
      if (fallbackText) fallbackText.textContent = `Image unavailable — ${err}`;
      fallback?.classList.remove('hidden');
      if (info) info.textContent = '';
    });
  }

  /** Called when leaving the viewer for a text document. */
  public hide(): void {
    this.releaseUrl();
  }

  public dispose(): void {
    this.releaseUrl();
  }

  private releaseUrl(): void {
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  private setZoom(zoom: number): void {
    this.zoom = Math.max(0.1, Math.min(5.0, Math.round(zoom * 100) / 100));
    this.updateTransform();
  }

  private setRotation(degrees: number): void {
    this.rotation = degrees % 360;
    this.updateTransform();
  }

  private toggleBgMode(): void {
    const card = document.getElementById('image-viewer-card');
    if (!card) return;
    card.classList.remove(`bg-${this.bgMode}`);
    if (this.bgMode === 'dark') this.bgMode = 'light';
    else if (this.bgMode === 'light') this.bgMode = 'checkerboard';
    else this.bgMode = 'dark';
    card.classList.add(`bg-${this.bgMode}`);
    this.showToast(`Canvas BG: ${this.bgMode.toUpperCase()}`);
  }

  private reset(): void {
    this.zoom = 1.0;
    this.rotation = 0;
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  }

  private updateTransform(): void {
    const img = document.getElementById('image-viewer-img') as HTMLImageElement | null;
    const label = document.getElementById('img-zoom-label');
    if (!img) return;
    img.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom}) rotate(${this.rotation}deg)`;
    if (label) label.textContent = `${Math.round(this.zoom * 100)}%`;
  }
}
