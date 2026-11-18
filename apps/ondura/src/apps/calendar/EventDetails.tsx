import {
  Avatar,
  Button,
  Divider,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Popover,
  PopoverSurface,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  ArrowRepeatAll16Regular,
  Alert16Regular,
  Clock16Regular,
  Delete20Regular,
  Dismiss20Regular,
  Edit20Regular,
  Location16Regular,
  People16Regular,
  Video16Regular,
  Checkmark16Regular,
  QuestionCircle16Regular,
  Dismiss16Regular,
} from "@fluentui/react-icons";
import type { CalEvent, Collection, EditScope, EventResponse } from "../../lib/pim";
import { api } from "../../lib/api";
import { describeRecurrence, fmtEventTime } from "./dates";
import { tl } from "../../lib/i18n";

const useStyles = makeStyles({
  card: { width: "360px", padding: 0, overflow: "hidden" },
  stripe: { height: "6px" },
  head: { display: "flex", alignItems: "flex-start", gap: "4px", padding: "10px 8px 4px 16px" },
  title: { flex: 1, fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, lineHeight: tokens.lineHeightBase500, wordBreak: "break-word", paddingTop: "4px" },
  rows: { display: "flex", flexDirection: "column", gap: "8px", padding: "4px 16px 12px" },
  row: { display: "flex", gap: "10px", alignItems: "flex-start", fontSize: tokens.fontSizeBase300, color: tokens.colorNeutralForeground1 },
  icon: { color: tokens.colorNeutralForeground3, marginTop: "2px", flexShrink: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  body: { maxHeight: "140px", overflowY: "auto", whiteSpace: "pre-wrap", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, padding: "8px 16px 12px" },
  people: { display: "flex", flexDirection: "column", gap: "4px" },
  person: { display: "flex", alignItems: "center", gap: "8px" },
  actions: { display: "flex", gap: "8px", padding: "8px 16px 12px" },
  respond: { display: "flex", flexDirection: "column", gap: "6px", padding: "10px 16px" },
});

const RESPONSE: Record<string, string> = { accepted: tl("Zugesagt"), declined: tl("Abgesagt"), tentative: tl("Mit Vorbehalt"), needsAction: tl("Keine Antwort"), none: tl("Keine Antwort"), organizer: "Organisator" };
const SHOW_AS: Record<string, string> = { free: tl("Frei"), tentative: tl("Mit Vorbehalt"), busy: tl("Gebucht"), outOfOffice: tl("Abwesend") };

function bodyText(body: string): string {
  if (!/<\w+[^>]*>/.test(body)) return body.trim();
  const doc = new DOMParser().parseFromString(body.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function reminderText(min: number | null): string | null {
  if (min === null) return null;
  if (min === 0) return tl("Erinnerung zum Beginn");
  if (min % 10080 === 0) return `Erinnerung ${min / 10080} Woche(n) vorher`;
  if (min % 1440 === 0) return `Erinnerung ${min / 1440} Tag(e) vorher`;
  if (min % 60 === 0) return `Erinnerung ${min / 60} Std. vorher`;
  return `Erinnerung ${min} Min. vorher`;
}

export interface EventDetailsProps {
  event: CalEvent | null;
  anchor: HTMLElement | null;
  calendar: Collection | undefined;
  onClose: () => void;
  onEdit: (e: CalEvent, scope: EditScope) => void;
  onDelete: (e: CalEvent, scope: EditScope) => void;
  onRespond?: (e: CalEvent, response: EventResponse) => void;
}

export function EventDetails({ event, anchor, calendar, onClose, onEdit, onDelete, onRespond }: EventDetailsProps) {
  const s = useStyles();
  if (!event) return null;
  const color = calendar?.color ?? tokens.colorBrandBackground;
  const readOnly = !!calendar?.readOnly;
  const recurrence = describeRecurrence(event);
  const reminder = reminderText(event.reminderMinutes);
  const text = bodyText(event.body);
  const joinUrl = event.onlineMeetingUrl ?? event.location.match(/https?:\/\/\S+/)?.[0] ?? null;

  const scoped = (label: string, icon: React.JSX.Element, action: (scope: EditScope) => void) =>
    event.isRecurring ? (
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button size="small" icon={icon}>
            {label}
          </Button>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => action("occurrence")}>{tl("Nur dieses Ereignis")}</MenuItem>
            <MenuItem onClick={() => action("series")}>{tl("Ganze Serie")}</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    ) : (
      <Button size="small" icon={icon} onClick={() => action("series")}>
        {label}
      </Button>
    );

  return (
    <Popover open onOpenChange={(_, d) => !d.open && onClose()} positioning={{ target: anchor ?? undefined, position: "after", autoSize: true, fallbackPositions: ["before", "below", "above"] }} withArrow trapFocus>
      <PopoverSurface className={s.card} aria-label={event.title}>
        <div className={s.stripe} style={{ background: color }} />
        <div className={s.head}>
          <span className={s.title}>{event.isCancelled ? tl("Abgesagt: {0}", event.title) : event.title || tl("(Ohne Titel)")}</span>
          <Button appearance="subtle" icon={<Dismiss20Regular />} onClick={onClose} aria-label={tl("Schließen")} />
        </div>
        <div className={s.rows}>
          <div className={s.row}>
            <Clock16Regular className={s.icon} />
            <span>
              {fmtEventTime(event)}
              <br />
              <span className={s.muted}>
                {calendar?.name ?? tl("Kalender")} · {SHOW_AS[event.showAs] ?? event.showAs}
              </span>
            </span>
          </div>
          {recurrence && (
            <div className={s.row}>
              <ArrowRepeatAll16Regular className={s.icon} />
              <span>{recurrence}</span>
            </div>
          )}
          {event.location && (
            <div className={s.row}>
              <Location16Regular className={s.icon} />
              <span style={{ wordBreak: "break-word" }}>{event.location}</span>
            </div>
          )}
          {reminder && (
            <div className={s.row}>
              <Alert16Regular className={s.icon} />
              <span>{reminder}</span>
            </div>
          )}
          {(event.organizer || event.attendees.length > 0) && (
            <div className={s.row}>
              <People16Regular className={s.icon} />
              <div className={s.people}>
                {event.organizer && (
                  <span className={s.person}>
                    <Avatar size={20} name={event.organizer.name ?? event.organizer.email} color="colorful" />
                    {event.organizer.name ?? event.organizer.email} <span className={s.muted}>{tl("· Organisator")}</span>
                  </span>
                )}
                {event.attendees.slice(0, 8).map((a) => (
                  <span key={a.address.email} className={s.person}>
                    <Avatar size={20} name={a.address.name ?? a.address.email} color="colorful" />
                    {a.address.name ?? a.address.email} <span className={s.muted}>· {RESPONSE[a.response] ?? a.response}</span>
                  </span>
                ))}
                {event.attendees.length > 8 && <span className={s.muted}>+ {event.attendees.length - 8} {tl("weitere")}</span>}
              </div>
            </div>
          )}
        </div>
        {text && (
          <>
            <Divider />
            <div className={s.body}>{text}</div>
          </>
        )}
        {onRespond && event.myResponse && event.myResponse !== "organizer" && !event.isCancelled && (
          <>
            <Divider />
            <div className={s.respond}>
              <span className={s.muted}>
                {event.myResponse === "accepted"
                  ? tl("Sie haben zugesagt.")
                  : event.myResponse === "declined"
                    ? tl("Sie haben abgesagt.")
                    : event.myResponse === "tentative"
                      ? tl("Sie haben mit Vorbehalt zugesagt.")
                      : tl("Einladung – noch nicht beantwortet.")}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <Button size="small" appearance={event.myResponse === "accepted" ? "primary" : "secondary"} icon={<Checkmark16Regular />} onClick={() => onRespond(event, "accept")}>
                  {tl("Zusagen")}
                </Button>
                <Button size="small" appearance={event.myResponse === "tentative" ? "primary" : "secondary"} icon={<QuestionCircle16Regular />} onClick={() => onRespond(event, "tentative")}>
                  {tl("Vorbehalt")}
                </Button>
                <Button size="small" appearance={event.myResponse === "declined" ? "primary" : "secondary"} icon={<Dismiss16Regular />} onClick={() => onRespond(event, "decline")}>
                  {tl("Absagen")}
                </Button>
              </div>
            </div>
          </>
        )}
        <Divider />
        <div className={s.actions}>
          {joinUrl && (
            <Button size="small" appearance="primary" icon={<Video16Regular />} onClick={() => api.openExternal(joinUrl)}>
              {tl("Teilnehmen")}
            </Button>
          )}
          {!readOnly && scoped(tl("Bearbeiten"), <Edit20Regular />, (scope) => onEdit(event, scope))}
          {!readOnly && scoped(tl("Löschen"), <Delete20Regular />, (scope) => onDelete(event, scope))}
        </div>
      </PopoverSurface>
    </Popover>
  );
}
