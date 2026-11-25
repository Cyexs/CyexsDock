use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tauri::{AppHandle, Emitter};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN, VK_LCONTROL,
    VK_LMENU, VK_LSHIFT, VK_LWIN,
};
use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY, WM_USER};
use windows::Win32::Foundation::{LPARAM, WPARAM};

const NOTCH_HOTKEY_ID: i32 = 1;
const RELOAD: u32 = WM_APP + 1;

static THREAD_ID: AtomicU32 = AtomicU32::new(0);

const CHAT_HOTKEY_ID: i32 = 2;
const CHAT_HOTKEY_DEFAULT: &str = "Ctrl+Alt+Space";

// false only when the chat hotkey is wanted but RegisterHotKey failed.
static CHAT_OK: AtomicBool = AtomicBool::new(true);

#[tauri::command]
pub fn chat_hotkey_ok() -> bool {
    CHAT_OK.load(Ordering::SeqCst)
}

/// Effective shortcut text: missing -> default, empty/blank -> None (off).
fn effective_spec(setting: Option<String>, default: Option<&str>) -> Option<String> {
    let spec = setting.or_else(|| default.map(str::to_string))?;
    let spec = spec.trim();
    (!spec.is_empty()).then(|| spec.to_string())
}

/// Re-registers one hotkey id; returns true when registered.
fn register(id: i32, spec: &str) -> bool {
    let Some((modifiers, key)) = crate::launchers::parse_shortcut(spec) else {
        crate::diagnostics::log(&format!("hotkey: could not read \"{spec}\""));
        return false;
    };
    let mut mods = MOD_NOREPEAT;
    for m in modifiers {
        mods |= match m {
            VK_LCONTROL => MOD_CONTROL,
            VK_LMENU => MOD_ALT,
            VK_LSHIFT => MOD_SHIFT,
            VK_LWIN => MOD_WIN,
            _ => HOT_KEY_MODIFIERS(0),
        };
    }
    match unsafe { RegisterHotKey(None, id, mods, key.0 as u32) } {
        Ok(()) => true,
        Err(e) => {
            crate::diagnostics::log(&format!("hotkey: could not register \"{spec}\": {e}"));
            false
        }
    }
}

fn apply(app: &AppHandle, registered: &mut [bool; 2]) {
    let slots = [
        (NOTCH_HOTKEY_ID, effective_spec(crate::utils::get_setting_str(app, "nectar-notch-hotkey"), None)),
        (CHAT_HOTKEY_ID, effective_spec(crate::utils::get_setting_str(app, "nectar-chat-hotkey"), Some(CHAT_HOTKEY_DEFAULT))),
    ];
    for (i, (id, spec)) in slots.into_iter().enumerate() {
        if registered[i] {
            unsafe { let _ = UnregisterHotKey(None, id); }
            registered[i] = false;
        }
        registered[i] = spec.as_deref().is_some_and(|s| register(id, s));
        if id == CHAT_HOTKEY_ID {
            CHAT_OK.store(spec.is_none() || registered[i], Ordering::SeqCst);
        }
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || unsafe {
        let mut msg = MSG::default();
        let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
        THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);
        let mut registered = [false; 2];
        apply(&app, &mut registered);
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            match msg.message {
                WM_HOTKEY => {
                    let event = if msg.wParam.0 as i32 == CHAT_HOTKEY_ID { "chat-hotkey" } else { "notch-hotkey-toggle" };
                    let _ = app.emit(event, ());
                }
                RELOAD => apply(&app, &mut registered),
                _ => {}
            }
        }
    });
}

pub fn reload() {
    let id = THREAD_ID.load(Ordering::SeqCst);
    if id != 0 {
        unsafe {
            let _ = PostThreadMessageW(id, RELOAD, WPARAM(0), LPARAM(0));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_spec_rules() {
        assert_eq!(effective_spec(None, Some("Ctrl+Alt+Space")).as_deref(), Some("Ctrl+Alt+Space"));
        assert_eq!(effective_spec(Some("".into()), Some("Ctrl+Alt+Space")), None);
        assert_eq!(effective_spec(Some(" Ctrl+K ".into()), None).as_deref(), Some("Ctrl+K"));
        assert_eq!(effective_spec(None, None), None);
    }

    #[test]
    fn default_chat_shortcut_parses() {
        assert!(crate::launchers::parse_shortcut(CHAT_HOTKEY_DEFAULT).is_some());
    }
}
