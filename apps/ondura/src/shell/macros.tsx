// Macro list and script editor shared by Ondura Tabellen and Text.
//
// Macros are JavaScript scripts kept per app in the local profile – never
// in documents, so opening a file can't run code. VBA macros in .xlsm or
// .docm files are kept in the file but not run.

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  MessageBar,
  MessageBarBody,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add16Regular, Delete16Regular, Play16Regular, Record16Regular } from "@fluentui/react-icons";

export interface Macro {
  id: string;
  name: string;
  code: string;
}

const storeKey = (app: string) => `ondura.macros.${app}`;

export function loadMacros(app: string): Macro[] {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(app)) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveMacros(app: string, list: Macro[]) {
  try {
    localStorage.setItem(storeKey(app), JSON.stringify(list));
  } catch {
    /* storage full or unavailable */
  }
}

/** Add or replace a macro by name. */
export function storeMacro(app: string, name: string, code: string): Macro {
  const list = loadMacros(app);
  const existing = list.find((m) => m.name === name);
  const m: Macro = { id: existing?.id ?? crypto.randomUUID(), name, code };
  saveMacros(app, existing ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m]);
  return m;
}

const useStyles = makeStyles({
  surface: { maxWidth: "940px", width: "92vw" },
  layout: { display: "grid", gridTemplateColumns: "220px 1fr", gap: "16px", minHeight: "440px" },
  list: { display: "flex", flexDirection: "column", gap: "2px", borderRight: `1px solid ${tokens.colorNeutralStroke2}`, paddingRight: "8px" },
  item: {
    textAlign: "left",
    padding: "6px 10px",
    border: "none",
    background: "transparent",
    borderRadius: tokens.borderRadiusMedium,
    font: "inherit",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  active: { backgroundColor: tokens.colorBrandBackground2, fontWeight: tokens.fontWeightSemibold },
  editor: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
  code: { flex: 1 },
  codeArea: { fontFamily: tokens.fontFamilyMonospace, fontSize: "12.5px", minHeight: "260px", tabSize: 2, fontVariantLigatures: "none" },
  row: { display: "flex", gap: "8px", alignItems: "center" },
  output: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    maxHeight: "90px",
    overflowY: "auto",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  help: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, "& code": { fontFamily: tokens.fontFamilyMonospace } },
});

export interface MacroDialogProps {
  open: boolean;
  /** Storage key of the app ("sheets", "text"). */
  app: string;
  /** Short API reference shown under the editor. */
  reference: React.ReactNode;
  /** Code of a new macro. */
  template: string;
  /** Run a script; returns console output or an error. */
  onRun: (code: string) => { log: string[]; error?: string };
  /** Start recording into a macro of this name (omit if the app can't record). */
  onRecord?: (name: string) => void;
  /** Macro to select when the dialog opens (e.g. one just recorded). */
  initialId?: string | null;
  onClose: () => void;
}

export function MacroDialog(p: MacroDialogProps) {
  const s = useStyles();
  const [list, setList] = useState<Macro[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ log: string[]; error?: string } | null>(null);

  useEffect(() => {
    if (!p.open) return;
    const l = loadMacros(p.app);
    setList(l);
    const pick = l.find((m) => m.id === p.initialId) ?? l[0];
    setCurrent(pick?.id ?? null);
    setName(pick?.name ?? "");
    setCode(pick?.code ?? "");
    setResult(null);
  }, [p.open, p.app, p.initialId]);

  const dirty = useMemo(() => {
    const m = list.find((x) => x.id === current);
    return !m || m.name !== name || m.code !== code;
  }, [list, current, name, code]);

  const persist = (): Macro[] => {
    const id = current ?? crypto.randomUUID();
    const m = { id, name: name.trim() || "Makro", code };
    const next = list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? m : x)) : [...list, m];
    saveMacros(p.app, next);
    setList(next);
    setCurrent(id);
    return next;
  };

  const pick = (m: Macro) => {
    if (dirty && (name || code)) persist();
    setCurrent(m.id);
    setName(m.name);
    setCode(m.code);
    setResult(null);
  };

  return (
    <Dialog open={p.open} onOpenChange={(_, d) => !d.open && p.onClose()}>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>Makros</DialogTitle>
          <DialogContent>
            <div className={s.layout}>
              <div className={s.list}>
                {list.map((m) => (
                  <button key={m.id} className={`${s.item} ${m.id === current ? s.active : ""}`} onClick={() => pick(m)}>
                    {m.name}
                  </button>
                ))}
                <Button
                  appearance="subtle"
                  icon={<Add16Regular />}
                  style={{ justifyContent: "flex-start" }}
                  onClick={() => {
                    if (dirty && (name || code)) persist();
                    setCurrent(null);
                    setName(`Makro${list.length + 1}`);
                    setCode(p.template);
                    setResult(null);
                  }}
                >
                  Neues Makro
                </Button>
                {p.onRecord && (
                  <Button
                    appearance="subtle"
                    icon={<Record16Regular />}
                    style={{ justifyContent: "flex-start" }}
                    onClick={() => p.onRecord!(`Aufzeichnung${list.length + 1}`)}
                  >
                    Makro aufzeichnen
                  </Button>
                )}
              </div>
              <div className={s.editor}>
                {list.length === 0 && current === null && !code ? (
                  <MessageBar intent="info">
                    <MessageBarBody>Noch keine Makros. Legen Sie ein neues an{p.onRecord ? " oder zeichnen Sie Ihre Schritte auf" : ""}.</MessageBarBody>
                  </MessageBar>
                ) : (
                  <>
                    <div className={s.row}>
                      <Input value={name} onChange={(_, d) => setName(d.value)} aria-label="Name des Makros" style={{ flex: 1 }} />
                      <Button
                        appearance="primary"
                        icon={<Play16Regular />}
                        onClick={() => {
                          persist();
                          setResult(p.onRun(code));
                        }}
                      >
                        Ausführen
                      </Button>
                      <Button
                        icon={<Delete16Regular />}
                        aria-label="Makro löschen"
                        disabled={!current}
                        onClick={() => {
                          const next = list.filter((x) => x.id !== current);
                          saveMacros(p.app, next);
                          setList(next);
                          setCurrent(next[0]?.id ?? null);
                          setName(next[0]?.name ?? "");
                          setCode(next[0]?.code ?? "");
                        }}
                      />
                    </div>
                    <Textarea
                      className={s.code}
                      textarea={{ className: s.codeArea }}
                      value={code}
                      spellCheck={false}
                      resize="vertical"
                      onChange={(_, d) => setCode(d.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") {
                          e.preventDefault();
                          const t = e.currentTarget;
                          const at = t.selectionStart;
                          setCode(code.slice(0, at) + "  " + code.slice(t.selectionEnd));
                          requestAnimationFrame(() => t.setSelectionRange(at + 2, at + 2));
                        }
                      }}
                    />
                    {result && (
                      <div className={s.output} style={result.error ? { color: tokens.colorPaletteRedForeground1 } : undefined}>
                        {result.error ? `Fehler: ${result.error}` : result.log.length ? result.log.join("\n") : "Makro ausgeführt."}
                      </div>
                    )}
                    <div className={s.help}>{p.reference}</div>
                  </>
                )}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                if (dirty && (name || code)) persist();
                p.onClose();
              }}
            >
              Schließen
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
