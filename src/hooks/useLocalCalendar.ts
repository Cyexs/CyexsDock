import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { useSettingsSync } from "./useSettingsSync";
import type { CalEvent } from "./useCaldav";
import {
  EVENTS_KEY, HOLIDAYS_KEY, HOLIDAY_SOURCE, LOCAL_SOURCE, expandLocal, holidaysInRange, loadLocalState,
  parseHolidays, sanitizeEvents, saveLocalEvents, type LocalEvent,
} from "../localCalendar";

/** Raw local events + holiday switch, live across windows (settings-changed). */
export function useLocalEvents() {
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [holidays, setHolidays] = useState(true);

  useEffect(() => {
    let alive = true;
    loadLocalState().then((s) => {
      if (!alive) return;
      setEvents(s.events);
      setHolidays(s.holidays);
    });
    return () => {
      alive = false;
    };
  }, []);

  useSettingsSync({
    [EVENTS_KEY]: (v) => setEvents(sanitizeEvents(v)),
    [HOLIDAYS_KEY]: (v) => setHolidays(parseHolidays(v)),
  });

  const save = (next: LocalEvent[]) => {
    setEvents(next);
    saveLocalEvents(next).catch(() => {});
  };

  return { events, holidays, save };
}

/** Local + holiday occurrences overlapping [from, to), with localized calendar names. */
export function useLocalCalendar(from: number, to: number) {
  const t = useT();
  const { events, holidays, save } = useLocalEvents();
  const localName = t("calendar.local");
  const holidayName = t("calendar.holidays");
  const occurrences = useMemo<CalEvent[]>(() => {
    const list = [...expandLocal(events, from, to), ...(holidays ? holidaysInRange(from, to) : [])];
    return list.map((e) => ({ ...e, calendar: e.calendar === LOCAL_SOURCE ? localName : e.calendar === HOLIDAY_SOURCE ? holidayName : e.calendar }));
  }, [events, holidays, from, to, localName, holidayName]);
  return { events, holidays, occurrences, save };
}
