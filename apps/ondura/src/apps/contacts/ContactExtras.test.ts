import { describe, expect, it } from "vitest";
import type { Contact } from "../../lib/pim";
import { findDuplicates, mergeContacts } from "./ContactExtras";

const c = (id: string, name: string, extra: Partial<Contact> = {}): Contact => ({
  id,
  collectionId: "ab",
  accountId: "local",
  remoteId: id,
  displayName: name,
  givenName: "",
  familyName: "",
  company: "",
  jobTitle: "",
  emails: [],
  phones: [],
  addresses: [],
  birthday: null,
  notes: "",
  ...extra,
});

describe("duplicates", () => {
  it("groups by address, phone and name", () => {
    const list = [
      c("1", "Anna Schmitt", { emails: [{ label: "work", value: "anna@example.com" }] }),
      c("2", "A. Schmitt", { emails: [{ label: "home", value: "ANNA@example.com" }], phones: [{ label: "mobile", value: "+49 170 1234567" }] }),
      c("3", "Anna S.", { phones: [{ label: "mobile", value: "0049 170 1234567" }] }),
      c("4", "Max Becker"),
      c("5", "max  becker"),
      c("6", "Tom"),
    ];
    const groups = findDuplicates(list).map((g) => g.map((x) => x.id).sort());
    expect(groups).toContainEqual(["1", "2", "3"]);
    expect(groups).toContainEqual(["4", "5"]);
    expect(groups).toHaveLength(2);
  });

  it("merges fields into the first contact", () => {
    const m = mergeContacts([
      c("1", "Anna", { emails: [{ label: "work", value: "a@x.de" }] }),
      c("2", "", { company: "MirraNET", emails: [{ label: "home", value: "A@x.de" }, { label: "home", value: "b@x.de" }], notes: "Notiz" }),
    ]);
    expect(m.id).toBe("1");
    expect(m.company).toBe("MirraNET");
    expect(m.emails.map((e) => e.value)).toEqual(["a@x.de", "b@x.de"]);
    expect(m.notes).toBe("Notiz");
  });
});
