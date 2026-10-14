"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const POPULAR = ["com", "net", "org", "io", "co", "ai"];
const ITEM_HEIGHT = 32;
const VISIBLE = 8;

function norm(value: string) {
  return value.replace(/^\./, "").toLowerCase();
}

export function TldCombobox({
  value,
  tlds,
  onChange,
}: {
  value: string;
  tlds: string[];
  onChange: (tld: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => {
    const unique = [...new Set((tlds.length ? tlds : POPULAR).map(norm))];
    unique.sort((a, b) => a.localeCompare(b));
    return unique;
  }, [tlds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\./, "");
    const match = q ? all.filter((tld) => tld.includes(q)) : all;
    const popular = POPULAR.filter((tld) => match.includes(tld));
    const rest = match.filter((tld) => !POPULAR.includes(tld));
    return { popular, rest, items: [...popular, ...rest] };
  }, [all, query]);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    setActive(0);
    setScrollTop(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [query, open]);

  const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 2);
  const slice = filtered.items.slice(start, start + VISIBLE + 6);

  function choose(tld: string) {
    onChange(tld);
    setQuery("");
    setOpen(false);
  }

  function onKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((curr) => Math.min(filtered.items.length - 1, curr + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((curr) => Math.max(0, curr - 1));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const tld = filtered.items[active];
      if (tld) choose(tld);
    }
  }

  useEffect(() => {
    const top = active * ITEM_HEIGHT;
    const view = listRef.current;
    if (!view) return;
    if (top < view.scrollTop) view.scrollTop = top;
    if (top > view.scrollTop + VISIBLE * ITEM_HEIGHT - ITEM_HEIGHT) {
      view.scrollTop = top - (VISIBLE - 1) * ITEM_HEIGHT;
    }
  }, [active]);

  return (
    <div ref={rootRef} className="relative">
      <input
        className="h-9 w-full rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        value={open ? query : `.${norm(value || "com")}`}
        placeholder="Search zone..."
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border bg-card shadow-lg">
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">Search zone...</div>
          <div
            ref={listRef}
            className="overflow-auto"
            style={{ maxHeight: VISIBLE * ITEM_HEIGHT }}
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          >
            <div style={{ height: start * ITEM_HEIGHT }} />
            {slice.map((tld, index) => {
              const realIndex = start + index;
              const isPopular = realIndex < filtered.popular.length;
              const showPopular = realIndex === 0 && filtered.popular.length > 0;
              const showAll = realIndex === filtered.popular.length && filtered.rest.length > 0;
              return (
                <div key={tld}>
                  {showPopular && (
                    <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Popular</div>
                  )}
                  {showAll && (
                    <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">All zones</div>
                  )}
                  <button
                    type="button"
                    className={cn(
                      "flex h-8 w-full items-center px-3 text-left text-sm",
                      realIndex === active ? "bg-muted" : "hover:bg-muted/60",
                    )}
                    onMouseEnter={() => setActive(realIndex)}
                    onClick={() => choose(tld)}
                  >
                    .{tld}
                    {isPopular ? "" : ""}
                  </button>
                </div>
              );
            })}
            <div style={{ height: Math.max(0, (filtered.items.length - start - slice.length) * ITEM_HEIGHT) }} />
            {!filtered.items.length && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No zones found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
