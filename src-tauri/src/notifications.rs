// Mirrors new Windows toast notifications into the notch ("notch-notification" event).
use std::collections::HashSet;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};

#[derive(Clone, serde::Serialize)]
struct NotchNotification {
    app: String,
    title: String,
    body: String,
    icon: Option<String>,
    aumid: String,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        unsafe {
            use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let Ok(listener) = UserNotificationListener::Current() else {
            crate::diagnostics::log("notifications: listener unavailable");
            return;
        };
        if listener.GetAccessStatus().ok() != Some(UserNotificationListenerAccessStatus::Allowed) {
            crate::diagnostics::log(&format!("notifications: access {:?}", listener.GetAccessStatus()));
            return;
        }
        // shortcut: polls every 1.5 s because the change event needs package identity; switch if the app gets packaged.
        crate::diagnostics::log("notifications: listening");
        let mut seen: Option<HashSet<u32>> = None;
        loop {
            if let Ok(list) = listener.GetNotificationsAsync(NotificationKinds::Toast).and_then(|op| op.get()) {
                let mut current = HashSet::new();
                for n in list {
                    let Ok(id) = n.Id() else { continue };
                    current.insert(id);
                    // First pass only records what is already in the action center.
                    if seen.as_ref().is_some_and(|s| !s.contains(&id)) {
                        let note = read(&n);
                        crate::diagnostics::log(&format!("notifications: new id={id} parsed={}", note.is_some()));
                        if let Some(note) = note {
                            let _ = app.emit("notch-notification", note);
                        }
                    }
                }
                seen = Some(current);
            }
            std::thread::sleep(Duration::from_millis(1500));
        }
    });
}

fn read(n: &UserNotification) -> Option<NotchNotification> {
    let app = n
        .AppInfo()
        .and_then(|a| a.DisplayInfo())
        .and_then(|d| d.DisplayName())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let binding = n
        .Notification()
        .ok()?
        .Visual()
        .ok()?
        .GetBinding(&KnownNotificationBindings::ToastGeneric().ok()?)
        .ok()?;
    let texts: Vec<String> = binding
        .GetTextElements()
        .ok()?
        .into_iter()
        .filter_map(|t| t.Text().ok().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .collect();
    Some(NotchNotification {
        app,
        title: texts.first().cloned().unwrap_or_default(),
        body: texts.get(1..).map(|rest| rest.join(" ")).unwrap_or_default(),
        icon: app_icon(n),
        aumid: n.AppInfo().and_then(|a| a.AppUserModelId()).map(|s| s.to_string()).unwrap_or_default(),
    })
}

/// App logo as a data URL, read from the notification's app info.
fn app_icon(n: &UserNotification) -> Option<String> {
    use base64::Engine;
    use windows::Storage::Streams::DataReader;
    let info = n.AppInfo().ok()?.DisplayInfo().ok()?;
    let stream = info
        .GetLogo(windows::Foundation::Size { Width: 128.0, Height: 128.0 })
        .ok()?
        .OpenReadAsync()
        .ok()?
        .get()
        .ok()?;
    let size = u32::try_from(stream.Size().ok()?).ok()?;
    if size == 0 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    let mime = stream.ContentType().map(|m| m.to_string()).unwrap_or_default();
    let mime = if mime.is_empty() { "image/png".to_string() } else { mime };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(buf)))
}

/// Brings up the app that sent a notification, by its registered app id.
#[tauri::command]
pub fn open_notification_app(aumid: String) {
    // The id comes from our own event, but still refuse anything that could break out of the argument.
    if aumid.is_empty() || aumid.len() > 512 || aumid.chars().any(|c| c == '"' || c.is_control()) {
        return;
    }
    unsafe {
        use windows::core::{HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let target = format!("shell:AppsFolder\\{aumid}");
        let _ = ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from("explorer.exe"), &HSTRING::from(target), PCWSTR::null(), SW_SHOWNORMAL);
    }
}
