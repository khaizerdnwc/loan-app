"use client";

import type { FeatureFlag, FeatureStateView } from "@loan/core";
import { createContext, useContext } from "react";

/**
 * Which modules the bank has switched on (GET /features), provided by the app shell. The API
 * enforces the flags; screens only mirror them.
 */
export const FeaturesContext = createContext<FeatureStateView | null>(null);

/** A module's state: true or false once known, undefined while it is loading. */
export function useFeature(flag: FeatureFlag): boolean | undefined {
  const state = useContext(FeaturesContext);
  return state ? state[flag] : undefined;
}
