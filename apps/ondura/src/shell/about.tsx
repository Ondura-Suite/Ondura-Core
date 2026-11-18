// "Über Ondura": version, copyright, license notice (GPL-3.0-or-later,
// "Appropriate Legal Notices" in the sense of GPL §0) and the bundled
// license texts (see src-tauri/src/legal.rs, scripts/third-party-notices.py).

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Link, Spinner, Tab, TabList, Text } from "@fluentui/react-components";
import { api, isTauri } from "../lib/api";
import { tl } from "../lib/i18n";

const SOURCE = "https://github.com/Ondura-Suite/Ondura-Core";

type Page = "about" | "license" | "notices";

export function AboutDialog({ open, version, onClose }: { open: boolean; version: string; onClose: () => void }) {
  const [page, setPage] = useState<Page>("about");
  const [texts, setTexts] = useState<Partial<Record<Page, string>>>({});

  useEffect(() => {
    if (!open) setPage("about");
  }, [open]);

  useEffect(() => {
    if (page === "about" || texts[page] !== undefined) return;
    if (!isTauri) {
      setTexts((t) => ({ ...t, [page]: tl("Der Text liegt der Desktop-App bei und ist im Quellcode zu finden: {0}", SOURCE) }));
      return;
    }
    invoke<string>("legal_text", { which: page === "license" ? "license" : "notices" })
      .then((text) => setTexts((t) => ({ ...t, [page]: text })))
      .catch((e) => setTexts((t) => ({ ...t, [page]: tl("Der Text konnte nicht geladen werden: {0}", String(e)) })));
  }, [page, texts]);

  const text = page === "about" ? undefined : texts[page];
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>{tl("Über Ondura")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <TabList selectedValue={page} onTabSelect={(_, d) => setPage(d.value as Page)} size="small">
              <Tab value="about">{tl("Info")}</Tab>
              <Tab value="license">{tl("Lizenz")}</Tab>
              <Tab value="notices">{tl("Drittanbieter")}</Tab>
            </TabList>
            {page === "about" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <img src="/ondura.svg" alt="" width={44} height={44} />
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <Text weight="semibold" size={500}>
                      {tl("Ondura")}
                    </Text>
                    <Text size={200}>{tl("Version")} {version}</Text>
                  </div>
                </div>
                <Text size={200}>{tl("Copyright © 2026 Niklas Linz (MirraNET)")}</Text>
                <Text size={200}>
                  {tl("Ondura ist freie Software: Sie können sie unter den Bedingungen der GNU General Public License, Version 3 oder (nach Ihrer Wahl) jeder späteren Version, weitergeben und/oder verändern. Ondura wird in der Hoffnung bereitgestellt, dass es nützlich ist, aber")} <b>{tl("ohne jede Gewährleistung")}</b> {tl("– sogar ohne die implizite Gewährleistung der Marktreife oder der Eignung für einen bestimmten Zweck. Details stehen in der Lizenz.")}
                </Text>
                <Text size={200}>
                  {tl("Quellcode:")}{" "}
                  <Link inline onClick={() => void api.openExternal(SOURCE)}>
                    {SOURCE.replace("https://", "")}
                  </Link>
                </Text>
                <Text size={200}>
                  {tl("Der Name „Ondura“ und das Ondura-Logo sind nicht Teil der Lizenz. Microsoft, Microsoft 365, Outlook, Exchange, OneDrive und SharePoint sind Marken der Microsoft-Unternehmensgruppe; Ondura ist ein unabhängiges Produkt und steht in keiner Verbindung zu Microsoft.")}
                </Text>
              </div>
            ) : text === undefined ? (
              <Spinner size="small" />
            ) : (
              <pre style={{ margin: 0, maxHeight: 380, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 12, padding: "8px 10px", borderRadius: 6, background: "var(--colorNeutralBackground3)" }}>{text}</pre>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              {tl("Schließen")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
