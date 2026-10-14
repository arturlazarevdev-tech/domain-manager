"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close" />
      <div className={cn("relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-5 shadow-xl", className)}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn("h-9 w-full rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring", className)}
      {...props}
    >
      {children}
    </select>
  );
}
