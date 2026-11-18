// Dialogs of the mail merge ("Sendungen"): recipient list, a typed-in list
// and the choice of a worksheet.

import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, Option, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowSortDown16Regular, ArrowSortUp16Regular, Search20Regular } from "@fluentui/react-icons";
import { type MergeData, type MergeState, parseCsv } from "./merge";

function Frame({ title, width = 440, children, actions, onClose }: { title: string; width?: number; children: React.ReactNode; actions: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const useStyles = makeStyles({
  wrap: { maxHeight: "360px", overflow: "auto", border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  table: { borderCollapse: "collapse", width: "100%", fontSize: tokens.fontSizeBase200 },
  th: {
    position: "sticky",
    top: 0,
    backgroundColor: tokens.colorNeutralBackground3,
    textAlign: "left",
    padding: "4px 8px",
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  td: { padding: "2px 8px", whiteSpace: "nowrap", borderBottom: `1px solid ${tokens.colorNeutralStroke3}` },
  off: { color: tokens.colorNeutralForeground4 },
  bar: { display: "flex", gap: "8px", alignItems: "center" },
});

/** Recipient list: include/exclude rows, sort by a column, search. */
export function RecipientsDialog(p: { state: MergeState; onClose: () => void; onApply: (s: MergeState) => void }) {
  const s = useStyles();
  const { data } = p.state;
  const [included, setIncluded] = useState(p.state.included);
  const [order, setOrder] = useState(p.state.order);
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => order.filter((r) => !q || data.rows[r].some((c) => c.toLowerCase().includes(q))), [order, q, data.rows]);

  const sortBy = (col: number) => {
    const desc = sort?.col === col ? !sort.desc : false;
    setSort({ col, desc });
    const cmp = (a: number, b: number) => (data.rows[a][col] ?? "").localeCompare(data.rows[b][col] ?? "", "de", { numeric: true });
    setOrder([...order].sort((a, b) => (desc ? cmp(b, a) : cmp(a, b))));
  };
  const setAll = (on: boolean) => setIncluded(included.map((v, i) => (shown.includes(i) ? on : v)));
  const count = included.filter(Boolean).length;

  return (
    <Frame
      title="Seriendruckempfänger"
      width={760}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" onClick={() => p.onApply({ data, included, order })}>
            OK
          </Button>
        </>
      }
    >
      <div className={s.bar}>
        <Input contentBefore={<Search20Regular />} placeholder="Empfänger suchen" value={query} onChange={(_, d) => setQuery(d.value)} style={{ flex: 1 }} />
        <Button size="small" onClick={() => setAll(true)}>
          Alle auswählen
        </Button>
        <Button size="small" onClick={() => setAll(false)}>
          Keine
        </Button>
      </div>
      <div className={s.wrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th} style={{ width: 28 }} />
              {data.columns.map((c, i) => (
                <th key={c} className={s.th} onClick={() => sortBy(i)} title="Nach dieser Spalte sortieren">
                  {c} {sort?.col === i && (sort.desc ? <ArrowSortUp16Regular /> : <ArrowSortDown16Regular />)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r} className={included[r] ? undefined : s.off}>
                <td className={s.td}>
                  <Checkbox aria-label={`Datensatz ${r + 1}`} checked={included[r]} onChange={(_, d) => setIncluded(included.map((v, i) => (i === r ? !!d.checked : v)))} />
                </td>
                {data.columns.map((c, i) => (
                  <td key={c} className={s.td}>
                    {data.rows[r][i]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span style={{ color: tokens.colorNeutralForeground3 }}>
        Datenquelle: {data.source} · {count} von {data.rows.length} Empfängern ausgewählt
      </span>
    </Frame>
  );
}

const NEW_LIST = "Vorname;Nachname;Straße;PLZ;Ort\n";

/** A recipient list typed in directly (first line = column names). */
export function NewListDialog(p: { open: boolean; onClose: () => void; onCreate: (d: MergeData) => void }) {
  const [text, setText] = useState(NEW_LIST);
  useEffect(() => {
    if (p.open) setText(NEW_LIST);
  }, [p.open]);
  if (!p.open) return null;
  const data = parseCsv(text, "Eigene Liste");
  return (
    <Frame
      title="Neue Adressliste"
      width={600}
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" disabled={!data.rows.length} onClick={() => p.onCreate(data)}>
            OK
          </Button>
        </>
      }
    >
      <Field label="Ein Empfänger pro Zeile, Spalten durch Semikolon getrennt. Die erste Zeile enthält die Spaltennamen." hint={`${data.columns.length} Spalten · ${data.rows.length} Empfänger`}>
        <Textarea value={text} autoFocus resize="vertical" rows={10} style={{ fontFamily: "Consolas, monospace" }} onChange={(_, d) => setText(d.value)} />
      </Field>
    </Frame>
  );
}

/** Choice of the worksheet holding the recipients. */
export function SheetPickDialog(p: { sheets: string[] | null; onClose: () => void; onPick: (i: number) => void }) {
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [p.sheets]);
  if (!p.sheets) return null;
  return (
    <Frame
      title="Tabelle auswählen"
      onClose={p.onClose}
      actions={
        <>
          <Button onClick={p.onClose}>Abbrechen</Button>
          <Button appearance="primary" onClick={() => p.onPick(pick)}>
            OK
          </Button>
        </>
      }
    >
      <Field label="Tabellenblatt mit den Empfängern (erste Zeile = Spaltennamen)">
        <Dropdown value={p.sheets[pick]} selectedOptions={[String(pick)]} onOptionSelect={(_, d) => setPick(Number(d.optionValue))}>
          {p.sheets.map((n, i) => (
            <Option key={i} value={String(i)}>
              {n}
            </Option>
          ))}
        </Dropdown>
      </Field>
    </Frame>
  );
}
