import api, { APIError } from "@/lib/api";
import {
  useMutation,
  UseMutationOptions,
  useQuery,
} from "@tanstack/react-query";
import {
  GetObjectsResult,
  ObjectInfo,
  PresignResult,
  PutObjectPayload,
  UseBrowserObjectOptions,
} from "./types";
import { objectPath, TEXT_PREVIEW_BYTES } from "./browse-utils";

export const useBrowseObjects = (
  bucket: string,
  options?: UseBrowserObjectOptions
) => {
  return useQuery({
    queryKey: ["browse", bucket, options],
    queryFn: () =>
      api.get<GetObjectsResult>(`/browse/${bucket}`, { params: options }),
  });
};

export const usePutObject = (
  bucket: string,
  options?: UseMutationOptions<any, Error, PutObjectPayload>
) => {
  return useMutation({
    // The object is sent as the raw request body (folders have none).
    mutationFn: (body) =>
      api.put(objectPath(bucket, body.key), { body: body.file ?? undefined }),
    ...options,
  });
};

export const useDeleteObject = (
  bucket: string,
  options?: UseMutationOptions<any, Error, { key: string; recursive?: boolean }>
) => {
  return useMutation({
    mutationFn: (data) =>
      api.delete(objectPath(bucket, data.key), {
        params: { recursive: data.recursive },
      }),
    ...options,
  });
};

export const useDeleteObjects = (
  bucket: string,
  options?: UseMutationOptions<any, Error, string[]>
) => {
  return useMutation({
    mutationFn: (keys) =>
      Promise.all(
        keys.map((key) =>
          api.delete(objectPath(bucket, key), {
            params: { recursive: key.endsWith("/") },
          })
        )
      ),
    ...options,
  });
};

export const useMoveObjects = (
  bucket: string,
  options?: UseMutationOptions<
    { moved: number },
    Error,
    { items: string[]; destination: string }
  >
) => {
  return useMutation({
    mutationFn: (body) => api.post(`/browse/${bucket}`, { body }),
    ...options,
  });
};

export const useRenameObject = (
  bucket: string,
  options?: UseMutationOptions<
    { key: string; moved: number },
    APIError,
    { key: string; name: string }
  >
) => {
  return useMutation({
    mutationFn: ({ key, name }) =>
      api.patch<{ key: string; moved: number }>(objectPath(bucket, key), {
        body: { name },
      }),
    ...options,
  });
};

export const useObjectInfo = (bucket: string, key: string | null) => {
  return useQuery<ObjectInfo, APIError>({
    queryKey: ["browse", bucket, "info", key],
    queryFn: () => api.get<ObjectInfo>(objectPath(bucket, key!)),
    enabled: !!key,
    retry: false,
  });
};

export type TextPreviewResult = {
  text: string;
  truncated: boolean;
};

/** Reads at most TEXT_PREVIEW_BYTES (100 KB) of a text file, safely aborting large responses to avoid crashing the browser. */
export const useTextPreview = (url: string | null, etag?: string) => {
  return useQuery<TextPreviewResult>({
    queryKey: ["text-preview", url, etag],
    enabled: !!url,
    retry: false,
    queryFn: async () => {
      const res = await fetch(url!, {
        credentials: "include",
        headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` },
      });

      // 416 means Range not satisfiable (e.g. empty file 0 bytes)
      if (res.status === 416) {
        return { text: "", truncated: false };
      }

      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Read at most TEXT_PREVIEW_BYTES via stream reader so even if server ignores Range,
      // we never buffer more than 100 KB into memory.
      const reader = res.body?.getReader();
      if (!reader) {
        const full = await res.text();
        return {
          text: full.slice(0, TEXT_PREVIEW_BYTES),
          truncated: full.length > TEXT_PREVIEW_BYTES,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let truncated = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            if (totalBytes + value.byteLength >= TEXT_PREVIEW_BYTES) {
              const needed = TEXT_PREVIEW_BYTES - totalBytes;
              if (needed > 0) {
                chunks.push(value.slice(0, needed));
                totalBytes += needed;
              }
              truncated = true;
              await reader.cancel();
              break;
            } else {
              chunks.push(value);
              totalBytes += value.byteLength;
            }
          }
        }
      } catch {
        // stream cancel may throw in some environments, ignore
      }

      const contentRange = res.headers.get("Content-Range");
      if (contentRange) {
        const total = contentRange.split("/")[1];
        if (total && total !== "*" && Number(total) > totalBytes) {
          truncated = true;
        }
      }

      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
      return { text, truncated };
    },
  });
};

export const usePresignObjects = (
  bucket: string,
  options?: UseMutationOptions<
    PresignResult,
    Error,
    {
      keys: string[];
      accessKeyId?: string;
      expiresIn?: number;
      endpoint?: string;
    }
  >
) => {
  return useMutation({
    mutationFn: (body) =>
      api.post<PresignResult>(`/browse/${bucket}/presign`, { body }),
    ...options,
  });
};
