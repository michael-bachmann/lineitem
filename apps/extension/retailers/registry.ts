import type { RetailerAdapter } from "@/lib/types";
import { amazonAdapter } from "./amazon/adapter";
import { targetAdapter } from "./target/adapter";

/** All registered retailer adapters. */
export const adapters: RetailerAdapter[] = [amazonAdapter, targetAdapter];

/** Look up an adapter by id. Throws if not registered. */
export function getAdapter(id: string): RetailerAdapter {
  const adapter = adapters.find((a) => a.id === id);
  if (!adapter) throw new Error(`No adapter registered for retailer: ${id}`);
  return adapter;
}
