import { useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileImage,
  Loader2,
  Maximize2,
  MousePointerClick,
  PanelRightClose,
  PencilLine,
  PictureInPicture2,
  Share2,
  Trash,
  X,
} from "lucide-react";
import Button from "@/components/ui/button";
import { API_URL } from "@/lib/api";
import { cn, dayjs, readableBytes } from "@/lib/utils";
import { useBucketContext } from "../context";
import { useBrowseContext } from "./browse-context";
import {
  IMAGE_PREVIEW_MAX_SIZE,
  keyName,
  objectPath,
  PreviewKind,
  previewKind,
  TEXT_PREVIEW_BYTES,
} from "./browse-utils";
import FileTypeIcon from "./file-type-icon";
import { useObjectInfo, useTextPreview } from "./hooks";
import { shareDialog } from "./share-dialog";

type Props = {
  /** File shown in the pane; null shows the empty state. */
  objectKey: string | null;
  /** Floating overlay (narrow screens) instead of a docked column. */
  floating: boolean;
  onClose: () => void;
};

const PreviewPane = ({ objectKey, floating, onClose }: Props) => {
  const { bucketName } = useBucketContext();
  const browse = useBrowseContext();
  const info = useObjectInfo(bucketName, objectKey);

  const name = objectKey ? keyName(objectKey) : "";
  const url = objectKey ? API_URL + objectPath(bucketName, objectKey) : "";
  const size = info.data?.ContentLength;
  // Object responses are cached for a day, so key the view URL on the ETag:
  // a file that was overwritten gets a fresh URL instead of the old copy.
  const etag = info.data?.ETag?.replace(/"/g, "");
  const viewUrl = url + "?view=1" + (etag ? `&v=${encodeURIComponent(etag)}` : "");
  const kind = previewKind(name, info.data?.ContentType);

  return (
    <aside
      aria-label="File details"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground",
        floating
          ? "absolute inset-y-0 right-0 z-30 w-[min(380px,100%)] shadow-2xl animate-in slide-in-from-right-8"
          : "w-[380px] shrink-0"
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>
          {objectKey ? name : "Details"}
        </p>
        <div className="flex items-center gap-1">
          {objectKey ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              icon={ExternalLink}
              title="Open in new tab"
              aria-label="Open in new tab"
              onClick={() => window.open(viewUrl, "_blank")}
            />
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            icon={floating ? X : PanelRightClose}
            aria-label={floating ? "Close details" : "Hide details"}
            title={floating ? "Close" : "Hide details"}
            onClick={onClose}
          />
        </div>
      </header>

      {!objectKey ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <MousePointerClick size={28} />
          Select a file to see its preview and details.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className={cn(
              "flex items-center justify-center border-b bg-muted/30 p-3",
              kind === "video" ? "min-h-56 max-h-[380px] p-2" : "h-64"
            )}
          >
            {info.isLoading ? (
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            ) : (
              <PreviewContent
                kind={info.error ? "none" : kind}
                url={viewUrl}
                name={name}
                size={size}
                etag={info.data?.ETag}
              />
            )}
          </div>

          {info.error ? (
            <p className="p-4 text-sm text-destructive">
              {info.error.status === 404
                ? "This file no longer exists."
                : info.error.message}
            </p>
          ) : info.data ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm">
              <Detail label="Size">
                {size != null
                  ? `${readableBytes(size)} (${size.toLocaleString()} bytes)`
                  : "—"}
              </Detail>
              <Detail label="Type">{info.data.ContentType || "Unknown"}</Detail>
              <Detail label="Modified">
                {info.data.LastModified
                  ? `${dayjs(info.data.LastModified).format("YYYY-MM-DD HH:mm")} (${dayjs(info.data.LastModified).fromNow()})`
                  : "—"}
              </Detail>
              <Detail label="Path">{objectKey}</Detail>
              <Detail label="ETag">
                {etag || "—"}
              </Detail>
            </dl>
          ) : null}

          <div className="grid grid-cols-2 gap-2 border-t p-4">
            <Button
              variant="outline"
              size="sm"
              icon={Download}
              onClick={() => window.open(url + "?dl=1", "_blank")}
            >
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={ExternalLink}
              onClick={() => window.open(viewUrl, "_blank")}
            >
              Open in new tab
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={Share2}
              onClick={() => shareDialog.open({ keys: [objectKey] })}
            >
              Share
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={PencilLine}
              onClick={() => browse.openRename(objectKey)}
            >
              Rename
            </Button>
            <Button
              variant="destructive"
              size="sm"
              icon={Trash}
              className="col-span-2"
              onClick={() => browse.deleteKeys([objectKey])}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
};

const Detail = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-all">{children}</dd>
  </>
);

type PreviewContentProps = {
  kind: PreviewKind;
  url: string;
  name: string;
  size?: number | null;
  etag?: string;
};

const PreviewContent = ({ kind, url, name, size, etag }: PreviewContentProps) => {
  const [failed, setFailed] = useState(false);
  const [forceLoadImage, setForceLoadImage] = useState(false);
  const text = useTextPreview(kind === "text" ? url : null, etag);

  useEffect(() => {
    setFailed(false);
    setForceLoadImage(false);
  }, [url]);

  const icon = (
    <FileTypeIcon name={name} size={72} strokeWidth={1.25} className="text-muted-foreground" />
  );
  if (failed || kind === "none") return icon;

  switch (kind) {
    case "image":
      if (size != null && size >= IMAGE_PREVIEW_MAX_SIZE && !forceLoadImage) {
        return (
          <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
            <FileImage size={56} strokeWidth={1.25} className="text-muted-foreground/80" />
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-foreground">
                Image is larger than 3 MB
              </p>
              <p className="text-[11px] text-muted-foreground">
                {readableBytes(size)} · Preview skipped to save memory
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setForceLoadImage(true)}
              >
                Load preview
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                icon={ExternalLink}
                onClick={() => window.open(url, "_blank")}
              >
                Open in tab
              </Button>
            </div>
          </div>
        );
      }
      return (
        <img
          src={url}
          alt={name}
          className="max-h-full max-w-full object-contain"
          onError={() => setFailed(true)}
        />
      );
    case "video":
      return <VideoPreview url={url} name={name} onFailed={() => setFailed(true)} />;
    case "audio":
      return (
        <audio
          src={url}
          controls
          className="w-full rounded-full dark:[filter:invert(1)_hue-rotate(180deg)]"
          onError={() => setFailed(true)}
        />
      );
    case "pdf":
      return <iframe src={url} title={name} className="h-full w-full rounded border bg-white" />;
    case "text":
      if (text.isLoading) {
        return <Loader2 size={24} className="animate-spin text-muted-foreground" />;
      }
      if (text.error) return icon;
      return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded border bg-background">
          {text.data?.truncated ? (
            <div className="flex shrink-0 items-center justify-between border-b bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground">
              <span>Showing first {readableBytes(TEXT_PREVIEW_BYTES)} preview</span>
              <span className="font-mono text-[10px]">truncated</span>
            </div>
          ) : null}
          <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs select-text">
            {text.data?.text}
          </pre>
        </div>
      );
  }
};

const VideoPreview = ({
  url,
  name,
  onFailed,
}: {
  url: string;
  name: string;
  onFailed: () => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      videoRef.current.requestFullscreen().catch(() => {});
    }
  };

  const togglePip = () => {
    if (!videoRef.current) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else if (document.pictureInPictureEnabled) {
      videoRef.current.requestPictureInPicture().catch(() => {});
    }
  };

  return (
    <div className="group relative flex w-full max-h-full items-center justify-center overflow-hidden rounded-md bg-black">
      <video
        ref={videoRef}
        src={url}
        title={name}
        aria-label={name}
        controls
        playsInline
        preload="metadata"
        className="max-h-[350px] w-full object-contain"
        onError={onFailed}
      />
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-black/70 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
        {"pictureInPictureEnabled" in document && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/90 hover:bg-white/20 hover:text-white"
            icon={PictureInPicture2}
            title="Picture in Picture"
            onClick={togglePip}
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white/90 hover:bg-white/20 hover:text-white"
          icon={Maximize2}
          title="Fullscreen"
          onClick={toggleFullscreen}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white/90 hover:bg-white/20 hover:text-white"
          icon={ExternalLink}
          title="Open in new tab"
          onClick={() => window.open(url, "_blank")}
        />
      </div>
    </div>
  );
};

export default PreviewPane;
