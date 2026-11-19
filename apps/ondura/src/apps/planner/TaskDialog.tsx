// Task details of Ondura Planer, like Planner's task card: assignees,
// labels, bucket, progress, priority, dates, notes and checklist. Every
// change is applied at once (Microsoft: written to Planner).

import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular, Delete20Regular, Dismiss12Regular, Dismiss24Regular, Person20Regular, Tag20Regular } from "@fluentui/react-icons";
import { errorMessage } from "../../lib/api";
import { tl } from "../../lib/i18n";
import { newId } from "../../lib/graphApps";
import { useNotify } from "../../shell/notify";
import { LABEL_COLORS, LABEL_IDS, PRIORITIES, PROGRESS, byOrder, type Plan, type Priority, type Progress, type Task } from "./model";
import * as ms from "./msplanner";

const useStyles = makeStyles({
  surface: { maxWidth: "760px", width: "92vw" },
  head: { display: "flex", alignItems: "center", gap: "8px" },
  title: { flex: 1, fontSize: "20px", fontWeight: tokens.fontWeightSemibold },
  col: { display: "flex", flexDirection: "column", gap: "14px" },
  row: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" },
  row2: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" },
  chips: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" },
  chip: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "2px 4px 2px 2px", borderRadius: "14px", backgroundColor: tokens.colorNeutralBackground3 },
  label: { display: "inline-flex", alignItems: "center", gap: "4px", color: "#fff", padding: "2px 4px 2px 10px", borderRadius: "12px", fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold },
  x: { border: "none", background: "none", color: "inherit", cursor: "pointer", display: "flex", padding: "2px", borderRadius: "50%" },
  check: { display: "flex", alignItems: "center", gap: "6px" },
  section: { fontWeight: tokens.fontWeightSemibold, display: "flex", alignItems: "center", justifyContent: "space-between" },
  muted: { color: tokens.colorNeutralForeground3 },
  swatch: { width: "14px", height: "14px", borderRadius: "4px", flexShrink: 0 },
});

export function TaskDialog(p: {
  plan: Plan;
  task: Task;
  /** Microsoft account of the plan; `null` for plans on this computer. */
  account: string | null;
  nameOf: (id: string) => string;
  onPeople: (m: Map<string, ms.Person>) => void;
  onClose: () => void;
  onChange: (t: Task) => void;
  /** Details loaded from Planner (no change to write). */
  onDetails: (t: Task) => void;
  onDelete: () => void;
  onLabelNames: (labels: Record<string, string>) => void;
  onMembers: (members: string[]) => void;
}) {
  const s = useStyles();
  const notify = useNotify();
  const t = p.task;
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);
  const [newItem, setNewItem] = useState("");
  const [person, setPerson] = useState("");
  const [found, setFound] = useState<ms.Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [labelEdit, setLabelEdit] = useState<string | null>(null);
  const [labelName, setLabelName] = useState("");
  const searchTimer = useRef<number | null>(null);

  // Planner: description and checklist are loaded when the task is opened.
  useEffect(() => {
    if (!p.account || t.detailsLoaded) return;
    ms.loadDetails(p.account, t).then(
      (d) => {
        p.onDetails(d);
        setNotes(d.notes);
      },
      (e) => notify(tl("Details konnten nicht geladen werden"), errorMessage(e), "error"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setNotes(t.notes), [t.notes]);

  const change = (patch: Partial<Task>) => p.onChange({ ...t, ...patch });

  const searchPeople = (q: string) => {
    setPerson(q);
    if (!p.account) return;
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (q.trim().length < 2) return setFound([]);
    searchTimer.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        setFound(await ms.searchPeople(p.account!, q.trim()));
      } catch (e) {
        notify(tl("Personensuche fehlgeschlagen"), errorMessage(e), "error");
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const assign = async (id: string) => {
    if (!id || t.assignees.includes(id)) return;
    if (!p.account && !p.plan.members.includes(id)) p.onMembers([...p.plan.members, id]);
    change({ assignees: [...t.assignees, id] });
    setPerson("");
    setFound([]);
    if (p.account) p.onPeople(await ms.resolvePeople(p.account, [id]));
  };

  const assignMe = async () => {
    if (!p.account) return;
    try {
      const me = await ms.me(p.account);
      p.onPeople(await ms.resolvePeople(p.account, [me.id]));
      void assign(me.id);
    } catch (e) {
      notify(tl("Das hat nicht geklappt"), errorMessage(e), "error");
    }
  };

  const toggleLabel = (id: string) => change({ labels: t.labels.includes(id) ? t.labels.filter((l) => l !== id) : [...t.labels, id] });

  const saveLabelName = () => {
    if (!labelEdit) return;
    const labels = { ...p.plan.labels };
    if (labelName.trim()) labels[labelEdit] = labelName.trim();
    else delete labels[labelEdit];
    p.onLabelNames(labels);
    setLabelEdit(null);
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    // Planner wants a GUID as the id of a checklist item.
    const id = p.account ? crypto.randomUUID() : newId("c");
    change({ checklist: [...t.checklist, { id, title: newItem.trim(), done: false }] });
    setNewItem("");
  };

  const buckets = [...p.plan.buckets].sort(byOrder);
  const progressLabel = PROGRESS.find((x) => x.value === t.progress)?.label() ?? "";
  const priority = PRIORITIES.find((x) => x.value === t.priority)!;

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle
            action={<Button appearance="subtle" icon={<Dismiss24Regular />} aria-label={tl("Schließen")} onClick={p.onClose} />}
          >
            <div className={s.head}>
              <Input
                className={s.title}
                appearance="underline"
                value={title}
                onChange={(_, d) => setTitle(d.value)}
                onBlur={() => title.trim() && title !== t.title && change({ title: title.trim() })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </div>
          </DialogTitle>
          <DialogContent className={s.col}>
            <div>
              <div className={s.chips}>
                {t.assignees.map((id) => (
                  <span key={id} className={s.chip}>
                    <Avatar size={24} name={p.nameOf(id)} color="colorful" idForColor={id} />
                    <Text size={200}>{p.nameOf(id)}</Text>
                    <button className={s.x} onClick={() => change({ assignees: t.assignees.filter((a) => a !== id) })} aria-label={tl("Entfernen")}>
                      <Dismiss12Regular />
                    </button>
                  </span>
                ))}
                {p.account ? (
                  <>
                    <Combobox
                      size="small"
                      freeform
                      placeholder={tl("Person zuweisen …")}
                      value={person}
                      onChange={(e) => searchPeople(e.target.value)}
                      onOptionSelect={(_, d) => d.optionValue && void assign(d.optionValue)}
                      expandIcon={searching ? <Spinner size="extra-tiny" /> : <Person20Regular />}
                    >
                      {found.map((f) => (
                        <Option key={f.id} value={f.id} text={f.name}>
                          {f.name} {f.mail ? `(${f.mail})` : ""}
                        </Option>
                      ))}
                    </Combobox>
                    {!t.assignees.length && (
                      <Button size="small" appearance="subtle" onClick={() => void assignMe()}>
                        {tl("Mir zuweisen")}
                      </Button>
                    )}
                  </>
                ) : (
                  <Combobox
                    size="small"
                    freeform
                    placeholder={tl("Person zuweisen …")}
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                    onOptionSelect={(_, d) => d.optionValue && void assign(d.optionValue)}
                    onKeyDown={(e) => e.key === "Enter" && person.trim() && void assign(person.trim())}
                    expandIcon={<Person20Regular />}
                  >
                    {p.plan.members
                      .filter((m) => !t.assignees.includes(m))
                      .map((m) => (
                        <Option key={m} value={m}>
                          {m}
                        </Option>
                      ))}
                  </Combobox>
                )}
              </div>
            </div>

            <div className={s.chips}>
              {t.labels.map((l) => (
                <span key={l} className={s.label} style={{ backgroundColor: LABEL_COLORS[l] }}>
                  {p.plan.labels[l] || tl("Bezeichnung")}
                  <button className={s.x} onClick={() => toggleLabel(l)} aria-label={tl("Entfernen")}>
                    <Dismiss12Regular />
                  </button>
                </span>
              ))}
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button size="small" appearance="subtle" icon={<Tag20Regular />}>
                    {tl("Bezeichnung hinzufügen")}
                  </Button>
                </MenuTrigger>
                <MenuPopover style={{ maxHeight: 420, overflowY: "auto" }}>
                  <MenuList>
                    {LABEL_IDS.map((l) => (
                      <MenuItem
                        key={l}
                        icon={<span className={s.swatch} style={{ backgroundColor: LABEL_COLORS[l] }} />}
                        onClick={() => toggleLabel(l)}
                        secondaryContent={t.labels.includes(l) ? "✓" : undefined}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setLabelEdit(l);
                          setLabelName(p.plan.labels[l] ?? "");
                        }}
                      >
                        {p.plan.labels[l] || <span className={s.muted}>{tl("Ohne Namen")}</span>}
                      </MenuItem>
                    ))}
                  </MenuList>
                </MenuPopover>
              </Menu>
              <Button size="small" appearance="subtle" onClick={() => (setLabelEdit(t.labels[0] ?? "category1"), setLabelName(p.plan.labels[t.labels[0] ?? "category1"] ?? ""))}>
                {tl("Bezeichnungen benennen …")}
              </Button>
            </div>
            {labelEdit && (
              <div className={s.chips}>
                <Dropdown size="small" value={p.plan.labels[labelEdit] || labelEdit} selectedOptions={[labelEdit]} onOptionSelect={(_, d) => d.optionValue && (setLabelEdit(d.optionValue), setLabelName(p.plan.labels[d.optionValue] ?? ""))}>
                  {LABEL_IDS.map((l) => (
                    <Option key={l} value={l} text={p.plan.labels[l] || l}>
                      <span className={s.swatch} style={{ backgroundColor: LABEL_COLORS[l], display: "inline-block", marginRight: 6 }} />
                      {p.plan.labels[l] || l.replace("category", "#")}
                    </Option>
                  ))}
                </Dropdown>
                <Input size="small" autoFocus value={labelName} placeholder={tl("Name der Bezeichnung")} onChange={(_, d) => setLabelName(d.value)} onKeyDown={(e) => e.key === "Enter" && saveLabelName()} />
                <Button size="small" appearance="primary" onClick={saveLabelName}>
                  {tl("Übernehmen")}
                </Button>
                <Button size="small" onClick={() => setLabelEdit(null)}>
                  {tl("Abbrechen")}
                </Button>
              </div>
            )}

            <div className={s.row}>
              <Field label={tl("Bucket")}>
                <Dropdown style={{ minWidth: 0, width: "100%" }} value={buckets.find((b) => b.id === t.bucketId)?.name ?? ""} selectedOptions={[t.bucketId]} onOptionSelect={(_, d) => d.optionValue && d.optionValue !== t.bucketId && change({ bucketId: d.optionValue })}>
                  {buckets.map((b) => (
                    <Option key={b.id} value={b.id}>
                      {b.name}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label={tl("Fortschritt")}>
                <Dropdown style={{ minWidth: 0, width: "100%" }} value={progressLabel} selectedOptions={[String(t.progress)]} onOptionSelect={(_, d) => change({ progress: Number(d.optionValue) as Progress })}>
                  {PROGRESS.map((x) => (
                    <Option key={x.value} value={String(x.value)}>
                      {x.label()}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label={tl("Priorität")}>
                <Dropdown style={{ minWidth: 0, width: "100%" }} value={priority.label()} selectedOptions={[String(t.priority)]} onOptionSelect={(_, d) => change({ priority: Number(d.optionValue) as Priority })}>
                  {PRIORITIES.map((x) => (
                    <Option key={x.value} value={String(x.value)} text={x.label()}>
                      <span style={{ color: x.color, fontWeight: 600 }}>{x.label()}</span>
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            </div>
            <div className={s.row2}>
              <Field label={tl("Startdatum")}>
                <Input type="date" value={t.start ?? ""} onChange={(_, d) => change({ start: d.value || null })} />
              </Field>
              <Field label={tl("Fälligkeitsdatum")}>
                <Input type="date" value={t.due ?? ""} onChange={(_, d) => change({ due: d.value || null })} />
              </Field>
            </div>

            <Field label={tl("Notizen")}>
              <Textarea resize="vertical" rows={4} value={notes} placeholder={tl("Beschreibung hinzufügen")} onChange={(_, d) => setNotes(d.value)} onBlur={() => notes !== t.notes && change({ notes })} disabled={!t.detailsLoaded} />
            </Field>

            <div>
              <div className={s.section}>
                <span>
                  {tl("Checkliste")} {t.checklist.length ? `${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : ""}
                </span>
                <Checkbox label={tl("Auf Karte anzeigen")} checked={!!t.checklistOnCard} onChange={(_, d) => change({ checklistOnCard: !!d.checked })} disabled={!t.detailsLoaded} />
              </div>
              {!t.detailsLoaded ? (
                <Spinner size="tiny" />
              ) : (
                <>
                  {t.checklist.map((c) => (
                    <div key={c.id} className={s.check}>
                      <Checkbox checked={c.done} onChange={() => change({ checklist: t.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} />
                      <Input
                        appearance="underline"
                        style={{ flex: 1, textDecoration: c.done ? "line-through" : undefined }}
                        defaultValue={c.title}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== c.title && change({ checklist: t.checklist.map((x) => (x.id === c.id ? { ...x, title: e.target.value.trim() } : x)) })}
                      />
                      <Button size="small" appearance="subtle" icon={<Delete20Regular />} aria-label={tl("Entfernen")} onClick={() => change({ checklist: t.checklist.filter((x) => x.id !== c.id) })} />
                    </div>
                  ))}
                  <div className={s.check}>
                    <Add20Regular style={{ color: tokens.colorNeutralForeground3, margin: "0 6px" }} />
                    <Input appearance="underline" style={{ flex: 1 }} placeholder={tl("Element hinzufügen")} value={newItem} onChange={(_, d) => setNewItem(d.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} onBlur={addItem} />
                  </div>
                </>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text size={200} className={s.muted}>
                {tl("Erstellt am {0}", new Date(t.created).toLocaleDateString())}
                {t.completed ? ` · ${tl("Erledigt am {0}", new Date(t.completed).toLocaleDateString())}` : ""}
              </Text>
              <Button appearance="subtle" icon={<Delete20Regular />} onClick={() => confirm(tl("Aufgabe „{0}“ löschen?", t.title)) && p.onDelete()}>
                {tl("Aufgabe löschen")}
              </Button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
