// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { isGroceryOrder, parseItemmodFromDocument, extractItemsSubtotal } from "./scraper";

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

  it("skips out-of-stock items (status row carries a matching credit, line nets to zero)", () => {
    document.body.innerHTML = `
      <div id="B01N1T6F3P-item-grid-row" role="row">
        <div class="a-column a-span11 a-span-last">
          <div class="a-row">
            <div class="a-column a-span6">
              <a href="/gp/product/B01N1T6F3P?ref_=uff_od_product"><span>Frozen Dessert Bars</span></a>
            </div>
            <div class="a-column a-span2 a-text-left a-span-last">
              <span id="B01N1T6F3P-item-total-price"> $15.78 </span>
            </div>
          </div>
          <div class="a-row">
            <div class="a-box ufpo-item-status">
              <div class="a-box-inner">
                <div class="a-row">
                  <span class="a-size-small a-text-bold">Out of stock (2)</span>
                  <span class="a-size-small a-text-bold">-$15.78</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([]);
  });
});

describe("extractItemsSubtotal", () => {
  it("extracts subtotal from grocery (Whole Foods) layout", () => {
    document.body.innerHTML = `
      <div class="a-row">
        <div class="a-column a-span8 a-text-left">
          <dt class="a-list-item"><span> Item(s) Subtotal: </span></dt>
        </div>
        <div class="a-column a-span4 a-text-right a-span-last">
          <dd class="a-list-item"><span> $183.23 </span></dd>
        </div>
      </div>
    `;
    expect(extractItemsSubtotal(document)).toBe(18323);
  });

  it("extracts subtotal from non-grocery (regular order) layout", () => {
    document.body.innerHTML = `
      <ul class="a-unordered-list a-nostyle a-vertical">
        <li>
          <span class="a-list-item">
            <div class="a-row od-line-item-row">
              <div class="a-column a-span7 od-line-item-row-label">
                <span class="a-size-base"><span>Item(s) Subtotal: </span></span>
              </div>
              <div class="a-column a-span5 od-line-item-row-content a-span-last">
                <span class="a-size-base a-color-base">$97.99</span>
              </div>
            </div>
          </span>
        </li>
      </ul>
    `;
    expect(extractItemsSubtotal(document)).toBe(9799);
  });

  it("returns null when the label is not present", () => {
    document.body.innerHTML = `<div>nothing here</div>`;
    expect(extractItemsSubtotal(document)).toBeNull();
  });

  it("returns null when label is present but no dollar amount is found nearby", () => {
    document.body.innerHTML = `
      <div>
        <span>Item(s) Subtotal:</span>
        <span>missing amount</span>
      </div>
    `;
    expect(extractItemsSubtotal(document)).toBeNull();
  });

  it("ignores whitespace around the label text", () => {
    document.body.innerHTML = `
      <div class="a-row">
        <span>   Item(s) Subtotal:   </span>
        <span>$12.34</span>
      </div>
    `;
    expect(extractItemsSubtotal(document)).toBe(1234);
  });
});
