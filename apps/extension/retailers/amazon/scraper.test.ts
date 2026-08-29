// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import {
  isGroceryOrder,
  parseItemmodFromDocument,
  parseItemsFromDocument,
  extractItemsSubtotal,
  parseRefundSummary,
} from "./scraper";
import { verifyScrape } from "@/lib/verify-scrape";

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

  it("skips a fully out-of-stock item (credit cancels the line total)", () => {
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
                  <div class="a-column a-span8">
                    <span class="a-size-small a-text-bold">Out of stock (2)</span>
                  </div>
                  <div class="a-column a-span3 ufpo-item-status-price a-span-last">
                    <span class="a-size-small a-text-bold">-$15.78</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([]);
  });

  it("skips an out-of-stock item whose credit sits outside the price span", () => {
    // Markup as originally captured, with the credit in a bare bold span rather
    // than a .ufpo-item-status-price column. The credit can't be read, so how
    // much of the line survived is unknowable — drop it rather than bank a
    // price that would overshoot Item(s) Subtotal and fail the whole order.
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

  it("keeps an out-of-stock credit and a refund on the same row apart", () => {
    // 3 ordered: one never supplied (credited, never charged) and one refunded
    // after the fact. The credit nets off the line; the refund has to survive as
    // refundedAmountCents or the refund charge can't be matched to it.
    document.body.innerHTML = `
      <div id="B0AAA00001-item-grid-row" role="row">
        <a href="/gp/product/B0AAA00001?ref_=x"><span>Three Pack Thing</span></a>
        <span id="B0AAA00001-item-total-price"> $20.97 </span>
        <div class="a-box ufpo-item-status">
          <div class="a-row">
            <span class="a-size-small a-text-bold">Out of stock (1)</span>
            <span class="ufpo-item-status-price">-$6.99</span>
          </div>
        </div>
        <div class="a-box ufpo-item-status">
          <div class="a-row">
            <span class="a-size-small a-text-bold">Refunded (1)</span>
            <span class="ufpo-item-status-price">-$6.99</span>
          </div>
        </div>
      </div>
    `;
    const items = parseItemmodFromDocument(document);
    expect(items).toHaveLength(1);
    expect(items[0]!.priceCents).toBe(1398);
    expect(items[0]!.refundedAmountCents).toBe(699);
  });

  it("does not read a status out of a product title that happens to name one", () => {
    // "Out of stock" in the title, a real refund marker in the only status box.
    // Classifying by row text would net the refund off the line and lose it.
    document.body.innerHTML = `
      <div id="B0BOOK0001-item-grid-row" role="row">
        <a href="/gp/product/B0BOOK0001?ref_=x"><span>Out of Stock: A Novel</span></a>
        <span id="B0BOOK0001-item-total-price"> $20.00 </span>
        <div class="a-box ufpo-item-status">
          <div class="a-row">
            <span class="a-size-small a-text-bold">Refunded (1)</span>
            <span class="ufpo-item-status-price">-$20.00</span>
          </div>
        </div>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([
      {
        productId: "B0BOOK0001",
        title: "Out of Stock: A Novel",
        priceCents: 2000,
        quantity: 1,
        imageUrl: "",
        refundedAmountCents: 2000,
      },
    ]);
  });

  it("keeps a PARTIALLY out-of-stock item at the price actually charged", () => {
    // Real Whole Foods row (order 111-5630462-3529869): 2 ordered at $6.99 each,
    // one unavailable. Amazon credited $6.99 and charged for the other, so
    // Item(s) Subtotal counts $6.99 — dropping the whole row left the scrape
    // $6.99 short and failed verify as "Couldn't read order".
    document.body.innerHTML = `
      <div id="B01MQD4ZZM-item-grid-row" role="row">
        <div class="a-column a-span1"><img src="https://example.com/rice.jpg" /></div>
        <div class="a-column a-span11 a-span-last">
          <div class="a-row">
            <div class="a-column a-span6">
              <a class="a-link-normal a-text-normal" href="/gp/product/B01MQD4ZZM?ref_=uff_od_product">
                <span> Grain Trust, Rice Thai Jasmine Organic, 30 Ounce </span>
              </a>
            </div>
            <div class="a-column a-span1 a-text-center">2</div>
            <div class="a-column a-span2 a-text-left a-span-last">
              <span id="B01MQD4ZZM-item-total-price"> $13.98 </span>
            </div>
          </div>
          <div class="a-row">
            <div class="a-column a-span4 ufpo-item-status-column a-span-last">
              <div class="a-box ufpo-item-status"><div class="a-box-inner">
                <div class="a-row">
                  <div class="a-column a-span8">
                    <span class="a-size-small a-text-bold"> Out of stock (1) </span>
                  </div>
                  <div class="a-column a-span3 a-text-left ufpo-item-status-price a-span-last">
                    <span class="a-size-small a-text-bold"> -$6.99 </span>
                  </div>
                </div>
              </div></div>
            </div>
          </div>
        </div>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([
      {
        productId: "B01MQD4ZZM",
        title: "Grain Trust, Rice Thai Jasmine Organic, 30 Ounce",
        priceCents: 699,
        quantity: 1,
        imageUrl: "https://example.com/rice.jpg",
        // An out-of-stock credit is not a refund: the customer was never
        // charged for the missing unit, so it must not look refundable to
        // distribution (which excludes refund-marked items from purchases).
        refundedAmountCents: 0,
      },
    ]);
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
    expect(items[0]!.refundedAmountCents).toBe(0);
  });

  it("parses a substituted item as the delivered replacement, not the out-of-stock original", () => {
    // Real Amazon Fresh substitution (captured from a live grocery order): the
    // delivered substitute carries the only product link + line total; the
    // original it replaced is shown as plain text (no link, no price) inside a
    // "Replacement for:" status box, so the parser must pick the substitute and
    // ignore the original — and must NOT skip the row (it isn't "out of stock").
    document.body.innerHTML = `
      <div id="B00E3JM7UU-item-grid-row" role="row">
        <img alt="Organic Blackberries, 6 oz" src="https://example.com/blackberries.jpg" />
        <a class="a-link-normal" href="/gp/product/B00E3JM7UU?ref_=uff_od_product">
          <span> Organic Blackberries, 6 oz </span>
        </a>
        <span id="B00E3JM7UU-item-priced-by-quantity"> </span>
        <span id="B00E3JM7UU-item-total-price"> $5.49 </span>
        <div class="a-box ufpo-item-status">
          <div class="a-row"><span class="a-size-small a-text-bold">Replacement for:</span></div>
          <div class="a-row"><span class="a-size-small">Berry Blueberry Organic, 1 Pint</span></div>
          <div class="a-row"><span class="a-size-small">Qty: 1</span></div>
        </div>
      </div>
    `;
    expect(parseItemmodFromDocument(document)).toEqual([
      {
        productId: "B00E3JM7UU",
        title: "Organic Blackberries, 6 oz",
        priceCents: 549,
        quantity: 1,
        imageUrl: "https://example.com/blackberries.jpg",
        refundedAmountCents: 0,
      },
    ]);
  });

  it("reconciles a partially out-of-stock order against Item(s) Subtotal", () => {
    // The failure this guards is only visible end-to-end: each row parses fine
    // on its own, but a dropped partial out-of-stock line leaves the scrape
    // short of Amazon's subtotal, and verifyScrape then errors every charge on
    // the order.
    document.body.innerHTML = `
      <div id="B0YOGURT00-item-grid-row" role="row">
        <a href="/gp/product/B0YOGURT00?ref_=x"><span>Greek Yogurt</span></a>
        <span id="B0YOGURT00-item-total-price">$6.99</span>
      </div>
      <div id="B01MQD4ZZM-item-grid-row" role="row">
        <a href="/gp/product/B01MQD4ZZM?ref_=x"><span>Jasmine Rice</span></a>
        <span id="B01MQD4ZZM-item-total-price">$13.98</span>
        <div class="a-box ufpo-item-status">
          <div class="a-row">
            <span class="a-size-small a-text-bold">Out of stock (1)</span>
            <span class="ufpo-item-status-price"><span>-$6.99</span></span>
          </div>
        </div>
      </div>
    `;
    const items = parseItemmodFromDocument(document);
    const order = {
      retailer: "amazon",
      orderId: "111-5630462-3529869",
      items: items.map((i) => ({
        productId: i.productId,
        title: i.title,
        imageUrl: i.imageUrl,
        unitPriceCents: i.priceCents,
        quantity: i.quantity,
        refundedAmountCents: i.refundedAmountCents,
      })),
      // $6.99 delivered + $6.99 kept from the partially-filled line.
      displayedItemsSubtotalCents: 1398,
      refund: null,
    };
    expect(verifyScrape(order)).toEqual({ ok: true });
  });
});

describe("parseItemsFromDocument refund detection", () => {
  it("marks items in a 'Refunded' shipment as refunded at full line total", () => {
    document.body.innerHTML = `
      <div data-component="shipmentsLeftGrid">
        <div data-component="shipmentStatus">
          <h4 class="od-status-message"><span>Refunded</span></h4>
        </div>
        <div data-component="purchasedItems">
          <div class="a-fixed-left-grid-inner">
            <img src="https://example.com/slide.jpg" />
            <a href="/dp/B00C1ZTNNM?ref_=x">OOFOS Recovery Slide</a>
            <span class="a-color-price">$59.95</span>
          </div>
        </div>
      </div>
    `;
    const items = parseItemsFromDocument(document);
    expect(items).toEqual([
      {
        productId: "B00C1ZTNNM",
        title: "OOFOS Recovery Slide",
        priceCents: 5995,
        quantity: 1,
        imageUrl: "https://example.com/slide.jpg",
        refundedAmountCents: 5995,
      },
    ]);
  });

  it("leaves refundedAmountCents at 0 for items in a 'Delivered' shipment", () => {
    document.body.innerHTML = `
      <div data-component="shipmentsLeftGrid">
        <div data-component="shipmentStatus">
          <h4 class="od-status-message">
            <span class="a-text-bold">Delivered </span><span>May 13</span>
          </h4>
        </div>
        <div data-component="purchasedItems">
          <div class="a-fixed-left-grid-inner">
            <img src="https://example.com/book.jpg" />
            <a href="/dp/1680524402?ref_=x">Mommy and Me Board Book</a>
            <span class="a-color-price">$12.99</span>
          </div>
        </div>
      </div>
    `;
    const items = parseItemsFromDocument(document);
    expect(items).toHaveLength(1);
    expect(items[0]!.refundedAmountCents).toBe(0);
  });

  it("does not mark items as refunded when no shipment ancestor exists", () => {
    document.body.innerHTML = `
      <div class="a-fixed-left-grid-inner">
        <img src="https://example.com/x.jpg" />
        <a href="/dp/B0000XXXXX?ref_=x">Standalone item</a>
        <span class="a-color-price">$10.00</span>
      </div>
    `;
    const items = parseItemsFromDocument(document);
    expect(items).toHaveLength(1);
    expect(items[0]!.refundedAmountCents).toBe(0);
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
