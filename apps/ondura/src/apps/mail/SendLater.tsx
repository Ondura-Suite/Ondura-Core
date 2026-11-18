import { useState, type ReactElement } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  SplitButton,
  type MenuButtonProps,
} from "@fluentui/react-components";
import { Clock20Regular } from "@fluentui/react-icons";

function at(days: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function nextMonday(): Date {
  const d = at(0, 8);
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d;
}

const fmt = (d: Date) => d.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "Senden" with a menu for delayed sending, like in Outlook. */
export function SendLaterButton({ disabled, icon, onSend, onSendAt }: { disabled: boolean; icon: ReactElement; onSend: () => void; onSendAt: (d: Date) => void }) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState("");
  const inHour = new Date(Date.now() + 60 * 60_000);
  const tomorrow = at(1, 8);
  const monday = nextMonday();
  const customDate = value ? new Date(value) : null;
  const validCustom = !!customDate && !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now() + 30_000;

  return (
    <>
      <Menu positioning="below-start">
        <MenuTrigger disableButtonEnhancement>
          {(trigger: MenuButtonProps) => (
            <SplitButton appearance="primary" icon={icon} disabled={disabled} menuButton={trigger} primaryActionButton={{ onClick: onSend }}>
              Senden
            </SplitButton>
          )}
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem icon={<Clock20Regular />} onClick={() => onSendAt(inHour)}>In 1 Stunde senden ({fmt(inHour)})</MenuItem>
            <MenuItem icon={<Clock20Regular />} onClick={() => onSendAt(tomorrow)}>Morgen früh senden ({fmt(tomorrow)})</MenuItem>
            <MenuItem icon={<Clock20Regular />} onClick={() => onSendAt(monday)}>Montag früh senden ({fmt(monday)})</MenuItem>
            <MenuItem
              icon={<Clock20Regular />}
              onClick={() => {
                setValue(toLocalInput(inHour));
                setCustom(true);
              }}
            >
              Sendezeitpunkt wählen …
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      <Dialog open={custom} onOpenChange={(_, d) => setCustom(d.open)}>
        <DialogSurface style={{ maxWidth: 380 }}>
          <DialogBody>
            <DialogTitle>Später senden</DialogTitle>
            <DialogContent>
              <Field label="Senden am" hint="Die Nachricht wartet bis dahin im Postausgang. Ondura Mail muss dann laufen." validationMessage={value && !validCustom ? "Bitte einen Zeitpunkt in der Zukunft wählen" : undefined}>
                <Input type="datetime-local" value={value} onChange={(_, d) => setValue(d.value)} />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setCustom(false)}>Abbrechen</Button>
              <Button
                appearance="primary"
                disabled={!validCustom}
                onClick={() => {
                  setCustom(false);
                  if (customDate) onSendAt(customDate);
                }}
              >
                Planen
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
