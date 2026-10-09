import { useCallback, useEffect, useRef } from "react";

export type DebouncedFunction<T extends (...args: any[]) => void> = T & {
  cancel: () => void;
};

export const useDebounce = <T extends (...args: any[]) => void>(
  fn: T,
  delay: number = 500
): DebouncedFunction<T> => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cancel;
  }, [cancel]);

  const debouncedFn = useCallback(
    (...args: Parameters<T>) => {
      cancel();
      timerRef.current = setTimeout(() => {
        fnRef.current(...args);
      }, delay);
    },
    [delay, cancel]
  );

  (debouncedFn as unknown as DebouncedFunction<T>).cancel = cancel;

  return debouncedFn as DebouncedFunction<T>;
};
