import { useCallback, useEffect, useState } from "react";

export type NameSortOrder = "none" | "asc" | "desc";

export const STORAGE_KEY = "garage_browse_path_sort";

export const getPathKey = (bucket: string, prefix: string) => `${bucket}:${prefix}`;

export const getNextSortOrder = (current: NameSortOrder): NameSortOrder => {
  if (current === "none") return "asc";
  if (current === "asc") return "desc";
  return "none";
};

const getStorage = () => {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // Ignore security/sandbox errors
  }
  return null;
};

export const loadSortMap = (): Record<string, NameSortOrder> => {
  try {
    const storage = getStorage();
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

export const saveSortOrder = (
  bucket: string,
  prefix: string,
  order: NameSortOrder
) => {
  try {
    const storage = getStorage();
    if (!storage) return;
    const map = loadSortMap();
    const key = getPathKey(bucket, prefix);
    if (order === "none") {
      delete map[key];
    } else {
      map[key] = order;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage access may fail in private mode; ignore
  }
};

/** Manages persistent sort-by-name order per path (bucket + prefix). Defaults to "none" (not sorted). */
export const usePathSort = (bucket: string, prefix: string) => {
  const [sortOrder, setSortOrder] = useState<NameSortOrder>(() => {
    const map = loadSortMap();
    return map[getPathKey(bucket, prefix)] || "none";
  });

  // When bucket or prefix changes, load that path's specific sort setting (defaults to "none")
  useEffect(() => {
    const map = loadSortMap();
    const saved = map[getPathKey(bucket, prefix)] || "none";
    setSortOrder(saved);
  }, [bucket, prefix]);

  const toggleSort = useCallback(() => {
    setSortOrder((current) => {
      const next = getNextSortOrder(current);
      saveSortOrder(bucket, prefix, next);
      return next;
    });
  }, [bucket, prefix]);

  const setExplicitSort = useCallback(
    (order: NameSortOrder) => {
      setSortOrder(order);
      saveSortOrder(bucket, prefix, order);
    },
    [bucket, prefix]
  );

  return { sortOrder, toggleSort, setExplicitSort };
};
