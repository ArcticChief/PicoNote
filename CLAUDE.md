# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run tauri dev` — run the full desktop app (Vite dev server on `localhost:1420` + Rust backend). Use this for development, not `npm run dev` alone (that serves the frontend in a browser where all `api.*` IPC calls fail).
- `npm run tauri build` — produce release binaries. Output lands in `src-tauri/target/release/` and the NSIS installer in `src-tauri/target/release/bundle/nsis/`.
- `npm run build` — type-check (`tsc`) and build the frontend only (`vite build`). Fastest way to catch TypeScript errors without spinning up Tauri.

There is no test suite, linter, or formatter configured. Verification is `npm run build` (types) plus manual testing in `npm run tauri dev`.

## Architecture

PicoNote is a Tauri v2 desktop Markdown/code editor. A **Rust backend** (`src-tauri/`) exposes filesystem and window operations as IPC commands; a **vanilla-TypeScript frontend** (`src/`) built on CodeMirror 6 renders the UI. There is no frontend framework — DOM is manipulated directly against the static markup in `index.html`.

### The IPC boundary

`src/api.ts` is the single chokepoint for all backend calls — every `invoke()` and Tauri plugin call is wrapped here. When adding backend functionality:
1. Add a `#[tauri::command]` fn in `src-tauri/src/lib.rs` and register it in the `generate_handler![]` list at the bottom (`run()`).
2. Add a matching wrapper method to the `api` object in `src/api.ts`.
3. Note the naming convention: Rust uses `snake_case` command names and params; the JS `invoke` layer passes params as `camelCase` (Tauri auto-converts, e.g. `old_path` ↔ `oldPath`).

Frontend code should call `api.*` rather than importing `@tauri-apps/*` directly.

### Frontend structure (`src/`)

`main.ts` holds the `PicoNoteApp` orchestrator: it owns app-wide state (visibility toggles, timers, reliability guards) and wires DOM events, but delegates each feature domain to a controller/manager class it constructs and injects callbacks into:

- `editor.ts` — `CodeMirrorEditor` wraps CodeMirror 6. Language/theme/read-only are swapped via `Compartment`s. Emits change/cursor/link-click/paste-image callbacks.
- `tabs.ts` — `TabManager` is the source of truth for open tabs and tab groups. It fires `onTabChange`/`onTabsUpdated` callbacks; `main.ts` reacts to them (updates editor, saves session).
- `tabBar.ts` — `TabBarView` renders the tab strip, context menus, and dropdown from `TabManager` state.
- `explorer.ts` — `FileExplorer` renders the sidebar file tree with drag-drop, filtering, context menus.
- `splitView.ts` — `SplitViewController` manages the dual-pane (pane2) editor; owns its own CodeMirror instance and sync/parity logic.
- `imageViewer.ts` — `ImageViewerController` renders image tabs (`kind: 'image'`) with pan/zoom; manages blob-URL lifecycle.
- `spotlight.ts` / `palette.ts` — Ctrl+K vault search and Ctrl+P command palette.
- `markdown.ts` — parses Markdown (marked + DOMPurify) for preview/outline; local image `<img>`s are emitted with `data-local-path` and resolved to blob URLs later.
- `formatter.ts` — Shift+Alt+F document beautifier and Markdown table alignment.
- `theme.ts` — dark/light theme persistence.
- `types.ts` — shared interfaces; `Tab` (mirrors session-persistence shape) and the Rust `FileItem`/`FileInfo`/`SearchResult` structs.

Shared helpers (prefer these over re-implementing):
- `util.ts` — `escapeHtml` plus path/filename helpers: `getExtension`, `getBasename`, `getDirname`, `generateId`, `isImageFile` / `IMAGE_EXTENSIONS`.
- `icons.ts` — `getFileIconSvg(name, size)`, the single source for file-type icons in the explorer tree and tab bar.
- `dialogs.ts` — `confirmDialog` / `promptDialog`, the styled promise-based replacements for native `confirm()`/`prompt()`. Do not use the browser built-ins — a frameless app shouldn't surface native OS dialogs.
- `menu.ts` — `positionContextMenu`, shared viewport-clamped placement for popup menus.

### Key cross-cutting mechanisms

- **Tabs carry a `kind`** (`'text'` | `'image'`). Image tabs store no content and render from `path`. Legacy sessions used an `[IMAGE_VIEWER:...]` content sentinel — `restoreSessionState` in `main.ts` backfills `kind` for those.
- **Session persistence**: the whole workspace (tabs, groups, split state) is serialized to `localStorage` under `piconote_workspace_session_v1`, snapshotted every 5s and on `beforeunload`, and restored on launch. The main workspace folder is stored separately under `piconote-main-folder`.
- **Zero-data-loss guards** (`setupReliabilityGuards` in `main.ts`): each `Tab` tracks `diskMtime`. Before any save/autosave, `isDiskNewer` compares against disk; if the file changed externally, an "external change banner" is shown instead of clobbering. A focus + 3s-interval watcher polls the active file. Preserve this pattern when touching save logic.
- **Atomic writes**: `write_file` (Rust) writes to a sibling `.<name>.tmp` then `fs::rename`s over the target (same-volume, atomic on Windows). `list_dir` and `search_vault` skip dotfiles, so temp files never appear in the explorer.
- **UTF-8 safety**: `read_file_checked` reports a `lossy` flag for non-UTF-8 files; those tabs open read-only (`readOnlyLossy`) so a save can't corrupt binary/non-text originals.
- **Frameless window**: `decorations: false` in `tauri.conf.json`. The custom titlebar's minimize/maximize/close/drag are handled by `window_*` Rust commands invoked from `main.ts`. `dragDropEnabled: false` means OS file drops are disabled in favor of custom in-app drag-drop.

## Platform note

Development is Windows-first. Paths are built with `\\` separators throughout the frontend (e.g. pasted-image `assets\\` paths, `noteDir` splitting). Keep this in mind when editing path logic.
