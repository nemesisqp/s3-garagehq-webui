import { DeepPartial, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { websiteConfigSchema, WebsiteConfigSchema } from "../schema";
import { useEffect, useMemo } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { useUpdateBucket } from "../hooks";
import { Info, LinkIcon } from "lucide-react";
import Button from "@/components/ui/button";
import { InputField } from "@/components/ui/input";
import { ToggleField } from "@/components/ui/toggle";
import { useBucketContext } from "../context";

const WebsiteAccessSection = () => {
  const { bucket: data, bucketName } = useBucketContext();
  const form = useForm<WebsiteConfigSchema>({
    resolver: zodResolver(websiteConfigSchema),
  });
  const isEnabled = useWatch({ control: form.control, name: "websiteAccess" });

  const domainAliases = useMemo(() => {
    const list: string[] = [];
    const globalAliases = data?.globalAliases || [];

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

    if (
      bucketName &&
      bucketName.includes(".") &&
      !bucketName.startsWith(".") &&
      !bucketName.endsWith(".") &&
      !list.includes(bucketName)
    ) {
      list.unshift(bucketName);
    }

    return list;
  }, [data?.globalAliases, bucketName]);

  const updateMutation = useUpdateBucket(data?.id);

  const onChange = useDebounce((values: DeepPartial<WebsiteConfigSchema>) => {
    const data = {
      enabled: values.websiteAccess,
      indexDocument: values.websiteAccess
        ? values.websiteConfig?.indexDocument
        : undefined,
      errorDocument: values.websiteAccess
        ? values.websiteConfig?.errorDocument
        : undefined,
    };

    updateMutation.mutate({
      websiteAccess: data,
    });
  });

  useEffect(() => {
    form.reset({
      websiteAccess: data?.websiteAccess,
      websiteConfig: {
        indexDocument: data?.websiteConfig?.indexDocument || "index.html",
        errorDocument: data?.websiteConfig?.errorDocument || "error/400.html",
      },
    });

    const { unsubscribe } = form.watch((values) => onChange(values));
    return unsubscribe;
  }, [data]);

  return (
    <div className="mt-8">
      <div className="flex flex-row items-center gap-2">
        <p className="grow-0 text-sm font-medium">Website Access</p>
        <Button
          href="https://garagehq.deuxfleurs.fr/documentation/cookbook/exposing-websites"
          target="_blank"
          size="sm"
          shape="circle"
          color="ghost"
        >
          <Info size={16} />
        </Button>
      </div>

      <ToggleField form={form} name="websiteAccess" label="Enabled" />

      {isEnabled && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InputField
              form={form}
              name="websiteConfig.indexDocument"
              title="Index Document"
            />
            <InputField
              form={form}
              name="websiteConfig.errorDocument"
              title="Error Document"
            />
          </div>

          {domainAliases.length > 0 ? (
            <div className="mt-4 flex flex-row flex-wrap gap-x-3 gap-y-1 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
              {domainAliases.map((domain) => {
                const protocol =
                  typeof window !== "undefined" &&
                  window.location.protocol === "https:"
                    ? "https://"
                    : "http://";
                return (
                  <a
                    key={domain}
                    href={`${protocol}${domain}`}
                    className="inline-flex items-center flex-row gap-2 font-medium hover:underline text-foreground"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <LinkIcon size={14} />
                    {domain}
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              No domain alias configured. Add an alias with a domain name (e.g. <code>example.com</code>) in the Aliases section to access the website.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default WebsiteAccessSection;
