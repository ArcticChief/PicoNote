export interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  is_file: boolean;
  size: number;
}

export interface FileInfo {
  size: number;
  is_directory: boolean;
  is_file: boolean;
  modified: number;
}

export interface SearchResult {
  path: string;
  file_name: string;
  line_number: number;
  line_content: string;
  match_type: string;
}

export interface TabGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

export interface Tab {
  id: string;
  path: string | null;
  name: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  language: string;
  pinned?: boolean;
  colorTag?: string;
  groupId?: string | null;
  scrollPosition?: number;
  cursorOffset?: number;
}



export interface TocItem {
  level: number;
  text: string;
  id: string;
  line: number;
}

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}
