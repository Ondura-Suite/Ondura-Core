// Fluent's SpinButton with translated names for its arrow buttons (Fluent
// names them "Increment value" / "Decrement value" in every language).

import { SpinButton as FluentSpinButton, type SpinButtonProps } from "@fluentui/react-components";
import { tl } from "../lib/i18n";

export function SpinButton(props: SpinButtonProps) {
  return <FluentSpinButton incrementButton={{ "aria-label": tl("Wert erhöhen") }} decrementButton={{ "aria-label": tl("Wert verringern") }} {...props} />;
}
