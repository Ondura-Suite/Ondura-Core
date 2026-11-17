import { Button, Checkbox, Dropdown, Field, Input, Option, Switch, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Add16Regular, Delete16Regular } from "@fluentui/react-icons";
import type { Account, Folder, MailRule } from "../../lib/types";

const useStyles = makeStyles({
  root: { display: "grid", gridTemplateColumns: "220px 1fr", gap: "16px", minHeight: "340px" },
  list: { display: "flex", flexDirection: "column", gap: "2px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, paddingRight: "8px" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: tokens.borderRadiusMedium,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  selected: { backgroundColor: tokens.colorBrandBackground2, fontWeight: tokens.fontWeightSemibold },
  off: { color: tokens.colorNeutralForeground3, textDecoration: "line-through" },
  form: { display: "flex", flexDirection: "column", gap: "10px" },
  section: { fontWeight: tokens.fontWeightSemibold, marginTop: "6px" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" },
});

export function newRule(): MailRule {
  return {
    id: crypto.randomUUID(),
    name: "Neue Regel",
    enabled: true,
    accountId: null,
    fromContains: null,
    subjectContains: null,
    toContains: null,
    moveTo: null,
    markRead: false,
    flag: false,
    category: null,
    delete: false,
    stop: false,
  };
}

export interface RulesEditorProps {
  rules: MailRule[];
  onChange: (rules: MailRule[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  accounts: Account[];
  folders: Folder[];
}

/** Rules for new mail in the inbox ("Einstellungen → Regeln"). */
export function RulesEditor({ rules, onChange, selectedId, onSelect, accounts, folders }: RulesEditorProps) {
  const s = useStyles();
  const rule = rules.find((r) => r.id === selectedId) ?? null;
  const update = (patch: Partial<MailRule>) => rule && onChange(rules.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)));
  const text = (v: string) => (v.trim() ? v : null);
  const targetFolders = folders.filter((f) => (!rule?.accountId || f.accountId === rule.accountId) && f.role !== "inbox");
  const folderLabel = (f: Folder) => (accounts.length > 1 ? `${f.name} (${accounts.find((a) => a.id === f.accountId)?.email ?? ""})` : f.name);
  const target = folders.find((f) => f.id === rule?.moveTo);

  return (
    <div className={s.root}>
      <div className={s.list}>
        {rules.map((r) => (
          <button key={r.id} className={mergeClasses(s.item, r.id === selectedId && s.selected)} onClick={() => onSelect(r.id)}>
            <span className={r.enabled ? undefined : s.off}>{r.name || "(Ohne Namen)"}</span>
          </button>
        ))}
        <Button
          appearance="subtle"
          icon={<Add16Regular />}
          style={{ justifyContent: "flex-start" }}
          onClick={() => {
            const r = newRule();
            onChange([...rules, r]);
            onSelect(r.id);
          }}
        >
          Neue Regel
        </Button>
      </div>
      {rule ? (
        <div className={s.form}>
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <Field label="Name" style={{ flex: 1 }}>
              <Input value={rule.name} onChange={(_, d) => update({ name: d.value })} />
            </Field>
            <Switch checked={rule.enabled} onChange={(_, d) => update({ enabled: d.checked })} label="Aktiv" />
            <Button
              appearance="subtle"
              icon={<Delete16Regular />}
              aria-label="Regel löschen"
              onClick={() => {
                onChange(rules.filter((r) => r.id !== rule.id));
                onSelect(null);
              }}
            />
          </div>
          <Text className={s.section}>Wenn eine neue Nachricht eintrifft und …</Text>
          <div className={s.grid}>
            <Field label="Absender enthält">
              <Input value={rule.fromContains ?? ""} placeholder="z. B. newsletter@" onChange={(_, d) => update({ fromContains: text(d.value) })} />
            </Field>
            <Field label="Betreff enthält">
              <Input value={rule.subjectContains ?? ""} onChange={(_, d) => update({ subjectContains: text(d.value) })} />
            </Field>
            <Field label="An/Cc enthält">
              <Input value={rule.toContains ?? ""} onChange={(_, d) => update({ toContains: text(d.value) })} />
            </Field>
            <Field label="Konto">
              <Dropdown
                value={rule.accountId ? accounts.find((a) => a.id === rule.accountId)?.email ?? "" : "Alle Konten"}
                selectedOptions={[rule.accountId ?? ""]}
                onOptionSelect={(_, d) => update({ accountId: d.optionValue || null, moveTo: null })}
              >
                <Option value="">Alle Konten</Option>
                {accounts.map((a) => (
                  <Option key={a.id} value={a.id}>
                    {a.email}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          </div>
          <Text className={s.section}>… dann</Text>
          <div className={s.grid}>
            <Field label="Verschieben in">
              <Dropdown
                value={target ? folderLabel(target) : "Nicht verschieben"}
                selectedOptions={[rule.moveTo ?? ""]}
                onOptionSelect={(_, d) => update({ moveTo: d.optionValue || null, delete: false })}
              >
                <Option value="">Nicht verschieben</Option>
                {targetFolders.map((f) => (
                  <Option key={f.id} value={f.id} text={folderLabel(f)}>
                    {folderLabel(f)}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Kategorie zuweisen">
              <Input value={rule.category ?? ""} placeholder="z. B. Rot" onChange={(_, d) => update({ category: text(d.value) })} />
            </Field>
          </div>
          <Checkbox checked={rule.markRead} onChange={(_, d) => update({ markRead: !!d.checked })} label="Als gelesen markieren" />
          <Checkbox checked={rule.flag} onChange={(_, d) => update({ flag: !!d.checked })} label="Kennzeichnen" />
          <Checkbox checked={rule.delete} onChange={(_, d) => update({ delete: !!d.checked, moveTo: d.checked ? null : rule.moveTo })} label="Löschen" />
          <Checkbox checked={rule.stop} onChange={(_, d) => update({ stop: !!d.checked })} label="Keine weiteren Regeln anwenden" />
          {!rule.fromContains && !rule.subjectContains && !rule.toContains && (
            <Text size={200} style={{ color: tokens.colorPaletteDarkOrangeForeground1 }}>
              Geben Sie mindestens eine Bedingung an – sonst wird die Regel nicht angewendet.
            </Text>
          )}
        </div>
      ) : (
        <Text style={{ color: tokens.colorNeutralForeground3 }}>
          Regeln werden auf neue E-Mails im Posteingang angewendet, solange Orbit läuft. Wählen Sie eine Regel aus oder legen Sie eine neue an.
        </Text>
      )}
    </div>
  );
}
