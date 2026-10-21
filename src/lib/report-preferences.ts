"use client";

import { useSyncExternalStore } from "react";
import type { ReportGrouping } from "./domain-report";

const STORAGE_KEY = "domain-manager.report-grouping";
const CHANGE_EVENT = "domain-manager.report-grouping-change";
const EMPTY: ReportGrouping[] = [];
const DIMENSIONS: ReportGrouping[] = ["registrar", "buyerGroup", "buyer"];
let cachedRaw: string | null | undefined;
let cachedGroups = EMPTY;
let memoryOverride: string | undefined;

function getSnapshot() {
  let raw: string | null;
  try { raw = memoryOverride ?? window.localStorage.getItem(STORAGE_KEY); }
  catch { raw = memoryOverride ?? null; }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const value: unknown = JSON.parse(raw ?? "null");
      cachedGroups = Array.isArray(value) ? DIMENSIONS.filter(key => value.includes(key)) : EMPTY;
    } catch { cachedGroups = EMPTY; }
  }
  return cachedGroups;
}

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(CHANGE_EVENT, notify);
  };
}

function setGrouping(groups: ReportGrouping[]) {
  const raw = JSON.stringify(DIMENSIONS.filter(key => groups.includes(key)));
  try { window.localStorage.setItem(STORAGE_KEY, raw); memoryOverride = undefined; }
  catch { memoryOverride = raw; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useReportGrouping() {
  const grouping = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return [grouping, setGrouping] as const;
}
