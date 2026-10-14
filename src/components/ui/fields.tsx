"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function IconField({
  label,
  icon,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  error?: boolean;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "relative block rounded-xl border bg-background px-3 pb-2.5 pt-3.5 transition-colors",
        error ? "border-red-500" : "border-border focus-within:border-sky-400",
        className,
      )}
    >
      <span
        className={cn(
          "absolute -top-2 left-3 bg-card px-1 text-xs",
          error ? "text-red-500" : "text-muted-foreground",
        )}
      >
        {label}
        {required ? " *" : ""}
      </span>
      <div className="flex items-center gap-2">
        {icon ? <span className="shrink-0 text-sky-500">{icon}</span> : null}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </label>
  );
}

export function BareInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function BareSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn("h-8 w-full bg-transparent text-sm outline-none", className)} {...props}>
      {children}
    </select>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-rose-500" : "bg-zinc-300 dark:bg-zinc-600",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function UnderlineTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-5 border-b text-sm">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "-mb-px border-b-2 pb-2 font-medium",
            value === tab.id
              ? "border-rose-500 text-rose-500"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
