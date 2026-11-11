import { FileText } from "lucide-react";
import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContractListItem } from "@/lib/contracts/queries";

import { StatusBadge } from "./status-badge";

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function ContractList({ contracts }: { contracts: ContractListItem[] }) {
  if (contracts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border px-6 py-14 text-center">
        <FileText className="text-muted-foreground size-7" aria-hidden />
        <h2 className="mt-3 font-medium">No contracts yet</h2>
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">
          Upload a contract to see it broken down into clauses.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Contract</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Clauses</TableHead>
            <TableHead className="text-right">Uploaded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map((contract) => (
            <TableRow key={contract.id}>
              <TableCell>
                <Link
                  href={`/contracts/${contract.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {contract.title}
                </Link>
                <div className="text-muted-foreground text-xs">{contract.fileName}</div>
              </TableCell>
              <TableCell>
                <StatusBadge status={contract.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {contract.status === "ready" ? contract.clauseCount : "–"}
              </TableCell>
              <TableCell className="text-muted-foreground text-right text-sm">
                {dateFormat.format(contract.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
