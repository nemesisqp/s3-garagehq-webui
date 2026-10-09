import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleXIcon,
  DownloadIcon,
  Folder,
  Loader2,
} from "lucide-react";
import { API_URL } from "@/lib/api";
import { cn, dayjs, readableBytes } from "@/lib/utils";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import Pagination from "@/components/ui/pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBucketContext } from "../context";
import { useBrowseContext } from "./browse-context";
import { keyName, objectPath, selectRange, splitExtension } from "./browse-utils";
import FileTypeIcon from "./file-type-icon";
import { useBrowseObjects } from "./hooks";
import { ObjectContextMenu, ObjectRowMenu } from "./object-menu";
import { MenuTarget } from "./use-object-menu-items";
import { usePathSort } from "./use-path-sort";

const PAGE_SIZE = 50;

type Props = {
  search: string;
  selected: string[];
  onSelectedChange: (keys: string[]) => void;
};

type Row = {
  key: string;
  isDir: boolean;
  size?: number;
  lastModified?: Date;
};

const ObjectList = ({ search, selected, onSelectedChange }: Props) => {
  const { bucketName } = useBucketContext();
  const browse = useBrowseContext();
  // S3 listing is cursor-based: cursors[i] is the token that loads page
  // i + 2, recorded as the user pages forward so Prev works.
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<string[]>([]);
  // Last checkbox clicked; shift-clicking another selects the rows between.
  const anchorRef = useRef<string | null>(null);
  const [flash, setFlash] = useState<{ id: number; keys: string[] }>({
    id: 0,
    keys: [],
  });

  const { sortOrder, toggleSort } = usePathSort(bucketName, browse.prefix);

  const { data, error, isLoading } = useBrowseObjects(bucketName, {
    prefix: browse.prefix,
    limit: PAGE_SIZE,
    ...(search ? { search } : {}),
    ...(page > 1 ? { next: cursors[page - 2] } : {}),
  });

  const rows: Row[] = useMemo(() => {
    const rawFolders: Row[] = (data?.prefixes || []).map((key) => ({ key, isDir: true }));
    const rawObjects: Row[] = (data?.objects || []).map((o) => ({
      key: (data?.prefix || "") + o.objectKey,
      isDir: false,
      size: o.size,
      lastModified: o.lastModified,
    }));

    if (sortOrder === "none") {
      return [...rawFolders, ...rawObjects];
    }

    const sortFn = (a: Row, b: Row) => {
      const nameA = keyName(a.key);
      const nameB = keyName(b.key);
      const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
      return sortOrder === "asc" ? cmp : -cmp;
    };

    const sortedFolders = [...rawFolders].sort(sortFn);
    const sortedObjects = [...rawObjects].sort(sortFn);

    return [...sortedFolders, ...sortedObjects];
  }, [data?.prefixes, data?.objects, data?.prefix, sortOrder]);
  const allKeys = useMemo(() => rows.map((r) => r.key), [rows]);

  // Reset pagination when search or prefix changes.
  useEffect(() => {
    setPage(1);
    setCursors([]);
    anchorRef.current = null;
  }, [search, browse.prefix]);

  // Step back if the current page was emptied (e.g. after a bulk delete).
  useEffect(() => {
    if (data && page > 1 && rows.length === 0) {
      setPage((p) => p - 1);
    }
  }, [data, page, rows.length]);

  // Prune any selected items that are no longer in the table (e.g. filtered by search or navigated away).
  useEffect(() => {
    if (!data) return;
    const allKeysSet = new Set(allKeys);
    const valid = selected.filter((k) => allKeysSet.has(k));
    if (valid.length !== selected.length) {
      onSelectedChange(valid);
    }
  }, [data, allKeys, selected, onSelectedChange]);

  const onPageChange = (value: number) => {
    if (value > page) {
      if (!data?.nextToken) return;
      const token = data.nextToken;
      setCursors((prev) => [...prev.slice(0, page - 1), token]);
    }
    setPage(value);
    anchorRef.current = null;
    onSelectedChange([]);
  };

  const selectedOnPage = allKeys.filter((k) => selected.includes(k)).length;
  const allSelected = allKeys.length > 0 && selectedOnPage === allKeys.length;

  const toggleAll = () => {
    anchorRef.current = null;
    onSelectedChange(allSelected ? [] : allKeys);
  };

  const onCheckboxClick = (key: string, e: React.MouseEvent) => {
    const checked = !selected.includes(key);
    const anchor = anchorRef.current;
    anchorRef.current = key;

    if (e.shiftKey && anchor && anchor !== key) {
      const res = selectRange(allKeys, selected, anchor, key, checked);
      onSelectedChange(res.selected);
      setFlash((f) => ({ id: f.id + 1, keys: res.changed }));
      return;
    }
    onSelectedChange(
      checked ? [...selected, key] : selected.filter((k) => k !== key)
    );
  };

  // Right-clicking a row that's part of a multi-selection acts on all of it.
  const menuTarget = (key: string): MenuTarget =>
    selected.length > 1 && selected.includes(key)
      ? { kind: "selection", keys: selected }
      : { kind: "entry", key };

  const firstItem = (page - 1) * PAGE_SIZE + 1;
  const range = rows.length
    ? `Items ${firstItem}–${firstItem + rows.length - 1}`
    : "No items";
  const summary = search ? `Results for "${search}" (recursive) · ${range}` : range;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {data?.truncated ? (
        <p className="shrink-0 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Results may be incomplete — narrow your search.
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_hsl(var(--border))] [&_tr]:border-0">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all"
                  className="align-middle"
                  checked={
                    allSelected
                      ? true
                      : selectedOnPage > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="p-0">
                <button
                  type="button"
                  onClick={toggleSort}
                  className="group flex h-10 w-full cursor-pointer items-center gap-1.5 px-3 text-left font-medium text-muted-foreground transition-colors hover:text-foreground select-none"
                  title={
                    sortOrder === "asc"
                      ? "Sorted ascending (A-Z). Click to sort descending."
                      : sortOrder === "desc"
                        ? "Sorted descending (Z-A). Click to reset."
                        : "Click to sort by name"
                  }
                >
                  <span>Name</span>
                  {sortOrder === "asc" ? (
                    <ArrowUp className="size-3.5 text-foreground" />
                  ) : sortOrder === "desc" ? (
                    <ArrowDown className="size-3.5 text-foreground" />
                  ) : (
                    <ArrowUpDown className="size-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                  )}
                </button>
              </TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Last Modified</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>

          <TableBody>
            {isLoading ? (
              <tr>
                <td colSpan={5}>
                  <div className="flex h-[320px] items-center justify-center">
                    <Loader2 size={28} className="animate-spin text-muted-foreground" />
                  </div>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={5} className="p-4">
                  <Alert variant="destructive">
                    <CircleXIcon />
                    <AlertDescription>{error.message}</AlertDescription>
                  </Alert>
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td className="py-16 text-center text-muted-foreground" colSpan={5}>
                  {search ? `No matches for "${search}"` : "No objects"}
                </td>
              </tr>
            ) : null}

            {rows.map((row) => {
              const name = keyName(row.key);
              const [base, ext] = row.isDir ? [name, ""] : splitExtension(name);
              const url = API_URL + objectPath(bucketName, row.key);
              const isSelected = selected.includes(row.key);
              const flashIndex = flash.keys.indexOf(row.key);

              const relKey = row.key.startsWith(browse.prefix)
                ? row.key.slice(browse.prefix.length)
                : row.key;
              const trimmedRel = row.isDir && relKey.endsWith("/") ? relKey.slice(0, -1) : relKey;
              const subDir = trimmedRel.includes("/")
                ? trimmedRel.slice(0, trimmedRel.lastIndexOf("/") + 1)
                : "";

              return (
                <ObjectContextMenu
                  // A new key restarts the highlight animation.
                  key={flashIndex >= 0 ? `${row.key}:${flash.id}` : row.key}
                  target={menuTarget(row.key)}
                >
                  <TableRow
                    data-state={isSelected ? "selected" : undefined}
                    data-active={browse.previewKey === row.key || undefined}
                    className={cn(
                      "group data-[active]:bg-accent data-[active]:shadow-[inset_2px_0_0_hsl(var(--primary))]",
                      flashIndex >= 0 && "animate-row-flash"
                    )}
                    style={
                      flashIndex >= 0
                        ? { animationDelay: `${flashIndex * 15}ms` }
                        : undefined
                    }
                  >
                    <td className="w-10 p-3">
                      <Checkbox
                        aria-label={`Select ${name}`}
                        className="align-middle"
                        checked={isSelected}
                        // Shift-click would otherwise select text across rows.
                        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                        onClick={(e) => onCheckboxClick(row.key, e)}
                      />
                    </td>
                    <td
                      className="cursor-pointer p-3"
                      role="button"
                      title={search && subDir ? row.key : undefined}
                      onClick={() =>
                        row.isDir
                          ? browse.openFolder(row.key)
                          : browse.openPreview(row.key)
                      }
                    >
                      <span className="flex w-full items-center font-normal">
                        {row.isDir ? (
                          <Folder size={20} className="mr-2 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileTypeIcon name={name} size={20} className="mr-2 shrink-0 text-muted-foreground" />
                        )}
                        <span className="max-w-[40vw] truncate">{base}</span>
                        {ext ? <span className="text-muted-foreground">{ext}</span> : null}
                        {search && subDir ? (
                          <span className="ml-2 max-w-[20vw] truncate text-xs text-muted-foreground/60">
                            in {subDir}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {row.isDir ? null : readableBytes(row.size)}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {row.lastModified ? dayjs(row.lastModified).fromNow() : null}
                    </td>
                    <td className="w-auto !p-0">
                      <span className="flex w-full flex-row justify-end gap-1 pr-2">
                        {!row.isDir ? (
                          <Button
                            icon={DownloadIcon}
                            variant="ghost"
                            size="icon"
                            aria-label={`Download ${name}`}
                            onClick={() => window.open(url + "?dl=1", "_blank")}
                          />
                        ) : null}
                        <ObjectRowMenu target={{ kind: "entry", key: row.key }} />
                      </span>
                    </td>
                  </TableRow>
                </ObjectContextMenu>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {data ? (
        <Pagination
          className="shrink-0 border-t px-3 py-2"
          page={page}
          hasNext={!!data.nextToken}
          onPageChange={onPageChange}
          summary={summary}
        />
      ) : null}
    </div>
  );
};

export default ObjectList;
