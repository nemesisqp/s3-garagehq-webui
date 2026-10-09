import { createDisclosure } from "@/lib/disclosure";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBucketContext } from "../context";
import { useConfig } from "@/hooks/useConfig";
import { useEffect, useMemo, useState } from "react";
import Input from "@/components/ui/input";
import Button from "@/components/ui/button";
import Select from "@/components/ui/select";
import {
  Copy,
  FileWarningIcon,
  Globe,
  Key as KeyIcon,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { cn, copyToClipboard } from "@/lib/utils";
import { usePresignObjects } from "./hooks";

// keys are full object keys (prefix included).
export const shareDialog = createDisclosure<{ keys: string[] }>();

type Option<T = string> = { label: string; value: T };

const expirationOptions: Option<number>[] = [
  { label: "15 minutes", value: 900 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
];

const ShareDialog = () => {
  const { isOpen, data } = shareDialog.use();
  const { bucket, bucketName } = useBucketContext();
  const { data: config } = useConfig();

  const [mode, setMode] = useState<"presigned" | "alias">("presigned");
  const defaultProtocol =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "https://"
      : "http://";
  const [aliasProtocol, setAliasProtocol] = useState<string>(defaultProtocol);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [expiresIn, setExpiresIn] = useState<number>(3600);
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [presignedUrls, setPresignedUrls] = useState<string[]>([]);
  const [presignError, setPresignError] = useState<string | null>(null);

  const keys = useMemo(() => data?.keys || [], [data?.keys]);

  // Keys with read permissions available for signing
  const readKeys = useMemo(
    () => bucket?.keys?.filter((k) => k.permissions?.read) || [],
    [bucket?.keys]
  );

  const keyOptions = useMemo(
    () =>
      readKeys.map((k) => ({
        label: `${k.name || "Key"} (${k.accessKeyId})`,
        value: k.accessKeyId,
      })),
    [readKeys]
  );

  // Auto-select first key with read permissions
  useEffect(() => {
    if (readKeys.length > 0) {
      if (!selectedKeyId || !readKeys.some((k) => k.accessKeyId === selectedKeyId)) {
        setSelectedKeyId(readKeys[0].accessKeyId);
      }
    } else {
      setSelectedKeyId("");
    }
  }, [readKeys, selectedKeyId]);

  // Priority for S3 endpoint:
  // 1. s3_api.advertise_endpoint from garage.toml
  // 2. s3_api.root_domain from garage.toml (defaulting to https://)
  // 3. Fallback to current config.s3_endpoint
  const s3Endpoint = useMemo(() => {
    const adv = config?.s3_api?.advertise_endpoint?.trim();
    if (adv) {
      if (!adv.startsWith("http://") && !adv.startsWith("https://")) {
        return `https://${adv}`;
      }
      return adv.replace(/\/+$/, "");
    }

    const root = config?.s3_api?.root_domain?.trim();
    if (root) {
      const domain = root.replace(/^\.+/, "");
      return `https://${domain}`;
    }

    return config?.s3_endpoint || "";
  }, [config?.s3_api, config?.s3_endpoint]);

  // Only aliases that are domains (from bucket.globalAliases, no ports, no s3_web.root_domain)
  const domainAliases = useMemo(() => {
    const list: string[] = [];
    const globalAliases = bucket?.globalAliases || [];

    for (const a of globalAliases) {
      const trimmed = a.trim();
      if (
        trimmed.includes(".") &&
        !trimmed.startsWith(".") &&
        !trimmed.endsWith(".")
      ) {
        if (!list.includes(trimmed)) {
          list.push(trimmed);
        }
      }
    }

    return list;
  }, [bucket?.globalAliases]);

  const hasDomainAliases = domainAliases.length > 0;

  // Auto-switch mode to presigned if no domain aliases are available
  useEffect(() => {
    if (!hasDomainAliases && mode === "alias") {
      setMode("presigned");
    }
  }, [hasDomainAliases, mode]);

  // When dialog opens, reset to presigned if no domain aliases
  useEffect(() => {
    if (isOpen && !hasDomainAliases) {
      setMode("presigned");
    }
  }, [isOpen, hasDomainAliases]);

  // Auto-select first domain alias
  useEffect(() => {
    if (domainAliases.length > 0) {
      if (!selectedDomain || !domainAliases.includes(selectedDomain)) {
        setSelectedDomain(domainAliases[0]);
      }
    } else {
      setSelectedDomain("");
    }
  }, [domainAliases, selectedDomain]);

  // Mutation to request presigned URLs from backend
  const presignMutation = usePresignObjects(bucketName);

  // Trigger presign when in presigned mode and parameters change
  useEffect(() => {
    if (!isOpen || keys.length === 0 || mode !== "presigned") {
      return;
    }
    if (!selectedKeyId) {
      setPresignedUrls([]);
      setPresignError(null);
      return;
    }

    setPresignError(null);
    presignMutation.mutate(
      {
        keys,
        accessKeyId: selectedKeyId,
        expiresIn,
        endpoint: s3Endpoint || undefined,
      },
      {
        onSuccess: (res) => {
          setPresignedUrls(res.urls);
        },
        onError: (err) => {
          setPresignError(err.message || "Failed to generate presigned URLs");
        },
      }
    );
  }, [isOpen, keys, selectedKeyId, expiresIn, mode, bucketName, s3Endpoint]);

  // Unsigned URLs using domain alias with selected protocol (no port numbers)
  const aliasUrls = useMemo(() => {
    if (!selectedDomain) return [];
    return keys.map((key) => `${aliasProtocol}${selectedDomain}/${key}`);
  }, [selectedDomain, keys, aliasProtocol]);

  const activeUrls = mode === "presigned" ? presignedUrls : aliasUrls;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && shareDialog.close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">
            {keys.length > 1 ? `Share ${keys.length} files` : `Share ${keys[0] || ""}`}
          </DialogTitle>
        </DialogHeader>

        {/* Mode Selector Tabs */}
        <div className="flex rounded-lg border bg-muted p-1 gap-1">
          <button
            type="button"
            onClick={() => setMode("presigned")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-1.5 px-3 text-xs font-medium rounded-md transition-all",
              mode === "presigned"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ShieldCheck size={14} />
            S3 Path-style (Presigned)
          </button>
          <button
            type="button"
            disabled={!hasDomainAliases}
            onClick={() => hasDomainAliases && setMode("alias")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-1.5 px-3 text-xs font-medium rounded-md transition-all",
              mode === "alias"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              !hasDomainAliases &&
                "opacity-40 cursor-not-allowed hover:text-muted-foreground"
            )}
            title={
              !hasDomainAliases
                ? "No domain alias configured on this bucket"
                : undefined
            }
          >
            <Globe size={14} />
            Domain Alias (Web)
          </button>
        </div>

        {/* Content for Presigned Mode */}
        {mode === "presigned" && (
          <div className="flex flex-col gap-3">
            {readKeys.length === 0 ? (
              <Alert>
                <FileWarningIcon size={16} />
                <AlertDescription>
                  No key with read permission is granted to this bucket. Please
                  grant a key in the Permissions tab to enable presigned URLs.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                    <KeyIcon size={12} /> Key to sign with
                  </label>
                  <Select
                    options={keyOptions}
                    value={keyOptions.find((o) => o.value === selectedKeyId) || null}
                    onChange={(selected) =>
                      setSelectedKeyId((selected as Option | null)?.value || "")
                    }
                    isSearchable={false}
                    placeholder="Select key..."
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Expires in
                  </label>
                  <Select
                    options={expirationOptions}
                    value={
                      expirationOptions.find((o) => o.value === expiresIn) || null
                    }
                    onChange={(selected) =>
                      setExpiresIn((selected as Option<number> | null)?.value || 3600)
                    }
                    isSearchable={false}
                  />
                </div>
              </div>
            )}

            {presignError && (
              <Alert variant="destructive">
                <FileWarningIcon size={16} />
                <AlertDescription>{presignError}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Content for Domain Alias Mode */}
        {mode === "alias" && (
          <div className="flex flex-col gap-3">
            {!bucket.websiteAccess && (
              <Alert>
                <FileWarningIcon size={16} />
                <AlertDescription>
                  Website access is currently disabled for this bucket. To access
                  files publicly via domain alias, enable Website Access in bucket
                  Overview.
                </AlertDescription>
              </Alert>
            )}

            {domainAliases.length === 0 ? (
              <Alert>
                <Globe size={16} />
                <AlertDescription>
                  No domain alias is configured for this bucket. You can add a domain
                  alias (e.g. <code>cdn.example.com</code>) under Bucket Overview &gt;
                  Aliases.
                </AlertDescription>
              </Alert>
            ) : domainAliases.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                  <Globe size={12} /> Domain alias
                </label>
                <Select
                  options={domainAliases.map((d) => ({ label: d, value: d }))}
                  value={
                    selectedDomain
                      ? { label: selectedDomain, value: selectedDomain }
                      : null
                  }
                  onChange={(selected) =>
                    setSelectedDomain((selected as Option | null)?.value || "")
                  }
                  isSearchable={false}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
                <Globe size={14} className="text-foreground" />
                <span>Domain:</span>
                <span className="font-medium text-foreground">{domainAliases[0]}</span>
              </div>
            )}

            {domainAliases.length > 0 && (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Protocol
                </label>
                <div className="flex rounded-md border bg-muted/40 p-0.5">
                  {(["https://", "http://", "//"] as const).map((proto) => (
                    <button
                      key={proto}
                      type="button"
                      onClick={() => setAliasProtocol(proto)}
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                        aliasProtocol === proto
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {proto === "//" ? "auto (//)" : proto}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Output URLs */}
        <div className="flex max-h-60 flex-col gap-2 overflow-y-auto pt-1">
          {mode === "presigned" && presignMutation.isPending ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
              <Loader2 className="animate-spin" size={16} />
              Signing URLs...
            </div>
          ) : activeUrls.length > 0 ? (
            activeUrls.map((url) => (
              <div key={url} className="relative">
                <Input
                  value={url}
                  readOnly
                  className="w-full pr-12 font-mono text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  icon={Copy}
                  onClick={() => copyToClipboard(url)}
                  className="absolute right-0 top-0"
                  variant="ghost"
                  size="icon"
                />
              </div>
            ))
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {mode === "presigned" && readKeys.length === 0
                ? "Grant a key with read permissions to generate presigned URLs."
                : mode === "alias" && domainAliases.length === 0
                ? "No domain alias available."
                : "No URLs available."}
            </p>
          )}
        </div>

        <DialogFooter>
          {activeUrls.length > 1 ? (
            <Button
              variant="secondary"
              icon={Copy}
              onClick={() => copyToClipboard(activeUrls.join("\n"))}
              disabled={mode === "presigned" && presignMutation.isPending}
            >
              Copy all
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => shareDialog.close()}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ShareDialog;
