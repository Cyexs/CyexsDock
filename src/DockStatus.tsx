import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Wifi, WifiOff, Volume, Volume1, Volume2, VolumeX,
  Battery, BatteryLow, BatteryMedium, BatteryFull, BatteryCharging,
  Bluetooth, Sun, Settings2, ChevronRight, ChevronLeft, Bell, BellOff,
} from 'lucide-react';
import { setVisibleInterval } from './hooks/visibleInterval';
import { ConnectionsView } from './components/ConnectionsView';

// Taskbar-style status group (Wi-Fi, volume, battery) at the right end of the dock.
// Clicking it opens Windows Quick Settings, like the native taskbar corner.
export function DockStatus({ onOpen }: { onOpen: (e: React.MouseEvent<HTMLDivElement>) => void }) {
  const [wifi, setWifi] = useState<{ enabled: boolean; connected: boolean } | null>(null);
  const [vol, setVol] = useState<{ volume: number; is_muted: boolean } | null>(null);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);

  useEffect(() => { startNotifHistory(); }, []);
  useEffect(() => {
    const readWifi = () => invoke<{ enabled: boolean; connected: boolean }>('get_wifi_status').then(setWifi).catch(() => { });
    readWifi();
    const id = setVisibleInterval(readWifi, 10000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    invoke<{ volume: number; is_muted: boolean }>('get_volume_state').then(setVol).catch(() => { });
    const un = listen<{ volume: number; is_muted: boolean }>('volume-change', (e) => setVol(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  useEffect(() => {
    let b: any = null;
    const update = () => setBattery({ level: Math.round(b.level * 100), charging: b.charging });
    invoke<boolean>('has_battery').then(async (has) => {
      if (!has || !(navigator as any).getBattery) return;
      b = await (navigator as any).getBattery();
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    }).catch(() => { });
    return () => {
      if (b) { b.removeEventListener('levelchange', update); b.removeEventListener('chargingchange', update); }
    };
  }, []);

  const size = 17;
  const WifiIcon = wifi && wifi.enabled && wifi.connected ? Wifi : WifiOff;
  const v = vol ? vol.volume : 0;
  const VolIcon = !vol || vol.is_muted || v <= 0.001 ? VolumeX : v < 0.34 ? Volume : v < 0.67 ? Volume1 : Volume2;
  const BatIcon = !battery ? null
    : battery.charging ? BatteryCharging
    : battery.level <= 20 ? BatteryLow
    : battery.level <= 60 ? BatteryMedium
    : battery.level <= 90 ? Battery
    : BatteryFull;

  const title = [
    wifi ? (wifi.connected ? 'Ağ: bağlı' : wifi.enabled ? 'Ağ: bağlı değil' : 'Wi-Fi kapalı') : 'Ağ',
    vol ? (vol.is_muted ? 'Ses: kapalı' : `Ses: %${Math.round(v * 100)}`) : 'Ses',
    battery ? `Pil: %${battery.level}${battery.charging ? ' (şarj oluyor)' : ''}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div
      className="dock-status"
      title={title}
      onClick={(e) => { e.stopPropagation(); onOpen(e); }}
    >
      <WifiIcon size={size} strokeWidth={2} />
      <VolIcon size={size} strokeWidth={2} />
      {BatIcon && battery && (
        <span className="dock-status-battery">
          <BatIcon size={size + 2} strokeWidth={2} />
          <span>{battery.level}%</span>
        </span>
      )}
    </div>
  );
}

// Quick settings panel shown above the status group, in the dock's own menu style.
export function StatusPanel({ onClose }: { onClose: () => void }) {
  const [wifiOn, setWifiOn] = useState<boolean | null>(null);
  const [wifiConnected, setWifiConnected] = useState(false);
  const [btOn, setBtOn] = useState<boolean | null>(null);
  const [vol, setVol] = useState<{ volume: number; is_muted: boolean } | null>(null);
  const [bright, setBright] = useState<number | null>(null);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  const [view, setView] = useState<'main' | 'wifi' | 'bluetooth' | 'audio' | 'notifs'>('main');
  const notifCount = useNotifHistory().length;

  useEffect(() => {
    invoke<{ enabled: boolean; connected: boolean }>('get_wifi_status').then((w) => { setWifiOn(w.enabled); setWifiConnected(w.connected); }).catch(() => { });
    invoke<boolean>('get_bluetooth_state').then(setBtOn).catch(() => { });
    invoke<{ volume: number; is_muted: boolean }>('get_volume_state').then(setVol).catch(() => { });
    invoke<number>('get_brightness').then(setBright).catch(() => { });
    invoke<boolean>('has_battery').then(async (has) => {
      if (!has || !(navigator as any).getBattery) return;
      const b = await (navigator as any).getBattery();
      setBattery({ level: Math.round(b.level * 100), charging: b.charging });
    }).catch(() => { });
    const un = listen<{ volume: number; is_muted: boolean }>('volume-change', (e) => setVol(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  const toggleWifi = () => {
    if (wifiOn === null) return;
    const next = !wifiOn;
    setWifiOn(next);
    invoke('set_wifi_state', { enabled: next }).catch(() => setWifiOn(!next));
  };
  const toggleBt = () => {
    if (btOn === null) return;
    const next = !btOn;
    setBtOn(next);
    invoke('set_bluetooth_state', { enabled: next }).catch(() => setBtOn(!next));
  };
  const open = (cmd: string) => { invoke(cmd).catch(() => { }); onClose(); };
  const v = vol ? vol.volume : 0;
  const VolIcon = !vol || vol.is_muted || v <= 0.001 ? VolumeX : v < 0.34 ? Volume : v < 0.67 ? Volume1 : Volume2;

  if (view === 'notifs') {
    return (
      <div className="status-panel status-panel-list">
        <NotifList onBack={() => setView('main')} onClose={onClose} />
      </div>
    );
  }
  if (view !== 'main') {
    const settingsCmd = view === 'wifi' ? 'open_wifi_settings' : view === 'audio' ? 'open_sound_settings' : 'open_bluetooth_settings';
    return (
      <div className="status-panel status-panel-list">
        <ConnectionsView kind={view} onBack={() => setView('main')} onOpenWindowsSettings={() => open(settingsCmd)} />
      </div>
    );
  }

  return (
    <div className="status-panel">
      <div className="status-panel-tiles">
        <div className={`status-tile${wifiOn ? ' on' : ''}`}>
          <button className="status-tile-main" onClick={toggleWifi}>
            {wifiOn ? <Wifi size={18} /> : <WifiOff size={18} />}
            <span>{wifiOn === null ? 'Wi-Fi' : !wifiOn ? 'Wi-Fi kapalı' : wifiConnected ? 'Bağlı' : 'Bağlı değil'}</span>
          </button>
          <button className="status-tile-more" title="Ağlar" onClick={() => setView('wifi')}><ChevronRight size={16} /></button>
        </div>
        <div className={`status-tile${btOn ? ' on' : ''}`}>
          <button className="status-tile-main" onClick={toggleBt}>
            <Bluetooth size={18} />
            <span>{btOn === null ? 'Bluetooth' : btOn ? 'Bluetooth açık' : 'Bluetooth kapalı'}</span>
          </button>
          <button className="status-tile-more" title="Cihazlar" onClick={() => setView('bluetooth')}><ChevronRight size={16} /></button>
        </div>
      </div>
      {bright !== null && (
        <div className="status-slider">
          <Sun size={16} />
          <input type="range" min={0} max={100} step={1} value={bright}
            onChange={(e) => { const n = Number(e.target.value); setBright(n); invoke('set_brightness', { brightness: n }).catch(() => { }); }} />
        </div>
      )}
      <div className="status-slider">
        <VolIcon size={16} />
        <input type="range" min={0} max={1} step={0.01} value={v}
          onChange={(e) => { const n = Number(e.target.value); setVol({ volume: n, is_muted: false }); invoke('set_volume', { volume: n }).catch(() => { }); }} />
        <button className="status-slider-more" title="Ses çıkışı ve uygulamalar" onClick={() => setView('audio')}><ChevronRight size={16} /></button>
      </div>
      <button className="status-row" onClick={() => setView('notifs')}>
        <Bell size={16} />
        <span>Bildirimler{notifCount ? ` (${notifCount})` : ''}</span>
        <ChevronRight size={16} />
      </button>
      <div className="menu-divider" />
      <div className="status-panel-footer">
        <span>{battery ? `Pil %${battery.level}${battery.charging ? ' · şarj oluyor' : ''}` : ''}</span>
        <div className="status-panel-links">
          <button title="Wi-Fi ayarları" onClick={() => open('open_wifi_settings')}><Wifi size={15} /></button>
          <button title="Ses ayarları" onClick={() => open('open_sound_settings')}><Volume2 size={15} /></button>
          <button title="Windows hızlı ayarları" onClick={() => open('open_quick_settings')}><Settings2 size={15} /></button>
        </div>
      </div>
    </div>
  );
}

// Taskbar-style clock and date at the far right of the dock; opens the calendar window.
export function DockClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setVisibleInterval(() => setNow(new Date()), 10000);
    // Catch up immediately when the dock becomes visible again.
    const onVisible = () => { if (!document.hidden) setNow(new Date()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  const time = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const full = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div
      className="dock-status dock-clock"
      title={full}
      onClick={(e) => { e.stopPropagation(); invoke('open_calendar_window').catch(() => { }); }}
    >
      <span className="dock-clock-time">{time}</span>
      <span className="dock-clock-date">{date}</span>
    </div>
  );
}


// ---- Notification history (last 10), kept for the whole life of the dock window ----
type NotifItem = { app: string; title: string; body: string; icon?: string | null; aumid?: string; at: number };
let notifHistory: NotifItem[] = [];
const notifSubs = new Set<() => void>();
let notifListening = false;
function startNotifHistory() {
  if (notifListening) return;
  notifListening = true;
  listen<Omit<NotifItem, 'at'>>('notch-notification', (e) => {
    notifHistory = [{ ...e.payload, at: Date.now() }, ...notifHistory].slice(0, 10);
    notifSubs.forEach((f) => f());
  });
}
function useNotifHistory() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    notifSubs.add(f);
    return () => { notifSubs.delete(f); };
  }, []);
  return notifHistory;
}
function clearNotifHistory() {
  notifHistory = [];
  notifSubs.forEach((f) => f());
}

const MUTED_KEY = 'cyexs-muted-notif-apps';

function NotifList({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const items = useNotifHistory();
  const [muted, setMuted] = useState<string[]>([]);
  useEffect(() => {
    invoke<Record<string, unknown>>('load_settings').then((s) => {
      const m = s[MUTED_KEY];
      setMuted(Array.isArray(m) ? m.filter((x): x is string => typeof x === 'string') : []);
    }).catch(() => { });
  }, []);
  const toggleMute = (app: string) => {
    const next = muted.includes(app) ? muted.filter((a) => a !== app) : [...muted, app];
    setMuted(next);
    invoke('save_setting', { key: MUTED_KEY, value: next }).catch(() => { });
  };
  const time = (at: number) => new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  // Muted apps that have no entry in the list still need a way back.
  const mutedOnly = muted.filter((a) => !items.some((i) => i.app === a));

  return (
    <div className="notif-list">
      <div className="notif-list-header">
        <button className="status-slider-more" title="Geri" onClick={onBack}><ChevronLeft size={16} /></button>
        <span>Bildirimler</span>
        {items.length > 0 && <button className="notif-list-clear" onClick={clearNotifHistory}>Temizle</button>}
      </div>
      <div className="notif-list-items">
        {items.length === 0 && <div className="notif-list-empty">Henüz bildirim yok</div>}
        {items.map((n, i) => (
          <div key={`${n.at}-${i}`} className="notif-item" onClick={() => {
            if (n.aumid) invoke('open_notification_app', { aumid: n.aumid }).catch(() => { });
            onClose();
          }}>
            {n.icon ? <img className="notif-item-icon" src={n.icon} alt="" draggable={false} /> : <div className="notif-item-icon notif-item-fallback">{(n.app || '?')[0]}</div>}
            <div className="notif-item-text">
              <div className="notif-item-top"><span>{n.app}</span><span>{time(n.at)}</span></div>
              {n.title && <div className="notif-item-title">{n.title}</div>}
              {n.body && <div className="notif-item-body">{n.body}</div>}
            </div>
            <button
              className={`notif-item-mute${muted.includes(n.app) ? ' on' : ''}`}
              title={muted.includes(n.app) ? `${n.app} bildirimlerini çentikte göster` : `${n.app} bildirimlerini çentikte gösterme`}
              onClick={(e) => { e.stopPropagation(); toggleMute(n.app); }}
            >
              {muted.includes(n.app) ? <BellOff size={15} /> : <Bell size={15} />}
            </button>
          </div>
        ))}
        {mutedOnly.length > 0 && <div className="notif-list-section">Susturulanlar</div>}
        {mutedOnly.map((app) => (
          <div key={app} className="notif-item notif-item-muted">
            <div className="notif-item-text"><div className="notif-item-title">{app}</div></div>
            <button className="notif-item-mute on" title={`${app} bildirimlerini çentikte göster`} onClick={() => toggleMute(app)}><BellOff size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
