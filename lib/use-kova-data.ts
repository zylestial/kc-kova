import { useSyncExternalStore } from "react";
import { getEmptyKovaData, getKovaData, subscribeKovaData, type BootstrapData } from "@/lib/kova-api";

/**
 * The signed-in account's loaded data (lib/kova-api.ts's cache), re-rendering
 * the component whenever it's reloaded: after a save, a refresh, or a
 * notification poll. Read what you need from the result; don't copy it into
 * state.
 */
export function useKovaData(): BootstrapData {
  return useSyncExternalStore(subscribeKovaData, getKovaData, getEmptyKovaData);
}
