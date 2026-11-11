"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Progress } from "@/components/ui/progress";
import { describeProgress, isFinished, type JobProgress } from "@/lib/contracts/progress";

/**
 * Follows the analysis job over server-sent events and reloads the page data
 * when it finishes, so the viewer (or the failure message) takes its place.
 */
export function AnalysisProgress({
  contractId,
  initial,
}: {
  contractId: string;
  initial: JobProgress;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState(initial);

  useEffect(() => {
    const source = new EventSource(`/api/contracts/${contractId}/stream`);
    source.onmessage = (event) => {
      const next = JSON.parse(event.data) as JobProgress;
      setProgress(next);
      if (isFinished(next.status)) {
        source.close();
        router.refresh();
      }
    };
    return () => source.close();
  }, [contractId, router]);

  const { label, percent } = describeProgress(progress);

  return (
    <div className="mx-auto max-w-md py-16 text-center" aria-live="polite">
      <p className="font-medium">{label}</p>
      <Progress value={percent} className="mt-4" aria-label="Analysis progress" />
      <p className="text-muted-foreground mt-3 text-sm">
        This usually takes a few seconds. You can leave this page; the analysis carries
        on.
      </p>
    </div>
  );
}
