// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { isGroceryOrder, parseItemmodFromDocument } from "./scraper";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isGroceryOrder", () => {
  it("returns true when the food progress tracker is present", () => {
    document.body.innerHTML = `<div id="f3_food_ProgressTracker"></div>`;
    expect(isGroceryOrder(document)).toBe(true);
  });

  it("returns false when the food progress tracker is absent", () => {
    document.body.innerHTML = `<div id="something-else"></div>`;
    expect(isGroceryOrder(document)).toBe(false);
  });
});

describe("parseItemmodFromDocument", () => {
  it("extracts a by-weight item with line total and quantity=1", () => {
    document.body.innerHTML = `
      <div id="B0787Y4V6T-item-grid-row" role="row">
        <img alt="Organic Banana, 1 Each" src="https://example.com/bananas.jpg" />
        <a class="a-link-normal a-text-normal"
           href="/gp/product/B0787Y4V6T?ref_=uff_od_product&amp;almBrandId=foo">
          <span> Organic Banana </span>
        </a>
        <span id="B0787Y4V6T-item-priced-by-quantity"> 2.50 lb </span>
        <span id="B0787Y4V6T-item-total-price"> $2.23 </span>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([
      {
        productId: "B0787Y4V6T",
        title: "Organic Banana",
        priceCents: 223,
        quantity: 1,
        imageUrl: "https://example.com/bananas.jpg",
      },
    ]);
  });

  it("extracts a by-unit item using the line total (qty column is ignored)", () => {
    document.body.innerHTML = `
      <div id="B0C4G8B5KZ-item-grid-row" role="row">
        <img alt="Eggs" src="https://example.com/eggs.jpg" />
        <a href="/gp/product/B0C4G8B5KZ?ref_=foo">
          <span> Vital Farms Hard-Boiled Eggs </span>
        </a>
        <div class="a-column">2</div>
        <span id="B0C4G8B5KZ-item-total-price"> $15.98 </span>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([
      {
        productId: "B0C4G8B5KZ",
        title: "Vital Farms Hard-Boiled Eggs",
        priceCents: 1598,
        quantity: 1,
        imageUrl: "https://example.com/eggs.jpg",
      },
    ]);
  });

  it("extracts multiple items in document order and skips the column-header row and dividers", () => {
    document.body.innerHTML = `
      <div role="row">
        <div role="columnheader"><span> Quantity </span></div>
        <div role="columnheader"><span> Total </span></div>
      </div>
      <div id="B0APPLE000-item-grid-row" role="row">
        <img src="https://example.com/apple.jpg" />
        <a href="/gp/product/B0APPLE000?ref_=x"><span>Honeycrisp Apple</span></a>
        <span id="B0APPLE000-item-total-price">$7.96</span>
      </div>
      <hr id="B0APPLE000-item-grid-divider" />
      <div id="B0YOGURT00-item-grid-row" role="row">
        <img src="https://example.com/yogurt.jpg" />
        <a href="/gp/product/B0YOGURT00?ref_=x"><span>Greek Yogurt</span></a>
        <span id="B0YOGURT00-item-total-price">$5.49</span>
      </div>
    `;
    const items = parseItemmodFromDocument(document);
    expect(items.map((i) => i.productId)).toEqual(["B0APPLE000", "B0YOGURT00"]);
    expect(items.map((i) => i.priceCents)).toEqual([796, 549]);
    expect(items.every((i) => i.quantity === 1)).toBe(true);
  });

  it("skips items missing a product link", () => {
    document.body.innerHTML = `
      <div id="B0NOLINK001-item-grid-row" role="row">
        <span>No link here</span>
        <span id="B0NOLINK001-item-total-price">$3.00</span>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([]);
  });

  it("skips items with zero or missing line total", () => {
    document.body.innerHTML = `
      <div id="B0FREE00001-item-grid-row" role="row">
        <a href="/gp/product/B0FREE00001?ref_=x"><span>Free Item</span></a>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([]);
  });
});
