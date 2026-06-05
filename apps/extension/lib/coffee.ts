import { browser } from "wxt/browser";

/** Persisted cadence state for the donation ask. */
export interface CoffeeState {
  /** Lifetime classified line items committed to YNAB at approval (backfill excluded). */
  cumulativeClassified: number;
  /** The cumulative count at which the next ask fires; doubles after each show. */
  nextThreshold: number;
  /** Set once the user clicks the Ko-fi button — silences the post-approval ask. */
  retired: boolean;
}

const COFFEE_KEY = "coffeeState";
const FIRST_THRESHOLD = 250;

const DEFAULT_STATE: CoffeeState = {
  cumulativeClassified: 0,
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
export async function recordClassified(
  count: number,
): Promise<{ showCoffee: boolean; cumulativeClassified: number }> {
  const state = await read();
  const cumulativeClassified = state.cumulativeClassified + count;
  const showCoffee = !state.retired && cumulativeClassified >= state.nextThreshold;
  await write({
    ...state,
    cumulativeClassified,
    nextThreshold: showCoffee ? state.nextThreshold * 2 : state.nextThreshold,
  });
  return { showCoffee, cumulativeClassified };
}

/** Soft-retire the post-approval ask (on Ko-fi click). Help hero is unaffected. */
export async function retireCoffee(): Promise<void> {
  const state = await read();
  await write({ ...state, retired: true });
}
