export function escapeHtml(str: string): string {
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

// ---- Path / filename helpers ----
// Paths are Windows-style (`\`) throughout the app, but these normalize `/` too
// so they work on any separator a file path might arrive with.

/** Lowercase file extension including the leading dot (e.g. `.md`), or `''` if none. */
export function getExtension(name: string): string {
  return name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
}

/** Final path segment (file or folder name), or `''` for an empty path. */
export function getBasename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

/** Containing directory of a path, or `null` when there is no separator. */
export function getDirname(path: string): string | null {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i === -1 ? null : path.substring(0, i);
}

/** Short, collision-resistant id with a semantic prefix (e.g. `tab-a1b2c3d`). */
export function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 9)}`;
}

/** Image extensions PicoNote renders in the dedicated image viewer. */
export const IMAGE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
] as const;

export function isImageFile(name: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(getExtension(name));
}
