// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { parseTargetDate, parseCents, isLoginUrl } from "./selectors";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("parseTargetDate", () => {
  it("parses abbreviated month", () => {
    expect(parseTargetDate("Jun 4, 2026")).toBe("2026-06-04");
  });
  it("parses full month", () => {
    expect(parseTargetDate("June 4, 2026")).toBe("2026-06-04");
  });
  it("parses weekday-prefixed date", () => {
    expect(parseTargetDate("Thu, Jun 4, 2026")).toBe("2026-06-04");
  });
  it("strips the Invoice date label", () => {
    expect(parseTargetDate("Invoice date: August 23, 2025")).toBe("2025-08-23");
  });
  it("returns empty string when unparseable", () => {
    expect(parseTargetDate("yesterday")).toBe("");
  });
});

describe("parseCents", () => {
  it("parses a positive dollar amount", () => {
    expect(parseCents("$18.59")).toBe(1859);
  });
  it("parses a negative amount as absolute cents", () => {
    expect(parseCents("$-40.00")).toBe(4000);
  });
});

describe("isLoginUrl", () => {
  it("detects the Target login redirect", () => {
    expect(isLoginUrl("https://www.target.com/login?client_id=ecom-web-1.0.0")).toBe(true);
  });
  it("returns false for the orders page", () => {
    expect(isLoginUrl("https://www.target.com/orders")).toBe(false);
  });
});
