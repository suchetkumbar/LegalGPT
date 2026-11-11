import type { JobStatus } from "@/lib/db/schema";

/** What the progress stream sends and the progress bar renders. */
export type JobProgress = {
  stage: string;
  status: JobStatus;
  error: string | null;
};

const STAGE_LABELS: Record<string, string> = {
  queued: "Waiting to start",
  parse: "Reading the document",
  ocr: "Reading a scanned document (this is slower)",
  segment: "Finding the clauses",
  classify: "Labelling each clause",
  extract: "Picking out parties, dates and amounts",
  embed: "Indexing for search",
  review: "Checking risks and compliance",
  assess: "Comparing against your playbook",
  done: "Done",
};

const STAGE_PERCENT: Record<string, number> = {
  queued: 5,
  parse: 15,
  ocr: 20,
  segment: 30,
  classify: 50,
  extract: 70,
  embed: 85,
  review: 88,
  assess: 94,
  done: 100,
};

export function describeProgress(progress: JobProgress): {
  label: string;
  percent: number;
} {
  if (progress.status === "succeeded") return { label: STAGE_LABELS.done, percent: 100 };
  return {
    label: STAGE_LABELS[progress.stage] ?? "Working",
    percent: STAGE_PERCENT[progress.stage] ?? 50,
  };
}

export function isFinished(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed";
}
