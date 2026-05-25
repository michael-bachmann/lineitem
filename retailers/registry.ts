import type { RetailerAdapter } from "@/lib/types";
import { amazonAdapter } from "./amazon/adapter";

/** All registered retailer adapters. */
export const adapters: RetailerAdapter[] = [amazonAdapter];

/** Look up an adapter by id. Throws if not registered. */
export function getAdapter(id: string): RetailerAdapter {
  const adapter = adapters.find((a) => a.id === id);
  if (!adapter) throw new Error(`No adapter registered for retailer: ${id}`);
  return adapter;
}
