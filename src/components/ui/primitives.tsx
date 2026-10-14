import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border bg-card px-3 text-sm outline-none ring-ring placeholder:text-muted-foreground focus-visible:ring-2",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full rounded-md border bg-card px-3 py-2 text-sm outline-none ring-ring placeholder:text-muted-foreground focus-visible:ring-2",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border bg-card p-4 shadow-sm", className)} {...props} />;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: "default" | "success" | "warning" | "danger" | "muted" }) {
  const styles = {
    default: "bg-muted text-foreground",
    success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    muted: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", styles[variant], className)}
      {...props}
    />
  );
}
