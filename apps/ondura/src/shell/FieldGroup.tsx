// A labelled group of several controls. Fluent's Field hands its id to
// every control inside it, so several checkboxes in one Field share an id
// and a click on any label toggles the first one; this group labels them
// together without that.

import { useId, type CSSProperties, type ReactNode } from "react";
import { Label } from "@fluentui/react-components";

export function FieldGroup({ label, hint, children, style, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; style?: CSSProperties; className?: string }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={className} style={{ display: "flex", flexDirection: "column", gap: 2, ...style }}>
      <Label id={id}>{label}</Label>
      {children}
      {hint && <span style={{ fontSize: 12, color: "var(--colorNeutralForeground3)" }}>{hint}</span>}
    </div>
  );
}
