import { Badge } from "@/components/ui/primitives";

const map: Record<string, { label: string; variant: "default" | "success" | "warning" | "danger" | "muted" }> = {
  pending: { label: "Pending", variant: "warning" },
  purchased: { label: "Purchased", variant: "success" },
  active: { label: "Active", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
  available: { label: "Available", variant: "success" },
  unavailable: { label: "Unavailable", variant: "muted" },
  not_added: { label: "Not added", variant: "muted" },
  creating: { label: "Creating", variant: "warning" },
  waiting_nameservers: { label: "Nameservers received", variant: "warning" },
  adding: { label: "Adding", variant: "warning" },
  connected: { label: "Connected", variant: "success" },
  error: { label: "Error", variant: "danger" },
  unknown: { label: "Unknown", variant: "muted" },
  queued: { label: "Queued", variant: "muted" },
  purchasing: { label: "Purchasing", variant: "warning" },
  running: { label: "Running", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
};

export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <Badge variant="muted">—</Badge>;
  const item = map[value] ?? { label: value, variant: "default" as const };
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
