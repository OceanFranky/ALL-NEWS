import { useEffect, useMemo, useSyncExternalStore } from "react";
import { readRaw, writeRaw } from "@aihot/web/lib/local-state";

const key = "admission-saved-v1";
const changed = "admission-local-changed";
export const validId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(changed, listener); };
}
const snapshot = () => readRaw(key);
const serverSnapshot = () => null;
function decode(raw: string | null): string[] | null {
  try { const value: unknown = JSON.parse(raw ?? "[]"); return Array.isArray(value) && value.every(id => validId(id) || typeof id === "string" && /^demo-[1-4]$/.test(id)) ? [...new Set(value.filter(validId))] : null; }
  catch { return null; }
}
export function useStars() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    const ids = decode(raw);
    if (raw && ids && /"demo-[1-4]"/.test(raw) && writeRaw(key, JSON.stringify(ids))) {
      try {
        for (const storageKey of Object.keys(localStorage)) {
          if (/^admission-checklist-v1:demo-[1-4]:\d+$/.test(storageKey)) localStorage.removeItem(storageKey);
        }
      } catch { /* Saved notices remain usable when storage cleanup is blocked. */ }
      window.dispatchEvent(new Event(changed));
    }
  }, [raw]);
  return useMemo(() => ({ ids: decode(raw) ?? [], corrupt: decode(raw) === null }), [raw]);
}
export function toggleStar(id: string): boolean {
  if (!validId(id)) return false;
  const ids = decode(snapshot());
  if (!ids) return false;
  if (!ids.includes(id) && ids.length >= 100) return false;
  const next = ids.includes(id) ? ids.filter(value => value !== id) : [id, ...ids];
  if (!writeRaw(key, JSON.stringify(next))) return false;
  window.dispatchEvent(new Event(changed)); return true;
}
export function useChecklist(id: string, version: number) {
  const storageKey = `admission-checklist-v1:${id}:${version}`;
  const raw = useSyncExternalStore(subscribe, () => readRaw(storageKey), serverSnapshot);
  const checked = useMemo(() => {
    try { const data: unknown = JSON.parse(raw ?? "[]"); return Array.isArray(data) && data.every(item => typeof item === "string") ? data as string[] : []; }
    catch { return []; }
  }, [raw]);
  return { checked, toggle: (text: string) => {
    const next = checked.includes(text) ? checked.filter(item => item !== text) : [...checked, text];
    if (!writeRaw(storageKey, JSON.stringify(next))) return false;
    window.dispatchEvent(new Event(changed)); return true;
  } };
}
