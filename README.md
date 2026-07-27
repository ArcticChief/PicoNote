<div align="center">

# 📝 PicoNote

**A sleek, frameless, lightning-fast desktop Markdown & Code Editor built with Tauri v2, Rust, TypeScript & CodeMirror 6.**

![PicoNote Banner](https://raw.githubusercontent.com/ArcticChief/PicoNote/main/src-tauri/icons/128x128.png)

[![Tauri v2](https://img.shields.io/badge/Tauri-v2.0-blue.svg?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange.svg?logo=rust)](https://www.rust-lang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg?logo=typescript)](https://www.typescriptlang.org)
[![CodeMirror 6](https://img.shields.io/badge/CodeMirror-v6-black.svg)](https://codemirror.net/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ✨ Features

- **🎨 Modern Frameless UI**: Sleek dark mode design system with custom window titlebar, soft ambient window outline glow, and native window action controls (Minimize, Maximize/Restore, Close, Window Dragging).
- **🖼️ Native Image Clipboard Pasting**: Press `Ctrl+V` to paste image data from your clipboard directly into Markdown documents. Images are automatically saved into an `assets/` subfolder, inserted as relative GFM links `![Image](assets/...)`, and rendered instantly using secure Blob Object URLs.
- **👁️ Live Markdown Preview & Resizable Splitter**: GFM live preview panel featuring a draggable vertical resizer divider and one-click close button (`✕`) or shortcut (`Ctrl+Shift+M`).
- **📂 Advanced File Explorer & Drag-and-Drop**:
  - Drag and drop files or subfolders inside the sidebar to move them instantly.
  - Drag external files from your Windows desktop or File Explorer into PicoNote.
  - Sleek 2-row sidebar toolbar with quick actions (New File, New Folder, Collapse/Expand All, Refresh).
  - Integrated search filter bar for instant file matching.
  - Smart viewport-clamped right-click context menus (`📂 Reveal in Explorer`, `✏️ Rename`, `🗑️ Move to Trash`).
- **📑 Tab Manager & Color Tags**: Pin tabs, apply color tags (Purple, Blue, Green, Amber, Red), view unsaved changes (`●`), scrollable tab bar, and an "All Open Tabs" dropdown menu.
- **🖼️ Native Image Viewer**: Double-click `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, or `.bmp` files to view them in a dedicated viewer tab with dark grid backdrop and dimension badge.
- **🔍 Spotlight Search & Command Palette**:
  - `Ctrl+P`: Instant Spotlight vault search across all files and contents.
  - `Ctrl+Shift+P`: Command Palette to execute all editor actions with keyboard shortcuts.

---

## 🛠️ Tech Stack

- **Core**: Tauri v2 + Rust
- **Frontend**: TypeScript, HTML5, Vanilla CSS Design System
- **Editor**: CodeMirror 6 (with syntax highlighting for 100+ languages, line numbers, autocomplete, and GFM extensions)
- **Build System**: Vite

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Rust](https://www.rust-lang.org/) (latest stable toolchain)
- Windows C++ Build Tools (for Tauri compilation)

### Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/ArcticChief/PicoNote.git
   cd PicoNote
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run Development Mode**:
   ```bash
   npm run tauri dev
   ```

4. **Build Production Installer & Executables**:
   ```bash
   npm run tauri build
   ```

   *Target executables will be compiled to `src-tauri/target/release/bundle/nsis/PicoNote_1.0.0_x64-setup.exe` and `src-tauri/target/release/piconote.exe`.*

---

## 🎹 Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + N` | New File |
| `Ctrl + O` | Open File |
| `Ctrl + Shift + O` | Set Workspace Folder |
| `Ctrl + S` | Save File |
| `Ctrl + Shift + S` | Save File As... |
| `Ctrl + Shift + M` | Toggle Live Markdown Preview |
| `Ctrl + Shift + O` | Toggle Heading Outline Drawer |
| `Ctrl + P` | Spotlight Vault Search |
| `Ctrl + Shift + P` | Command Palette |
| `Ctrl + Shift + T` | Toggle Dark / Light Theme |
| `Ctrl + V` | Paste Image from Clipboard into Document |

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
