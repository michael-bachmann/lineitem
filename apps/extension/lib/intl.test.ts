import { describe, it, expect } from "vitest";
import { plural } from "./intl";

describe("plural", () => {
  const forms = { one: "item", other: "items" };

  it("uses the singular form only for 1", () => {
    expect(plural(1, forms)).toBe("item");
  });

  it("uses the plural form for 0 and n > 1", () => {
    expect(plural(0, forms)).toBe("items");
    expect(plural(2, forms)).toBe("items");
    expect(plural(17, forms)).toBe("items");
  });
});
