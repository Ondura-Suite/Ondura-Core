// Application context menus instead of the webview's own menu.
//
// <ContextMenuHost /> (rendered once per window in main.tsx) suppresses the
// browser menu everywhere. Components open their own menu with
// `openContextMenu(e, items)` from an onContextMenu handler; text fields and
// selected text without a menu of their own get a standard edit menu.

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { isTauri } from "../lib/api";
import { IS_MAC } from "../lib/platform";
import { tl, tlc } from "../lib/i18n";

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  /** Shown on the right, e.g. "Strg+C". */
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
  /** Opens a submenu instead of running an action. */
  items?: MenuEntry[];
}
export type MenuEntry = MenuAction | "divider" | null | false | undefined;

interface Open {
  x: number;
  y: number;
  items: MenuEntry[];
}

let open: Open | null = null;
const listeners = new Set<() => void>();
const setOpen = (o: Open | null) => {
  open = o;
  listeners.forEach((l) => l());
};

/** Opens a context menu at the mouse position (call from onContextMenu). */
export function openContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: MenuEntry[]) {
  e.preventDefault();
  e.stopPropagation?.();
  setOpen({ x: e.clientX, y: e.clientY, items });
}

export function closeContextMenu() {
  setOpen(null);
}

/** Shortcut label, e.g. key("C") → "Strg+C" (macOS: "⌘C"). */
export const key = (k: string) => (IS_MAC ? `⌘${k}` : `${tl("Strg")}+${k}`);

/** Clipboard text: the webview API, else the clipboard plugin (desktop). */
export async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    if (!isTauri) return "";
    try {
      return (await invoke<string>("plugin:clipboard-manager|read_text")) ?? "";
    } catch {
      return "";
    }
  }
}

/** Clipboard HTML if available (rich paste), else null. */
export async function readClipboardHtml(): Promise<string | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes("text/html")) return await (await item.getType("text/html")).text();
    }
  } catch {
    /* not permitted or unsupported */
  }
  return null;
}

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function editableOf(target: EventTarget | null): Editable | null {
  const el = target instanceof Element ? target : null;
  if (!el) return null;
  const field = el.closest("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
  if (field) {
    const type = (field as HTMLInputElement).type;
    if (field instanceof HTMLTextAreaElement || ["text", "search", "email", "url", "tel", "password", "number", ""].includes(type)) return field;
    return null;
  }
  const ce = el.closest("[contenteditable]") as HTMLElement | null;
  return ce && ce.isContentEditable ? ce : null;
}

/** Standard edit menu for a text field or editable element. */
export function editMenu(target: Editable): MenuEntry[] {
  const isField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  const readOnly = isField ? target.readOnly || target.disabled : !target.isContentEditable;
  const selected = isField ? (target.selectionStart ?? 0) !== (target.selectionEnd ?? 0) : !document.getSelection()?.isCollapsed;
  const password = target instanceof HTMLInputElement && target.type === "password";
  const run = (cmd: string) => () => {
    target.focus();
    document.execCommand(cmd);
  };
  return [
    { label: tl("Rückgängig"), shortcut: key("Z"), disabled: readOnly, onClick: run("undo") },
    { label: tlc("edit", "Wiederholen"), shortcut: key("Y"), disabled: readOnly, onClick: run("redo") },
    "divider",
    { label: tl("Ausschneiden"), shortcut: key("X"), disabled: readOnly || !selected || password, onClick: run("cut") },
    { label: tl("Kopieren"), shortcut: key("C"), disabled: !selected || password, onClick: run("copy") },
    {
      label: tlc("paste", "Einfügen"),
      shortcut: key("V"),
      disabled: readOnly,
      onClick: () =>
        void readClipboardText().then((text) => {
          target.focus();
          if (text) document.execCommand("insertText", false, text);
        }),
    },
    { label: tl("Löschen"), disabled: readOnly || !selected, onClick: run("delete") },
    "divider",
    {
      label: tl("Alles auswählen"),
      shortcut: key("A"),
      onClick: () => {
        target.focus();
        if (isField) target.select();
        else document.execCommand("selectAll");
      },
    },
  ];
}

/** Menu for selected, read-only text (e.g. a message in the reading pane). */
function selectionMenu(): MenuEntry[] {
  return [
    { label: tl("Kopieren"), shortcut: key("C"), onClick: () => document.execCommand("copy") },
    "divider",
    {
      label: tl("Alles auswählen"),
      shortcut: key("A"),
      onClick: () => {
        const sel = document.getSelection();
        const root = sel?.anchorNode?.parentElement?.closest("[data-selectable], article, .nx-mail-body") ?? null;
        if (sel && root) sel.selectAllChildren(root);
      },
    },
  ];
}

const virtualTarget = (x: number, y: number) => ({
  getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect,
});

function Entries({ items }: { items: MenuEntry[] }) {
  const list = items.filter(Boolean) as (MenuAction | "divider")[];
  // No dividers at the start, the end or twice in a row.
  const clean = list.filter((e, i) => e !== "divider" || (i > 0 && i < list.length - 1 && list[i - 1] !== "divider"));
  return (
    <>
      {clean.map((e, i) =>
        e === "divider" ? (
          <MenuDivider key={i} />
        ) : e.items ? (
          <Menu key={i}>
            <MenuTrigger disableButtonEnhancement>
              <MenuItem icon={e.icon as never} disabled={e.disabled}>
                {e.label}
              </MenuItem>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <Entries items={e.items} />
              </MenuList>
            </MenuPopover>
          </Menu>
        ) : (
          <MenuItem key={i} icon={e.icon as never} disabled={e.disabled} secondaryContent={e.shortcut} onClick={() => (closeContextMenu(), e.onClick?.())}>
            {e.label}
          </MenuItem>
        ),
      )}
    </>
  );
}

export function ContextMenuHost() {
  const state = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
  );

  useEffect(() => {
    // Runs after React's handlers: a component that opened its own menu has
    // already called preventDefault().
    const onMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const target = editableOf(e.target);
      if (target) return setOpen({ x: e.clientX, y: e.clientY, items: editMenu(target) });
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) return setOpen({ x: e.clientX, y: e.clientY, items: selectionMenu() });
    };
    window.addEventListener("contextmenu", onMenu);
    return () => window.removeEventListener("contextmenu", onMenu);
  }, []);

  if (!state) return null;
  return (
    <Menu key={`${state.x},${state.y}`} open onOpenChange={(_, d) => !d.open && closeContextMenu()} positioning={{ target: virtualTarget(state.x, state.y), position: "below", align: "start" }}>
      <MenuPopover onContextMenu={(e) => e.preventDefault()}>
        <MenuList>
          <Entries items={state.items} />
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
