import { makeStyles, mergeClasses, shorthands, tokens, type FluentProviderCustomStyleHooks } from "@fluentui/react-components";
import { onduraBrand } from "./theme";

// Fluent controls get the same material treatment as the panels, in the way
// Windows 11 does it: buttons carry a light top edge and a slightly darker
// bottom edge ("control elevation"), and the accent button is a gently lit
// gradient instead of a flat fill. Layout, sizes and behaviour stay Fluent's.
const useStyles = makeStyles({
  primary: {
    backgroundImage: `linear-gradient(180deg, ${onduraBrand[90]} 0%, ${onduraBrand[80]} 100%)`,
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(0, 0, 0, 0.18), 0 1px 2px rgba(35, 38, 120, 0.25), 0 4px 12px -4px rgba(79, 84, 212, 0.45)`,
    ...shorthands.borderColor("transparent"),
    ":hover": {
      backgroundImage: `linear-gradient(180deg, ${onduraBrand[100]} 0%, ${onduraBrand[90]} 100%)`,
      ...shorthands.borderColor("transparent"),
    },
    ":hover:active": {
      backgroundImage: `linear-gradient(180deg, ${onduraBrand[80]} 0%, ${onduraBrand[70]} 100%)`,
      boxShadow: `inset 0 1px 2px rgba(0, 0, 0, 0.2)`,
    },
  },
  secondary: {
    boxShadow: `inset 0 1px 0 var(--nx-highlight), inset 0 -1px 0 ${tokens.colorNeutralStroke2}`,
  },
  input: {
    boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.04)",
  },
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

export const glassStyleHooks: FluentProviderCustomStyleHooks = {
  useButtonStyles_unstable: useButtonGlass,
  useToggleButtonStyles_unstable: useButtonGlass,
  useMenuButtonStyles_unstable: useButtonGlass,
  useInputStyles_unstable: useInputGlass,
  useComboboxStyles_unstable: useInputGlass,
  useDropdownStyles_unstable: useInputGlass,
};
