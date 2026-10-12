#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    path::PathBuf,
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{LogicalSize, Manager};

struct Companion(Mutex<Option<Child>>, AtomicBool);
struct CloseToTray(AtomicBool);
struct SaveWriter(Mutex<()>);
fn diagnostic(message: &str) {
    if std::env::var("CLAWDASH_DIAGNOSTICS").as_deref() == Ok("1") {
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(home().join("supervisor.log"))
        {
            let _ = writeln!(file, "{}", message);
        }
    }
}
fn window_policy() -> serde_json::Value {
    std::fs::read(home().join("window-policy.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(serde_json::json!({"closeToTray":false,"alwaysOnTop":false}))
}
fn save_window_policy(key: &str, enabled: bool) -> Result<(), String> {
    let mut policy = window_policy();
    policy[key] = serde_json::json!(enabled);
    std::fs::create_dir_all(home()).map_err(|e| e.to_string())?;
    let temp = home().join("window-policy.tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec(&policy).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temp, home().join("window-policy.json")).map_err(|e| e.to_string())
}
fn home() -> PathBuf {
    if let Some(path) = std::env::var_os("CLAWDASH_HOME") {
        return path.into();
    }
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("Clawdash")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local/share/clawdash")
    }
}
fn sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) {
        "clawdash-cli.exe"
    } else {
        "clawdash-cli"
    };
    let beside = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("No executable directory")?
        .join(name);
    if beside.exists() {
        return Ok(beside);
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join(name);
    if resource.exists() {
        return Ok(resource);
    }
    Err("Bundled companion missing; build the standalone sidecar first".into())
}
fn command(app: &tauri::AppHandle) -> Result<Command, String> {
    let mut cmd = Command::new(sidecar(app)?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    Ok(cmd)
}
#[tauri::command]
fn set_window_mode(window: tauri::WebviewWindow, mode: String) -> Result<(), String> {
    window
        .set_fullscreen(mode == "fullscreen")
        .map_err(|e| e.to_string())?;
    match mode.as_str() {
        "compact" => window.set_size(LogicalSize::new(640.0, 360.0)),
        "normal" => window.set_size(LogicalSize::new(1120.0, 700.0)),
        "fullscreen" => Ok(()),
        _ => return Err("Unknown window mode".into()),
    }
    .map_err(|e| e.to_string())
}
#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<(), String> {
    let enabled = !window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(enabled).map_err(|e| e.to_string())
}
#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| e.to_string())?;
    save_window_policy("alwaysOnTop", enabled)
}
#[tauri::command]
fn show_game(window: tauri::WebviewWindow, focus: bool) -> Result<(), String> {
    reveal(&window, focus)
}
fn reveal(window: &tauri::WebviewWindow, focus: bool) -> Result<(), String> {
    #[cfg(windows)]
    if !focus {
        let handle = window.hwnd().map_err(|e| e.to_string())?;
        // ShowWindow(SW_SHOW) activates even without SetFocus. Explicitly preserve the foreground app.
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                handle.0,
                windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
            );
            // The first ShowWindow can honor launcher STARTUPINFO instead of the requested flag.
            if windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible(handle.0) == 0 {
                windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                    handle.0,
                    windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
                );
            }
        }
        return Ok(());
    }
    window.show().map_err(|e| e.to_string())?;
    if focus {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn bridge_connection() -> Result<serde_json::Value, String> {
    let runtime: serde_json::Value = serde_json::from_slice(
        &std::fs::read(home().join("runtime.json")).map_err(|_| "Companion is unavailable")?,
    )
    .map_err(|_| "Invalid companion discovery")?;
    let port = runtime["port"]
        .as_u64()
        .filter(|p| *p > 0 && *p <= 65535)
        .ok_or("Invalid companion port")?;
    let token = std::fs::read_to_string(home().join("pairing-secret"))
        .map_err(|_| "Pairing unavailable")?;
    Ok(serde_json::json!({"url": format!("http://127.0.0.1:{}", port), "token": token.trim()}))
}
#[tauri::command]
async fn choose_repository(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("Choose a committed Git repository")
        .pick_folder()
        .await;
    if let Some(folder) = folder {
        let output = command(&app)?
            .arg("grant")
            .arg(folder.path())
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err("Repository authorization failed".into());
        }
        return Ok(Some(
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
        ));
    }
    Ok(None)
}
#[tauri::command]
fn manage_hooks(app: tauri::AppHandle, install: bool) -> Result<(), String> {
    let output = command(&app)?
        .args([
            "integrations",
            if install { "install" } else { "uninstall" },
            "claude",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Hook configuration failed. See the recovery guide.".into())
    }
}
#[tauri::command]
fn configure_auto_open(app: tauri::AppHandle, enabled: bool, focus: bool) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = command(&app)?;
    cmd.arg("configure-launcher").arg(exe);
    if enabled {
        cmd.arg("--auto-open");
    }
    if focus {
        cmd.arg("--focus");
    }
    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Could not save auto-open preferences".into())
    }
}
#[tauri::command]
fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    app.state::<CloseToTray>()
        .0
        .store(enabled, Ordering::Relaxed);
    save_window_policy("closeToTray", enabled)
}
#[tauri::command]
fn get_desktop_preferences(window: tauri::WebviewWindow) -> serde_json::Value {
    let launcher: serde_json::Value = std::fs::read(home().join("launcher.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let policy = window_policy();
    serde_json::json!({"autoOpen":launcher["autoOpen"].as_bool().unwrap_or(false),"focus":launcher["focus"].as_bool().unwrap_or(false),"alwaysOnTop":policy["alwaysOnTop"].as_bool().unwrap_or(false),"closeToTray":policy["closeToTray"].as_bool().unwrap_or(false),"fullscreen":window.is_fullscreen().unwrap_or(false),"processId":std::process::id(),"visible":window.is_visible().unwrap_or(false),"focused":window.is_focused().unwrap_or(false)})
}
#[tauri::command]
async fn load_save(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SaveWriter>();
        let _guard = state.0.lock().map_err(|_| "Save writer unavailable")?;
        let output = command(&app)?
            .arg("storage-load")
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err("Save validation failed; original file preserved".into());
        }
        serde_json::from_slice(&output.stdout).map_err(|_| "Invalid saved progress".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn persist_save(app: tauri::AppHandle, save: serde_json::Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        let data = serde_json::to_vec(&save).map_err(|e| e.to_string())?;
        if data.len() > 2_000_000 {
            return Err("Save exceeds size limit".into());
        }
        let state = app.state::<SaveWriter>();
        let _guard = state.0.lock().map_err(|_| "Save writer unavailable")?;
        let mut child = command(&app)?
            .arg("storage-save")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .ok_or("Save stream unavailable")?
            .write_all(&data)
            .map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err("Unable to save; original and backup preserved".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let focus = !args.iter().any(|a| a == "--agent-start")
                    || args.iter().any(|a| a == "--focus-game");
                let _ = reveal(&window, focus);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Companion(Mutex::new(None), AtomicBool::new(false)))
        .manage(CloseToTray(AtomicBool::new(false)))
        .manage(SaveWriter(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            set_window_mode,
            toggle_fullscreen,
            set_always_on_top,
            show_game,
            bridge_connection,
            choose_repository,
            manage_hooks,
            configure_auto_open,
            set_close_to_tray,
            get_desktop_preferences,
            load_save,
            persist_save
        ])
        .setup(|app| {
            let policy = window_policy();
            let close_to_tray = policy["closeToTray"].as_bool().unwrap_or(false);
            app.state::<CloseToTray>()
                .0
                .store(close_to_tray, Ordering::Relaxed);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(policy["alwaysOnTop"].as_bool().unwrap_or(false));
                let args: Vec<String> = std::env::args().collect();
                let focus = !args.iter().any(|a| a == "--agent-start")
                    || args.iter().any(|a| a == "--focus-game");
                let _ = reveal(&window, focus);
            }
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            let show = MenuItem::with_id(app, "show", "Open Clawdash", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Clawdash")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            let _ = tray.build(app)?;
            // Companion failure must never stop the standalone Arcade game.
            if let Ok(mut cmd) = command(app.handle()) {
                if let Ok(resource) = app.path().resource_dir() {
                    if let Ok(child) = cmd
                        .arg("bridge")
                        .arg("--static")
                        .arg(resource.join("web"))
                        .spawn()
                    {
                        *app.state::<Companion>().0.lock().unwrap() = Some(child);
                    }
                }
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                diagnostic("supervisor started");
                let mut consecutive_failures = 0;
                let mut healthy_ticks = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let state = handle.state::<Companion>();
                    if state.1.load(Ordering::Relaxed) {
                        break;
                    }
                    let mut child_guard = state.0.lock().unwrap();
                    let exited = match child_guard.as_mut() {
                        Some(child) => child.try_wait().ok().flatten().map(|_| child.id()),
                        None => {
                            diagnostic("no owned child");
                            break;
                        }
                    };
                    if let Some(pid) = exited {
                        diagnostic("owned child exited");
                        // A separately launched, authenticated companion remains its owner's process.
                        let discovery =
                            std::fs::read(home().join("runtime.json"))
                                .ok()
                                .and_then(|bytes| {
                                    serde_json::from_slice::<serde_json::Value>(&bytes).ok()
                                });
                        if discovery
                            .as_ref()
                            .and_then(|value| value["pid"].as_u64())
                            .is_some_and(|owner| owner != pid as u64)
                        {
                            diagnostic("external companion retained");
                            break;
                        }
                        child_guard.take();
                        drop(child_guard);
                        consecutive_failures += 1;
                        healthy_ticks = 0;
                        if consecutive_failures > 3 {
                            diagnostic("restart budget exhausted");
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_secs(consecutive_failures));
                        if state.1.load(Ordering::Relaxed) {
                            break;
                        }
                        if let (Ok(mut cmd), Ok(resource)) =
                            (command(&handle), handle.path().resource_dir())
                        {
                            if let Ok(child) = cmd
                                .arg("bridge")
                                .arg("--static")
                                .arg(resource.join("web"))
                                .spawn()
                            {
                                diagnostic("companion restarted");
                                *state.0.lock().unwrap() = Some(child);
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    } else {
                        healthy_ticks += 1;
                        if healthy_ticks >= 10 {
                            consecutive_failures = 0;
                        }
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .app_handle()
                    .state::<CloseToTray>()
                    .0
                    .load(Ordering::Relaxed)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to launch Clawdash");
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            app.state::<Companion>().1.store(true, Ordering::Relaxed);
            if let Some(mut child) = app.state::<Companion>().0.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
