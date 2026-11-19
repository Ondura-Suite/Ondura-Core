import { makeStyles, mergeClasses, shorthands, tokens, type FluentProviderCustomStyleHooks } from "@fluentui/react-components";

// Fluent controls get the same material treatment as the panels, in the way
// Windows 11 does it: buttons carry a light top edge and a slightly darker
// bottom edge ("control elevation"), and the accent button is a gently lit
// gradient instead of a flat fill. Layout, sizes and behaviour stay Fluent's.
const useStyles = makeStyles({
  // Fluent's own brand fill (and its hover/pressed colours) stays; a faint
  // top-down sheen and a light upper edge make it read as a lit surface.
  primary: {
    backgroundImage: "linear-gradient(180deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 100%)",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 0 rgba(0, 0, 0, 0.16), 0 1px 2px rgba(0, 0, 0, 0.14)",
    ...shorthands.borderColor("transparent"),
    ":hover": { ...shorthands.borderColor("transparent") },
    ":hover:active": { backgroundImage: "none", boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.2)" },
  },
  secondary: {
    boxShadow: `inset 0 1px 0 var(--nx-highlight), inset 0 -1px 0 ${tokens.colorNeutralStroke2}`,
  },
  input: {
    boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  // Narrow comboboxes (font size) must not push their chevron out of the box.
  comboInput: { minWidth: 0, width: "100%" },
  comboRoot: { boxSizing: "border-box" },
});

function useButtonGlass(state: unknown) {
  const s = useStyles();
  const st = state as { appearance?: string; disabled?: boolean; disabledFocusable?: boolean; root: { className?: string } };
  if (st.disabled || st.disabledFocusable) return;
  if (st.appearance === "primary") st.root.className = mergeClasses(st.root.className, s.primary);
  else if (st.appearance === "secondary") st.root.className = mergeClasses(st.root.className, s.secondary);
}

function useInputGlass(state: unknown) {
  const s = useStyles();
  const st = state as { root: { className?: string } };
  st.root.className = mergeClasses(st.root.className, s.input);
}

function useComboGlass(state: unknown) {
  const s = useStyles();
  const st = state as { root: { className?: string }; input?: { className?: string } };
  st.root.className = mergeClasses(st.root.className, s.input, s.comboRoot);
  if (st.input) st.input.className = mergeClasses(st.input.className, s.comboInput);
}

export const glassStyleHooks: FluentProviderCustomStyleHooks = {
  useButtonStyles_unstable: useButtonGlass,
  useToggleButtonStyles_unstable: useButtonGlass,
  useMenuButtonStyles_unstable: useButtonGlass,
  useInputStyles_unstable: useInputGlass,
  useComboboxStyles_unstable: useComboGlass,
  useDropdownStyles_unstable: useInputGlass,
};
