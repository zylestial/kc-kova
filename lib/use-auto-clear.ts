import { useEffect } from "react";

/**
 * Clears a success message after a while, so it doesn't sit on the page
 * long after the person has read it. Pass the state setter as `setValue`.
 */
export function useAutoClear(value: string, setValue: (value: string) => void, ms = 8000) {
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => setValue(""), ms);
    return () => clearTimeout(timer);
  }, [value, setValue, ms]);
}
