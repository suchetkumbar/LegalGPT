import { Badge } from "@/components/ui/badge";
import type { ContractStatus } from "@/lib/db/schema";

const LABELS: Record<ContractStatus, string> = {
  uploaded: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: ContractStatus }) {
  return (
    <Badge
      variant={
        status === "failed" ? "destructive" : status === "ready" ? "secondary" : "outline"
      }
    >
      {LABELS[status]}
    </Badge>
  );
}
