import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutosave<T>(
  value: T,
  serialize: (v: T) => string,
  save: (v: T) => Promise<void> | void,
  delayMs: number,
  baselineKey?: unknown,
): { status: AutosaveStatus; savedAt: string | null } {
  const lastSavedSignature = useRef<string>(serialize(value));
  const lastBaselineKey = useRef<unknown>(baselineKey);
  const timerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const nextSignature = serialize(value);

    if (baselineKey !== lastBaselineKey.current) {
      lastBaselineKey.current = baselineKey;
      lastSavedSignature.current = nextSignature;
      setStatus("idle");
      setSavedAt(null);
      return;
    }

    if (nextSignature === lastSavedSignature.current) {
      return;
    }

    setStatus("saving");
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await save(value);
          lastSavedSignature.current = nextSignature;
          setStatus("saved");
          setSavedAt(new Date().toISOString());
        } catch {
          setStatus("error");
        }
      })();
    }, delayMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [baselineKey, delayMs, save, serialize, value]);

  return { status, savedAt };
}
