import { describe, expect, it } from "vitest";
import { AUTH_PAGE_REGEX } from "./selectors";

describe("AUTH_PAGE_REGEX", () => {
  it("matches the real sign-in redirect (query string, no trailing slash)", () => {
    const url =
      "https://www.amazon.com/ap/signin?openid.pape.max_auth_age=3600&openid.return_to=https%3A%2F%2Fwww.amazon.com%2Fcpe%2Fyourpayments%2Ftransactions";
    expect(AUTH_PAGE_REGEX.test(url)).toBe(true);
  });

  it("matches path-style auth URLs", () => {
    expect(AUTH_PAGE_REGEX.test("https://www.amazon.com/ap/signin/")).toBe(true);
    expect(AUTH_PAGE_REGEX.test("https://www.amazon.com/ap/challenge?foo=1")).toBe(true);
    expect(AUTH_PAGE_REGEX.test("https://www.amazon.com/ap/cvf/request")).toBe(true);
  });

  it("does not match normal authenticated pages", () => {
    expect(AUTH_PAGE_REGEX.test("https://www.amazon.com/cpe/yourpayments/transactions")).toBe(false);
    expect(AUTH_PAGE_REGEX.test("https://www.amazon.com/gp/css/summary/edit.html?orderID=123")).toBe(false);
  });
});
