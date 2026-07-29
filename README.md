# PicoNote

PicoNote is a lightweight, frameless desktop Markdown and code editor built with Tauri v2, Rust, TypeScript, and CodeMirror 6.

## Features

- **Frameless Window Interface**: Custom window title bar with native window controls (minimize, maximize, close, and drag regions) and an ambient window outline.
- **Image Clipboard Integration**: Paste image data (`Ctrl+V`) directly into Markdown documents. Images are saved to a local `assets/` directory and rendered via blob object URLs.
- **Live Markdown Preview**: Split-pane GitHub Flavored Markdown preview with a draggable vertical resizer and toggle options.
- **File Explorer**: Sidebar file tree supporting internal drag-and-drop file reordering, external file imports, collapsible directory trees, inline file filtering, and viewport-aware context menus.
- **Tab Management**: Multi-tab workspace with color tagging, pin state, dirty indicators, scrollable navigation, and a tab selection menu.
- **Media Viewer**: Dedicated image viewer tab for viewing `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, and `.bmp` files with dimension metadata.
- **Search and Navigation**:
  - `Ctrl+P`: Spotlight vault search for finding files and text content.
  - `Ctrl+Shift+P`: Command palette for executing editor actions.

## Technology Stack

- **Desktop Framework**: Tauri v2
- **Backend IPC**: Rust
- **Frontend**: TypeScript, HTML5, Vanilla CSS
- **Editor Engine**: CodeMirror 6
- **Build Tool**: Vite

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- Rust toolchain (stable)
- Windows C++ Build Tools (for Tauri compilation)

### Build Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/ArcticChief/PicoNote.git
   cd PicoNote
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run tauri dev
   ```

4. Build production binaries:
   ```bash
   npm run tauri build
   ```

Compiled executables will be located in `src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/`.

## Keyboard Shortcuts

| Command | Action |
| --- | --- |
| `Ctrl+N` | New File |
| `Ctrl+O` | Open File |
| `Ctrl+Shift+O` | Set Workspace Directory |
| `Ctrl+S` | Save File |
| `Ctrl+Shift+S` | Save File As |
| `Ctrl+W` | Close Active Tab |
| `Ctrl+B` | Toggle Sidebar |
| `Ctrl+Shift+M` | Toggle Live Preview |
| `Ctrl+K` | Spotlight Search |
| `Ctrl+P` | Command Palette |
| `Ctrl+\` | Toggle Split Editor |
| `Shift+Alt+F` | Format / Beautify Document |
| `Ctrl+Shift+T` | Toggle Dark / Light Theme |
| `Ctrl+V` | Paste Image from Clipboard |

## License

Distributed under the MIT License. See `LICENSE` for details.
