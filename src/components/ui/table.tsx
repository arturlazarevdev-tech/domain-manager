import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

export function THead(props: React.ComponentProps<"thead">) {
  return <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground" {...props} />;
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("px-3 py-2 font-medium", className)} {...props} />;
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}
