import { browser } from "wxt/browser";

/** Persisted cadence state for the donation ask. */
export interface CoffeeState {
  /** Lifetime line items committed to YNAB at approval (backfill excluded). */
  cumulativeItemized: number;
  /** The cumulative count at which the next ask fires; doubles after each show. */
  nextThreshold: number;
  /** Set once the user clicks the Ko-fi button — silences the post-approval ask. */
  retired: boolean;
}

const COFFEE_KEY = "coffeeState";
const FIRST_THRESHOLD = 250;

const DEFAULT_STATE: CoffeeState = {
  cumulativeItemized: 0,
  nextThreshold: FIRST_THRESHOLD,
  retired: false,
};

async function read(): Promise<CoffeeState> {
  const result = await browser.storage.local.get(COFFEE_KEY);
  return { ...DEFAULT_STATE, ...(result[COFFEE_KEY] as Partial<CoffeeState> | undefined) };
}

async function write(state: CoffeeState): Promise<void> {
  await browser.storage.local.set({ [COFFEE_KEY]: state });
}

/**
 * Record `count` line items committed at approval, then decide whether to show
 * the ask. Increment + threshold check happen atomically so the count in the
 * card copy is always fresh. Crossing the threshold doubles it (self-quieting).
 */
export async function recordItemized(
  count: number,
): Promise<{ showCoffee: boolean; cumulativeItemized: number }> {
  const state = await read();
  state.cumulativeItemized += count;
  let showCoffee = false;
  if (!state.retired && state.cumulativeItemized >= state.nextThreshold) {
    state.nextThreshold *= 2;
    showCoffee = true;
  }
  await write(state);
  return { showCoffee, cumulativeItemized: state.cumulativeItemized };
}

/** Soft-retire the post-approval ask (on Ko-fi click). Help hero is unaffected. */
export async function retireCoffee(): Promise<void> {
  const state = await read();
  state.retired = true;
  await write(state);
}
