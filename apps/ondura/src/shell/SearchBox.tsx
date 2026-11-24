// Fluent's SearchBox with a translated name for its clear button (Fluent
// calls it "clear" in every language).

import { SearchBox as FluentSearchBox, type SearchBoxProps } from "@fluentui/react-components";
import { tl } from "../lib/i18n";

export function SearchBox(props: SearchBoxProps) {
  return <FluentSearchBox dismiss={{ "aria-label": tl("Suche löschen") }} {...props} />;
}
