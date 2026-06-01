// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import {
  isGroceryOrder,
  parseItemmodFromDocument,
  extractItemsSubtotal,
  parseRefundSummary,
} from "./scraper";

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
        refundedAmountCents: 0,
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
        refundedAmountCents: 0,
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

  it("sets refundedAmountCents from the per-item refund marker", () => {
    document.body.innerHTML = `
      <div id="B0BFKD24CF-item-grid-row" role="row">
        <img src="https://example.com/chips.jpg" />
        <a href="/gp/product/B0BFKD24CF?ref_=x"><span>Wilde Snacks Chips</span></a>
        <span id="B0BFKD24CF-item-total-price"> $15.00 </span>
        <div class="ufpo-item-status">
          <div class="a-row">
            <span class="a-size-small a-text-bold">Refunded (3)</span>
            <span class="ufpo-item-status-price"><span class="a-size-small a-text-bold"> -$15.00 </span></span>
          </div>
        </div>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([
      {
        productId: "B0BFKD24CF",
        title: "Wilde Snacks Chips",
        priceCents: 1500,
        quantity: 1,
        imageUrl: "https://example.com/chips.jpg",
        refundedAmountCents: 1500,
      },
    ]);
  });

  it("leaves refundedAmountCents at 0 when no refund marker is present", () => {
    document.body.innerHTML = `
      <div id="B0DHFXHD8Q-item-grid-row" role="row">
        <img src="https://example.com/m.jpg" />
        <a href="/gp/product/B0DHFXHD8Q?ref_=x"><span>Rudis Muffins</span></a>
        <span id="B0DHFXHD8Q-item-total-price"> $5.49 </span>
      </div>
    `;
    const items = parseItemmodFromDocument(document);
    expect(items).toHaveLength(1);
    expect(items[0].refundedAmountCents).toBe(0);
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

describe("parseRefundSummary", () => {
  it("extracts item, tax, and total cents from a regular Amazon popover", () => {
    // Regular Amazon popovers use `inlineContent`. Encoded < (&lt;) and > (&gt;)
    // are decoded by JSON.parse during attribute read.
    const popoverJson = JSON.stringify({
      inlineContent:
        '<div class="a-row"><span>Item(s) refund</span><span>$59.95</span></div>' +
        '<div class="a-row"><span>Tax refund</span><span>$5.85</span></div>' +
        '<div class="a-row"><span class="a-text-bold">Refund Total</span><span>$65.80</span></div>',
    });
    document.body.innerHTML = `<span data-a-popover='${popoverJson.replace(/'/g, "&#39;")}'>Refund Total</span>`;
    expect(parseRefundSummary(document)).toEqual({
      itemCents: 5995,
      taxCents: 585,
      totalCents: 6580,
    });
  });

  it("extracts totals from a Whole Foods popover (no tax line)", () => {
    // WF popovers use `content` instead of `inlineContent`. No tax line on groceries.
    const popoverJson = JSON.stringify({
      content:
        '<div><span>Item(s) refund</span><span>$36.05</span></div>' +
        '<div><span class="a-text-bold">Refund Total</span><span>$36.05</span></div>',
    });
    document.body.innerHTML = `<span data-a-popover='${popoverJson.replace(/'/g, "&#39;")}'>Refund Total</span>`;
    expect(parseRefundSummary(document)).toEqual({
      itemCents: 3605,
      taxCents: 0,
      totalCents: 3605,
    });
  });

  it("returns null when no popover with Refund Total exists", () => {
    document.body.innerHTML = `<span data-a-popover='${JSON.stringify({ content: "<div>About bag fees</div>" })}'>Bag fees</span>`;
    expect(parseRefundSummary(document)).toBeNull();
  });

  it("returns null when the page has no popovers at all", () => {
    document.body.innerHTML = `<div>no popovers here</div>`;
    expect(parseRefundSummary(document)).toBeNull();
  });

  it("skips popovers with malformed JSON without throwing", () => {
    document.body.innerHTML = `
      <span data-a-popover='{not json Refund Total}'>broken</span>
      <span data-a-popover='${JSON.stringify({ content: "<div><span>Item(s) refund</span><span>$10.00</span></div><div><span>Refund Total</span><span>$10.00</span></div>" })}'>Refund</span>
    `;
    expect(parseRefundSummary(document)).toEqual({
      itemCents: 1000,
      taxCents: 0,
      totalCents: 1000,
    });
  });
});
