// Table style gallery ("Als Tabelle formatieren", "Tabellenformatvorlagen").

import { Text, tokens } from "@fluentui/react-components";
import { TABLE_FAMILIES, styleSwatch } from "./tables";

function Swatch({ name, active, onPick }: { name: string; active: boolean; onPick: () => void }) {
  const [head, band, body] = styleSwatch(name);
  const dark = name.includes("Dark");
  return (
    <button
      type="button"
      title={name}
      onClick={onPick}
      style={{ width: 46, height: 34, padding: 2, border: `1px solid ${active ? tokens.colorBrandStroke1 : "transparent"}`, background: "transparent", cursor: "pointer", borderRadius: 3 }}
    >
      <svg width="40" height="28" viewBox="0 0 40 28" aria-hidden>
        <rect x="0.5" y="0.5" width="39" height="27" fill={body} stroke={dark ? "none" : "#c8c8c8"} />
        <rect x="0.5" y="0.5" width="39" height="6" fill={head === "#ffffff" ? "#ffffff" : head} stroke="none" />
        {head === "#ffffff" && <line x1="0" y1="6.5" x2="40" y2="6.5" stroke="#808080" strokeWidth="1" />}
        {[0, 2].map((i) => (
          <rect key={i} x="0.5" y={7 + i * 5} width="39" height="5" fill={band} />
        ))}
        {[1, 2, 3].map((i) => (
          <line key={i} x1="4" x2="36" y1={9 + i * 5 - 5} y2={9 + i * 5 - 5} stroke={dark ? "#ffffff80" : "#00000025"} strokeWidth="0.8" />
        ))}
      </svg>
    </button>
  );
}

export function TableStyleGallery({ current, onPick }: { current?: string; onPick: (style: string) => void }) {
  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      {TABLE_FAMILIES.map((f) => (
        <div key={f.id}>
          <Text size={200} weight="semibold">
            {f.label}
          </Text>
          <div style={{ display: "flex", gap: 2, marginTop: 2 }}>
            {Array.from({ length: 7 }, (_, i) => `TableStyle${f.id}${i + 1}`).map((n) => (
              <Swatch key={n} name={n} active={n === current} onPick={() => onPick(n)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
