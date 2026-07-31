use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::Serialize;

#[derive(Serialize)]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FileReadResult {
    pub content: String,
    pub lossy: bool,
}

#[derive(Serialize)]
pub struct FileInfo {
    pub size: u64,
    pub is_directory: bool,
    pub is_file: bool,
    pub modified: u64,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub path: String,
    pub file_name: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_type: String,
}

/// Reads a file as text, replacing any invalid UTF-8. Use `read_file_checked`
/// when the caller needs to know whether the bytes were actually valid.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    Ok(read_file_checked(path)?.content)
}


/// Reads a file, reporting whether the bytes were valid UTF-8. Callers use the
/// `lossy` flag to open non-text files read-only so a later save can't corrupt them.
#[tauri::command]
fn read_file_checked(path: String) -> Result<FileReadResult, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(FileReadResult { content: text, lossy: false }),
        Err(err) => Ok(FileReadResult {
            content: String::from_utf8_lossy(err.as_bytes()).to_string(),
            lossy: true,
        }),
    }
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);

    // Build a sibling temp path (.<filename>.tmp) in the same directory so the
    // final rename stays on the same volume and is therefore atomic. The leading
    // dot also keeps the temp file out of the explorer (list_dir skips dotfiles).
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "untitled".to_string());
    let tmp_path = match target.parent() {
        Some(dir) => dir.join(format!(".{}.tmp", file_name)),
        None => Path::new(&format!(".{}.tmp", file_name)).to_path_buf(),
    };

    // Write the full content to the temp file first. If anything fails here the
    // original file on disk is left untouched.
    if let Err(e) = fs::write(&tmp_path, &content) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.to_string());
    }

    // Atomically replace the target. On Windows fs::rename maps to MoveFileExW
    // with MOVEFILE_REPLACE_EXISTING, so this replaces an existing file in place.
    if let Err(e) = fs::rename(&tmp_path, target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.to_string());
    }

    Ok(())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<FileItem>, String> {
    let dir = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut items = Vec::new();

    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files and trash folder in explorer view
        if name.starts_with('.') || name == ".trash" {
            continue;
        }

        let entry_path = entry.path().to_string_lossy().to_string();
        let metadata = entry.metadata();
        let (is_directory, is_file, size) = match metadata {
            Ok(m) => (m.is_dir(), m.is_file(), m.len()),
            Err(_) => (false, false, 0),
        };

        items.push(FileItem {
            name,
            path: entry_path,
            is_directory,
            is_file,
            size,
        });
    }

    items.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            b.is_directory.cmp(&a.is_directory)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(items)
}

#[tauri::command]
fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(FileInfo {
        size: metadata.len(),
        is_directory: metadata.is_dir(),
        is_file: metadata.is_file(),
        modified,
    })
}

#[tauri::command]
fn rename_item(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_item(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn trash_item(path: String, main_folder: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("File or folder does not exist".to_string());
    }

    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unnamed".to_string());

    let trash_dir = Path::new(&main_folder).join(".trash");
    if !trash_dir.exists() {
        fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let dest = trash_dir.join(format!("{}_{}", timestamp, file_name));
    fs::rename(target, dest).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_vault(folder: String, query: String) -> Result<Vec<SearchResult>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    walk_and_search(Path::new(&folder), &q, &mut results)?;
    results.truncate(50);
    Ok(results)
}

fn walk_and_search(dir: &Path, query: &str, results: &mut Vec<SearchResult>) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') || name == "node_modules" || name == "dist" || name == "target" {
            continue;
        }

        if path.is_dir() {
            let _ = walk_and_search(&path, query, results);
        } else if path.is_file() {
            let path_str = path.to_string_lossy().to_string();
            let name_lower = name.to_lowercase();

            if name_lower.contains(query) {
                results.push(SearchResult {
                    path: path_str.clone(),
                    file_name: name.clone(),
                    line_number: 1,
                    line_content: name.clone(),
                    match_type: "name".to_string(),
                });
            }

            if let Ok(content) = fs::read_to_string(&path) {
                for (idx, line) in content.lines().enumerate() {
                    if line.to_lowercase().contains(query) {
                        results.push(SearchResult {
                            path: path_str.clone(),
                            file_name: name.clone(),
                            line_number: idx + 1,
                            line_content: line.trim().to_string(),
                            match_type: "content".to_string(),
                        });
                        if results.len() >= 50 {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn get_cli_file() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let arg = &args[1];
        if !arg.starts_with('-') && Path::new(arg).is_file() {
            return Some(arg.clone());
        }
    }
    None
}

#[tauri::command]
fn save_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
fn window_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
fn window_start_drag(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn show_window(window: tauri::Window) {
    let _ = window.show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_file_checked,
            write_file,
            read_binary_file,
            save_binary_file,
            show_window,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_start_drag,
            list_dir,
            get_file_info,
            rename_item,
            delete_item,
            trash_item,
            search_vault,
            create_file,
            create_folder,
            path_exists,
            get_cli_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}





