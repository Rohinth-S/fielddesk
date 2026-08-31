import type { JobRow } from "./repository.js";

export type AvailabilitySlot = {
  technicianId: string;
  availableFrom: string;
  availableTo: string;
  sites?: string[];
  capacity?: number;
};

export type PlannedAssignment = {
  jobId: string;
  technicianId: string;
  reason: "site_match" | "site_fallback";
};

export type UnassignedJob = {
  jobId: string;
  reason: "no_technician" | "outside_availability" | "capacity_reached";
};

export type BulkDispatchPlan = {
  assignments: PlannedAssignment[];
  unassigned: UnassignedJob[];
};

function inWindow(job: JobRow, slot: AvailabilitySlot) {
  const due = new Date(job.due_at).getTime();
  return (
    Number.isFinite(due) &&
    due >= new Date(slot.availableFrom).getTime() &&
    due <= new Date(slot.availableTo).getTime()
  );
}

function supportsSite(job: JobRow, slot: AvailabilitySlot) {
  return !slot.sites?.length || slot.sites.some((site) => site.toLowerCase() === job.site.toLowerCase());
}

/**
 * Produce a deterministic bulk dispatch plan before mutating jobs. Jobs are
 * ordered by priority and due date, then assigned to the least-loaded
 * available technician. Exact site matches win over wildcard availability.
 */
export function planBulkAssignments(
  jobs: JobRow[],
  slots: AvailabilitySlot[],
): BulkDispatchPlan {
  const priority: Record<string, number> = { critical: 4, high: 3, normal: 2, low: 1 };
  const load = new Map(slots.map((slot) => [slot.technicianId, 0]));
  const assignments: PlannedAssignment[] = [];
  const unassigned: UnassignedJob[] = [];
  const sorted = [...jobs].sort(
    (a, b) =>
      (priority[b.priority] ?? 0) - (priority[a.priority] ?? 0) ||
      new Date(a.due_at).getTime() - new Date(b.due_at).getTime() ||
      a.id.localeCompare(b.id),
  );

  for (const job of sorted) {
    const candidates = slots.filter((slot) => {
      const current = load.get(slot.technicianId) ?? 0;
      return inWindow(job, slot) && current < (slot.capacity ?? 1);
    });
    if (!candidates.length) {
      const withTime = slots.some((slot) => inWindow(job, slot));
      unassigned.push({
        jobId: job.id,
        reason: withTime ? "capacity_reached" : "outside_availability",
      });
      continue;
    }
    const siteCandidates = candidates.filter((slot) => supportsSite(job, slot));
    const pool = siteCandidates.length ? siteCandidates : candidates.filter((slot) => !slot.sites?.length);
    if (!pool.length) {
      unassigned.push({ jobId: job.id, reason: "no_technician" });
      continue;
    }
    pool.sort((a, b) => (load.get(a.technicianId) ?? 0) - (load.get(b.technicianId) ?? 0) || a.technicianId.localeCompare(b.technicianId));
    const selected = pool[0];
    load.set(selected.technicianId, (load.get(selected.technicianId) ?? 0) + 1);
    assignments.push({
      jobId: job.id,
      technicianId: selected.technicianId,
      reason: siteCandidates.length ? "site_match" : "site_fallback",
    });
  }
  return { assignments, unassigned };
}
