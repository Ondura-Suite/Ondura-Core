// Room finder: lists the organisation's meeting rooms with their
// availability for the time of the meeting.

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Building24Regular, People16Regular, Search20Regular } from "@fluentui/react-icons";
import { pim, type Availability, type Room } from "../../lib/pim";
import { errorMessage } from "../../lib/api";

const useStyles = makeStyles({
  filters: { display: "flex", gap: "8px", marginBottom: "8px" },
  list: { display: "flex", flexDirection: "column", gap: "2px", maxHeight: "340px", overflowY: "auto" },
  row: {
    display: "grid",
    gridTemplateColumns: "24px 1fr auto auto",
    alignItems: "center",
    gap: "10px",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  picked: { backgroundColor: tokens.colorBrandBackground2, ":hover": { backgroundColor: tokens.colorBrandBackground2Hover } },
  name: { fontWeight: tokens.fontWeightSemibold },
  meta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, display: "flex", gap: "8px", alignItems: "center" },
  capacity: { display: "inline-flex", gap: "2px", alignItems: "center" },
});

export interface RoomFinderProps {
  open: boolean;
  /** Meeting time; without it availability is not shown. */
  start: Date | null;
  end: Date | null;
  onClose: () => void;
  onPick: (room: Room) => void;
}

/** `true` if a busy slot overlaps the meeting. */
function busyDuring(a: Availability | undefined, start: Date, end: Date): boolean | null {
  if (!a || !a.known) return null;
  return a.slots.some((s) => s.status !== "free" && new Date(s.start) < end && new Date(s.end) > start);
}

export function RoomFinder({ open, start, end, onClose, onPick }: RoomFinderProps) {
  const s = useStyles();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [building, setBuilding] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [picked, setPicked] = useState<Room | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setError(null);
    setRooms(null);
    pim.rooms().then(setRooms, (e) => {
      setRooms([]);
      setError(errorMessage(e));
    });
  }, [open]);

  useEffect(() => {
    if (!open || !rooms?.length || !start || !end) return;
    pim.freeBusy(rooms.map((r) => r.email), start, end).then(setAvailability, () => setAvailability([]));
  }, [open, rooms, start?.getTime(), end?.getTime()]);

  const buildings = useMemo(() => [...new Set((rooms ?? []).map((r) => r.building).filter(Boolean) as string[])], [rooms]);
  const shown = (rooms ?? []).filter((r) => {
    if (building && r.building !== building) return false;
    if (query && !`${r.name} ${r.email}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (onlyFree && start && end && busyDuring(availability.find((a) => a.email.toLowerCase() === r.email.toLowerCase()), start, end) !== false) return false;
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 560 }}>
        <DialogBody>
          <DialogTitle>Raum suchen</DialogTitle>
          <DialogContent>
            {error && (
              <MessageBar intent="warning" style={{ marginBottom: 8 }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <div className={s.filters}>
              <Input contentBefore={<Search20Regular />} placeholder="Raum suchen" value={query} onChange={(_, d) => setQuery(d.value)} style={{ flex: 1, minWidth: 0 }} />
              {buildings.length > 1 && (
                <Dropdown
                  placeholder="Alle Gebäude"
                  value={building || "Alle Gebäude"}
                  selectedOptions={[building]}
                  onOptionSelect={(_, d) => setBuilding(d.optionValue ?? "")}
                  style={{ minWidth: 130 }}
                >
                  <Option value="">Alle Gebäude</Option>
                  {buildings.map((b) => (
                    <Option key={b} value={b}>{b}</Option>
                  ))}
                </Dropdown>
              )}
              {start && end && (
                <Button appearance={onlyFree ? "primary" : "secondary"} onClick={() => setOnlyFree((v) => !v)}>
                  Nur freie
                </Button>
              )}
            </div>
            {rooms === null ? (
              <Spinner size="small" label="Räume werden geladen…" />
            ) : shown.length === 0 && !error ? (
              <div className={s.meta}>Keine Räume gefunden.</div>
            ) : (
              <div className={s.list} role="listbox" aria-label="Räume">
                {shown.map((r) => {
                  const busy = start && end ? busyDuring(availability.find((a) => a.email.toLowerCase() === r.email.toLowerCase()), start, end) : null;
                  return (
                    <div
                      key={r.email}
                      role="option"
                      aria-selected={picked?.email === r.email}
                      className={`${s.row} ${picked?.email === r.email ? s.picked : ""}`}
                      onClick={() => setPicked(r)}
                      onDoubleClick={() => onPick(r)}
                    >
                      <Building24Regular />
                      <div>
                        <div className={s.name}>{r.name}</div>
                        <div className={s.meta}>
                          {r.building && <span>{r.building}</span>}
                          <span>{r.email}</span>
                        </div>
                      </div>
                      <span className={s.capacity} title="Plätze">
                        {r.capacity ? (
                          <>
                            <People16Regular /> {r.capacity}
                          </>
                        ) : null}
                      </span>
                      {busy === null ? (
                        <span />
                      ) : busy ? (
                        <Badge appearance="tint" color="danger">Belegt</Badge>
                      ) : (
                        <Badge appearance="tint" color="success">Frei</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button appearance="primary" disabled={!picked} onClick={() => picked && onPick(picked)}>
              Raum hinzufügen
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
