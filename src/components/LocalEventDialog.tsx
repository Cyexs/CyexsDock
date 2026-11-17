import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { COLORS, REMINDER_CHOICES, REPEATS, type LocalEvent } from "../localCalendar";

const p2 = (n: number) => String(n).padStart(2, "0");
const dateStr = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
const timeStr = (ms: number) => {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
/** "YYYY-MM-DD" + "HH:MM" -> local ms (NaN when a field is empty). */
const parse = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0).getTime();
};

interface Props {
  draft: LocalEvent;
  isNew: boolean;
  onSave: (e: LocalEvent) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function LocalEventDialog({ draft, isNew, onSave, onDelete, onClose }: Props) {
  const t = useT();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(draft.title);
  const [allDay, setAllDay] = useState(draft.allDay);
  const [startDate, setStartDate] = useState(dateStr(draft.start));
  const [startTime, setStartTime] = useState(timeStr(draft.start));
  // All-day end is stored exclusive (midnight after the last day); the form shows the last day itself.
  const [endDate, setEndDate] = useState(dateStr(draft.allDay ? draft.end - 1 : draft.end));
  const [endTime, setEndTime] = useState(timeStr(draft.end));
  const [color, setColor] = useState(draft.color);
  const [repeat, setRepeat] = useState(draft.repeat);
  const [reminder, setReminder] = useState<number | null>(draft.reminderMinutes);
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => titleRef.current?.focus(), []);

  const save = () => {
    if (!title.trim()) return setError(t("calendar.error.title"));
    if (!startDate || !endDate || (!allDay && (!startTime || !endTime))) return setError(t("calendar.error.range"));
    let start = parse(startDate, startTime);
    let end = parse(endDate, endTime);
    if (allDay) {
      start = parse(startDate, "00:00");
      const last = parse(endDate, "00:00");
      if (last < start) return setError(t("calendar.error.range"));
      const d = new Date(last);
      end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    } else if (end < start) {
      return setError(t("calendar.error.range"));
    }
    onSave({ ...draft, title: title.trim(), allDay, start, end, color, repeat, reminderMinutes: reminder, notes: notes.trim() || undefined });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && !["TEXTAREA", "BUTTON", "SELECT"].includes((e.target as HTMLElement).tagName)) {
      e.preventDefault();
      save();
    }
  };

  const reminderLabel = (m: number | null) => {
    if (m === null) return t("calendar.reminder.none");
    if (m === 0) return t("calendar.reminder.atStart");
    if (m === 60) return t("calendar.reminder.hour");
    if (m === 1440) return t("calendar.reminder.day");
    return t("calendar.reminder.minutes", { count: m });
  };

  return (
    <div className="cw-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKeyDown}>
      <div className="cw-dialog" role="dialog" aria-label={t(isNew ? "calendar.newEvent" : "calendar.editEvent")}>
        <div className="cw-dialog-title">{t(isNew ? "calendar.newEvent" : "calendar.editEvent")}</div>

        <input ref={titleRef} className="cw-input" placeholder={t("calendar.field.title")} value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} />

        <label className="cw-check-row">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          {t("calendar.allDay")}
        </label>

        <div className="cw-field-row">
          <span>{t("calendar.field.start")}</span>
          <input type="date" className="cw-input" value={startDate} onChange={(e) => { setStartDate(e.target.value); setError(null); }} />
          {!allDay && <input type="time" className="cw-input" value={startTime} onChange={(e) => { setStartTime(e.target.value); setError(null); }} />}
        </div>
        <div className="cw-field-row">
          <span>{t("calendar.field.end")}</span>
          <input type="date" className="cw-input" value={endDate} onChange={(e) => { setEndDate(e.target.value); setError(null); }} />
          {!allDay && <input type="time" className="cw-input" value={endTime} onChange={(e) => { setEndTime(e.target.value); setError(null); }} />}
        </div>

        <div className="cw-field-row">
          <span>{t("calendar.field.color")}</span>
          <div className="cw-swatches">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`cw-swatch${c === color ? " on" : ""}`} style={{ background: c }} aria-label={c} aria-pressed={c === color} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>

        <div className="cw-field-row">
          <span>{t("calendar.field.repeat")}</span>
          <select className="cw-input" value={repeat} onChange={(e) => setRepeat(e.target.value as LocalEvent["repeat"])}>
            {REPEATS.map((r) => (
              <option key={r} value={r}>{t(`calendar.repeat.${r}`)}</option>
            ))}
          </select>
        </div>

        <div className="cw-field-row">
          <span>{t("calendar.field.reminder")}</span>
          <select className="cw-input" value={reminder === null ? "" : String(reminder)} onChange={(e) => setReminder(e.target.value === "" ? null : Number(e.target.value))}>
            {REMINDER_CHOICES.map((m) => (
              <option key={String(m)} value={m === null ? "" : String(m)}>{reminderLabel(m)}</option>
            ))}
          </select>
        </div>

        <textarea className="cw-input cw-notes" rows={3} placeholder={t("calendar.field.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />

        {error && <div className="cw-error">{error}</div>}

        <div className="cw-dialog-actions">
          {!isNew && <button type="button" className="cw-danger" onClick={onDelete}>{t("calendar.delete")}</button>}
          <span className="cw-spacer" />
          <button type="button" className="cw-secondary" onClick={onClose}>{t("calendar.cancel")}</button>
          <button type="button" className="cw-primary" onClick={save}>{t("calendar.save")}</button>
        </div>
      </div>
    </div>
  );
}
