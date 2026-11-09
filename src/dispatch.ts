import type { JobRow } from "./repository.js";

export type SlaState = "overdue" | "at_risk" | "on_track" | "terminal";
export type DispatchFilters = {
  site?: string;
  status?: string;
  priority?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  now?: Date;
};

export type DispatchJob = JobRow & {
  sla: SlaState;
  overdueByMinutes: number;
  urgencyScore: number;
};

export type DispatchPage = {
  items: DispatchJob[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

const terminalStatuses = new Set(["completed", "cancelled"]);
const priorityWeight: Record<string, number> = {
  critical: 100,
  high: 60,
  normal: 30,
  low: 10,
};

export function classifySla(job: JobRow, now = new Date()): { state: SlaState; overdueByMinutes: number } {
  if (terminalStatuses.has(job.status)) return { state: "terminal", overdueByMinutes: 0 };
  const minutes = Math.floor((now.getTime() - new Date(job.due_at).getTime()) / 60_000);
  if (minutes > 0) return { state: "overdue", overdueByMinutes: minutes };
  const remaining = Math.abs(minutes);
  return { state: remaining <= 120 ? "at_risk" : "on_track", overdueByMinutes: 0 };
}

export function buildDispatchPage(jobs: JobRow[], filters: DispatchFilters = {}): DispatchPage {
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(filters.pageSize ?? 25)));
  const now = filters.now ?? new Date();
  const query = filters.search?.trim().toLowerCase();
  const filtered = jobs.filter((job) => {
    if (filters.site && job.site.toLowerCase() !== filters.site.toLowerCase()) return false;
    if (filters.status && job.status !== filters.status) return false;
    if (filters.priority && job.priority !== filters.priority) return false;
    if (query && !`${job.title} ${job.description} ${job.site}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const ranked = filtered.map((job) => {
    const sla = classifySla(job, now);
    const urgencyScore = priorityWeight[job.priority] + (sla.state === "overdue" ? 200 + sla.overdueByMinutes : sla.state === "at_risk" ? 80 : 0);
    return { ...job, sla: sla.state, overdueByMinutes: sla.overdueByMinutes, urgencyScore };
  }).sort((a, b) => b.urgencyScore - a.urgencyScore || new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  const start = (page - 1) * pageSize;
  return { items: ranked.slice(start, start + pageSize), page, pageSize, total: ranked.length, pages: Math.max(1, Math.ceil(ranked.length / pageSize)) };
}
