import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { FileItem, FileInfo, SearchResult } from './types';

export const api = {
  showWindow: async (): Promise<void> => {
    return await invoke<void>('show_window');
  },

  windowMinimize: async (): Promise<void> => {

    return await invoke<void>('window_minimize');
  },

  windowToggleMaximize: async (): Promise<void> => {
    return await invoke<void>('window_toggle_maximize');
  },

  windowClose: async (): Promise<void> => {
    return await invoke<void>('window_close');
  },

  windowStartDrag: async (): Promise<void> => {
    return await invoke<void>('window_start_drag');
  },

  openUrl: async (url: string): Promise<void> => {

    return await openUrl(url);
  },

  readFile: async (path: string): Promise<string> => {

    return await invoke<string>('read_file', { path });
  },

  readFileChecked: async (path: string): Promise<{ content: string; lossy: boolean }> => {
    return await invoke<{ content: string; lossy: boolean }>('read_file_checked', { path });
  },

  writeFile: async (path: string, content: string): Promise<void> => {
    return await invoke<void>('write_file', { path, content });
  },

  saveBinaryFile: async (path: string, bytes: Uint8Array): Promise<void> => {
    return await invoke<void>('save_binary_file', { path, bytes: Array.from(bytes) });
  },

  readBinaryFile: async (path: string): Promise<Uint8Array> => {
    const bytes = await invoke<number[]>('read_binary_file', { path });
    return new Uint8Array(bytes);
  },

  getImageDataUrl: async (path: string): Promise<string> => {
    const bytes = await api.readBinaryFile(path);
    const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : '';
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.bmp': 'image/bmp',
      '.png': 'image/png',
    };
    const mime = mimeMap[ext] || 'image/png';
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  },



  listDir: async (path: string): Promise<FileItem[]> => {
    return await invoke<FileItem[]>('list_dir', { path });
  },

  getFileInfo: async (path: string): Promise<FileInfo> => {
    return await invoke<FileInfo>('get_file_info', { path });
  },

  renameItem: async (oldPath: string, newPath: string): Promise<void> => {
    return await invoke<void>('rename_item', { oldPath, newPath });
  },

  deleteItem: async (path: string): Promise<void> => {
    return await invoke<void>('delete_item', { path });
  },

  trashItem: async (path: string, mainFolder: string): Promise<void> => {
    return await invoke<void>('trash_item', { path, mainFolder });
  },

  searchVault: async (folder: string, query: string): Promise<SearchResult[]> => {
    return await invoke<SearchResult[]>('search_vault', { folder, query });
  },

  createFile: async (path: string): Promise<void> => {
    return await invoke<void>('create_file', { path });
  },

  createFolder: async (path: string): Promise<void> => {
    return await invoke<void>('create_folder', { path });
  },

  pathExists: async (path: string): Promise<boolean> => {
    return await invoke<boolean>('path_exists', { path });
  },

  getCliFile: async (): Promise<string | null> => {
    return await invoke<string | null>('get_cli_file');
  },


  showOpenFileDialog: async (): Promise<string | null> => {
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Open File in PicoNote',
    });
    return typeof selected === 'string' ? selected : null;
  },

  showOpenFolderDialog: async (): Promise<string | null> => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: 'Open Folder in PicoNote',
    });
    return typeof selected === 'string' ? selected : null;
  },

  showSaveFileDialog: async (defaultName?: string): Promise<string | null> => {
    const selected = await save({
      defaultPath: defaultName || 'untitled.md',
      title: 'Save File',
    });
    return typeof selected === 'string' ? selected : null;
  },
};
