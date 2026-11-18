// Language selection (Hilfe › Sprache and the Ondura Mail settings).

import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, MessageBar, MessageBarActions, MessageBarBody, Option } from "@fluentui/react-components";
import { LANG, LANGUAGES, type LangChoice, languageChoice, resolveLanguage, setLanguage, tl } from "../lib/i18n";

const nameOf = (id: string) => LANGUAGES.find((l) => l.id === id)?.name ?? id;

export function LanguagePicker() {
  const [choice, setChoice] = useState<LangChoice>(languageChoice());
  const pending = resolveLanguage(choice) !== LANG;
  const label = (c: LangChoice) => (c === "system" ? tl("Systemsprache ({0})", nameOf(resolveLanguage("system"))) : nameOf(c));
  return (
    <>
      <Field label={tl("Sprache der Benutzeroberfläche")}>
        <Dropdown
          value={label(choice)}
          selectedOptions={[choice]}
          onOptionSelect={(_, d) => {
            const c = d.optionValue as LangChoice;
            setChoice(c);
            setLanguage(c);
          }}
          style={{ minWidth: 240 }}
        >
          {(["system", ...LANGUAGES.map((l) => l.id)] as LangChoice[]).map((c) => (
            <Option key={c} value={c} text={label(c)}>
              {label(c)}
            </Option>
          ))}
        </Dropdown>
      </Field>
      {pending && (
        <MessageBar intent="info">
          <MessageBarBody>{tl("Neue Fenster verwenden die gewählte Sprache. Laden Sie dieses Fenster neu, um sie hier zu übernehmen.")}</MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => location.reload()}>
              {tl("Neu laden")}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}
    </>
  );
}

export function LanguageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 460 }}>
        <DialogBody>
          <DialogTitle>{tl("Sprache")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <LanguagePicker />
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
