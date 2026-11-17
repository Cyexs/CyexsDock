import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { MapPin } from "lucide-react";
import { PRAYERS, hhmm, type PrayerState } from "../hooks/usePrayerTimes";
import { useT } from "../i18n";

interface City { name: string; country: string; latitude: number; longitude: number }

/** Saves the location the weather and prayer times share, like Settings › Weather does. */
async function saveLocation(city: City) {
  localStorage.setItem("nectar-weather-city", city.name);
  localStorage.setItem("nectar-weather-lat", String(city.latitude));
  localStorage.setItem("nectar-weather-lon", String(city.longitude));
  await invoke("save_setting", { key: "nectar-weather-lat", value: String(city.latitude) }).catch(() => {});
  await invoke("save_setting", { key: "nectar-weather-lon", value: String(city.longitude) }).catch(() => {});
  await invoke("save_setting", { key: "nectar-weather-city", value: city.name }).catch(() => {});
  await emit("weather-refresh", { lat: city.latitude, lon: city.longitude, city: city.name });
}

function left(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk` : `${minutes} dk`;
}

export function NotchPrayer({ prayer, solo }: { prayer: PrayerState; solo: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<City[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const setKeyboardFocus = (enabled: boolean) => invoke("set_window_keyboard_focus", { enabled }).catch(() => {});
  useEffect(() => () => void setKeyboardFocus(false), []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=4&language=tr&format=json`);
        const data = await res.json();
        if (!cancelled) setResults((data.results ?? []).map((r: any) => ({ name: r.name, country: r.country || "", latitude: r.latitude, longitude: r.longitude })));
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [query]);

  const startEditing = () => {
    setEditing(true);
    setKeyboardFocus(true).finally(() => inputRef.current?.focus());
  };
  const stopEditing = () => {
    setEditing(false);
    setQuery("");
    setResults([]);
    setKeyboardFocus(false);
  };
  const pick = (city: City) => {
    stopEditing();
    saveLocation(city);
  };

  return (
    <div className={`prayer-column${solo ? " solo" : ""}`}>
      {editing ? (
        <div className="prayer-search">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) pick(results[0]);
              if (e.key === "Escape") stopEditing();
            }}
            onBlur={() => setTimeout(stopEditing, 150)}
            placeholder={t("prayer.search")}
            aria-label={t("prayer.search")}
            spellCheck={false}
          />
          {results.map((city) => (
            <button key={`${city.name}-${city.latitude}`} className="prayer-search-result" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(city)}>
              {city.name}<span>{city.country}</span>
            </button>
          ))}
        </div>
      ) : (
        <button className="prayer-location" onClick={startEditing} title={t("prayer.change")}>
          <MapPin size={12} strokeWidth={2} />
          <span>{prayer.city || t("prayer.pickCity")}</span>
        </button>
      )}

      {!editing && (
        <>
          <div className="prayer-list">
            {PRAYERS.map((name) => {
              const isNext = prayer.next?.name === name && prayer.next.at.getDate() === new Date().getDate();
              return (
                <div key={name} className={`prayer-row${isNext ? " next" : ""}`}>
                  <span>{t(`prayer.${name}`)}</span>
                  <span>{hhmm(prayer.today?.[name])}</span>
                </div>
              );
            })}
          </div>
          {prayer.next && (
            <div className="prayer-left">
              {t("prayer.leftTo", { name: t(`prayer.${prayer.next.name}`), left: left(prayer.next.at.getTime() - Date.now()) })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
