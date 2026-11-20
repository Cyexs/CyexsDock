#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod elevate;
mod known_folders;
mod payload;
mod registry;
mod shortcuts;
mod state;
mod uninstall;

use tauri::Manager;

fn fit_to_screen(window: &tauri::WebviewWindow) {
    const WIDTH: f64 = 620.0;
    const HEIGHT: f64 = 560.0;
    const MARGIN: f64 = 0.9;
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let avail_w = monitor.size().width as f64 / scale * MARGIN;
    let avail_h = monitor.size().height as f64 / scale * MARGIN;
    let _ = window.set_size(tauri::LogicalSize::new(WIDTH.min(avail_w), HEIGHT.min(avail_h)));
    let _ = window.center();
}

/// Windows 10 may ship without the WebView2 runtime, and without it the installer UI cannot open.
fn webview2_installed() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    const CLIENT: &str = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let keys = [
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\WOW6432Node\{CLIENT}")),
        (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\{CLIENT}")),
        (HKEY_CURRENT_USER, format!(r"Software\{CLIENT}")),
    ];
    let pv: Vec<u16> = "pv\0".encode_utf16().collect();
    keys.iter().any(|(root, path)| {
        let path_w: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buf = [0u16; 64];
        let mut size = std::mem::size_of_val(&buf) as u32;
        let ok = unsafe {
            RegGetValueW(*root, PCWSTR(path_w.as_ptr()), PCWSTR(pv.as_ptr()), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut _), Some(&mut size))
        }
        .is_ok();
        let version = String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]);
        ok && !version.is_empty() && version != "0.0.0.0"
    })
}

fn main() {
    if !webview2_installed() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONWARNING, MB_YESNO};
        let answer = unsafe {
            MessageBoxW(
                None,
                w!("Nectar kurulumu için Microsoft WebView2 gerekli. İndirme şimdi başlatılsın mı? Kurduktan sonra bu kurulumu yeniden açın.\n\nNectar Setup needs Microsoft WebView2. Download it now? Run this setup again after installing it."),
                w!("Nectar Setup"),
                MB_YESNO | MB_ICONWARNING,
            )
        };
        if answer == IDYES {
            let _ = commands::open_url("https://go.microsoft.com/fwlink/p/?LinkId=2124703".into());
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_initial_state,
            commands::pick_install_dir,
            commands::needs_elevation,
            commands::relaunch_elevated,
            commands::start_install,
            commands::launch_app,
            commands::open_install_folder,
            commands::open_url,
            commands::start_uninstall,
            commands::window_minimize,
            commands::window_close,
            commands::ui_ready,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            fit_to_screen(&window);
            #[cfg(target_os = "windows")]
            {
                // Mica is Windows 11 only; blur keeps the transparent window readable on Windows 10.
                if window_vibrancy::apply_mica(&window, None).is_err() {
                    let _ = window_vibrancy::apply_blur(&window, Some((12, 12, 14, 200)));
                }
            }
            let fallback = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(2500));
                let _ = fallback.show();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the installer");
}
