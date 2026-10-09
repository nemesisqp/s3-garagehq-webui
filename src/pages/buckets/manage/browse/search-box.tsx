import { Search, X } from "lucide-react";
import Input from "@/components/ui/input";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

const SearchBox = ({ value, onChange }: Props) => {
  const trimmed = value.trim();
  const isTooShort = trimmed.length === 1;

  return (
    <div className="relative">
      <Search
        size={15}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search files & folders…"
        aria-label="Search files and folders"
        title={isTooShort ? "Type at least 2 characters to search" : undefined}
        className="h-9 w-44 pl-8 pr-8 md:w-60"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X size={15} />
        </button>
      ) : null}
      {isTooShort ? (
        <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 select-none text-[10px] text-muted-foreground/75 font-mono">
          2+ chars
        </span>
      ) : null}
    </div>
  );
};

export default SearchBox;
