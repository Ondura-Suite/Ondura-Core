import { describe, expect, it } from "vitest";
import { categoryColor, defaultCategoryColor, setCategoryColors } from "./categories";

describe("category colours", () => {
  it("match the engine's derivation", () => {
    expect(defaultCategoryColor("Rot")).toBe("#e05260");
    expect(defaultCategoryColor("Blaue Kategorie")).toBe("#3b82c4");
    expect(defaultCategoryColor("Grüne Kategorie")).toBe("#3aa655");
    expect(defaultCategoryColor("Orange Kategorie")).toBe("#e8873b");
    // Same hash as crates/mail-core/src/categories.rs.
    expect(defaultCategoryColor("Projekt X")).toBe("#3b82c4");
  });

  it("prefer the category list's colour", () => {
    setCategoryColors([{ name: "Projekt X", color: "#17a2a2" }]);
    expect(categoryColor("projekt x")).toBe("#17a2a2");
    setCategoryColors([]);
    expect(categoryColor("projekt x")).toBe("#3b82c4");
  });
});
