import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Wifi, WifiOff, Volume, Volume1, Volume2, VolumeX,
  Battery, BatteryLow, BatteryMedium, BatteryFull, BatteryCharging,
  Bluetooth, Sun, Settings2,
} from 'lucide-react';
import { setVisibleInterval } from './hooks/visibleInterval';

// Taskbar-style status group (Wi-Fi, volume, battery) at the right end of the dock.
// Clicking it opens Windows Quick Settings, like the native taskbar corner.
export function DockStatus({ onOpen }: { onOpen: (e: React.MouseEvent<HTMLDivElement>) => void }) {
  const [wifi, setWifi] = useState<{ enabled: boolean; connected: boolean } | null>(null);
  const [vol, setVol] = useState<{ volume: number; is_muted: boolean } | null>(null);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);

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

  return (
    <div className="status-panel">
      <div className="status-panel-tiles">
        <button className={`status-tile${wifiOn ? ' on' : ''}`} onClick={toggleWifi}>
          {wifiOn ? <Wifi size={18} /> : <WifiOff size={18} />}
          <span>{wifiOn === null ? 'Wi-Fi' : !wifiOn ? 'Wi-Fi kapalı' : wifiConnected ? 'Bağlı' : 'Bağlı değil'}</span>
        </button>
        <button className={`status-tile${btOn ? ' on' : ''}`} onClick={toggleBt}>
          <Bluetooth size={18} />
          <span>{btOn === null ? 'Bluetooth' : btOn ? 'Bluetooth açık' : 'Bluetooth kapalı'}</span>
        </button>
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
      </div>
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
