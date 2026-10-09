import { beforeEach, describe, expect, it } from "vitest";
import {
  getNextSortOrder,
  getPathKey,
  loadSortMap,
  saveSortOrder,
  STORAGE_KEY,
} from "./use-path-sort";

const createMockStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

describe("use-path-sort helpers", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createMockStorage() as unknown as Storage;
  });

  describe("getPathKey", () => {
    it("generates bucket and prefix key", () => {
      expect(getPathKey("my-bucket", "")).toBe("my-bucket:");
      expect(getPathKey("my-bucket", "sub/folder/")).toBe("my-bucket:sub/folder/");
    });
  });

  describe("getNextSortOrder", () => {
    it("cycles none -> asc -> desc -> none", () => {
      expect(getNextSortOrder("none")).toBe("asc");
      expect(getNextSortOrder("asc")).toBe("desc");
      expect(getNextSortOrder("desc")).toBe("none");
    });
  });

  describe("persistence in localStorage", () => {
    it("defaults to empty map", () => {
      expect(loadSortMap()).toEqual({});
    });

    it("saves and loads sort settings independently per path", () => {
      saveSortOrder("bucket1", "photos/", "asc");
      saveSortOrder("bucket1", "docs/", "desc");
      saveSortOrder("bucket2", "", "asc");

      const map = loadSortMap();
      expect(map["bucket1:photos/"]).toBe("asc");
      expect(map["bucket1:docs/"]).toBe("desc");
      expect(map["bucket2:"]).toBe("asc");
      expect(map["bucket1:other/"]).toBeUndefined();
    });

    it("removes path from storage when set back to none", () => {
      saveSortOrder("bucket1", "photos/", "asc");
      expect(loadSortMap()["bucket1:photos/"]).toBe("asc");

      saveSortOrder("bucket1", "photos/", "none");
      expect(loadSortMap()["bucket1:photos/"]).toBeUndefined();
      expect(localStorage.getItem(STORAGE_KEY)).toBe("{}");
    });

    it("safely handles corrupted localStorage content", () => {
      localStorage.setItem(STORAGE_KEY, "invalid-json{{");
      expect(loadSortMap()).toEqual({});
    });
  });
});
