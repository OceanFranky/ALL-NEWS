import { useMemo, useSyncExternalStore } from "react";
import { readRaw, writeRaw } from "@aihot/web/lib/local-state";

const key = "competition-starred-editions-v1";
const eventName = "competition-stars-changed";
export interface SavedCompetition { competitionId: string; editionId: string }
const snapshot = () => readRaw(key);
const serverSnapshot = () => null;
function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) listener(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(eventName, listener);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(eventName, listener); };
}
function decode(value: string | null): SavedCompetition[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedCompetition => entry && typeof entry === "object" && /^competition-\d{3}$/.test(entry.competitionId) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.editionId));
  } catch { return []; }
}
export function useCompetitionStars() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return useMemo(() => decode(raw), [raw]);
}
export function toggleCompetitionStar(item: SavedCompetition): boolean {
  const saved = decode(snapshot());
  const found = saved.some(entry => entry.competitionId === item.competitionId && entry.editionId === item.editionId);
  const next = found ? saved.filter(entry => entry.competitionId !== item.competitionId || entry.editionId !== item.editionId) : [{ competitionId: item.competitionId, editionId: item.editionId }, ...saved];
  if (!writeRaw(key, JSON.stringify(next))) return false;
  window.dispatchEvent(new Event(eventName));
  return true;
}
