import { describe, expect, it } from "vitest";
import { planBulkAssignments } from "../src/scheduling.js";

const job = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: id,
  description: "Inspect equipment",
  priority: "normal",
  site: "Plant A",
  status: "queued",
  assigned_to: null,
  due_at: "2026-12-01T10:00:00.000Z",
  created_by: "dispatcher",
  created_at: "2026-11-01T10:00:00.000Z",
  tenant_id: "default",
  ...overrides,
});

describe("bulk dispatch scheduling", () => {
  it("prioritizes critical work and balances available technicians", () => {
    const plan = planBulkAssignments(
      [
        job("normal", { due_at: "2026-12-01T09:00:00.000Z" }),
        job("critical", { priority: "critical", site: "Plant B" }),
        job("high", { priority: "high", site: "Plant A" }),
      ],
      [
        { technicianId: "tech-a", availableFrom: "2026-12-01T08:00:00.000Z", availableTo: "2026-12-01T12:00:00.000Z", sites: ["Plant A"], capacity: 2 },
        { technicianId: "tech-b", availableFrom: "2026-12-01T08:00:00.000Z", availableTo: "2026-12-01T12:00:00.000Z", capacity: 2 },
      ],
    );
    expect(plan.assignments.map((assignment) => assignment.jobId)).toEqual(["critical", "high", "normal"]);
    expect(plan.assignments.find((assignment) => assignment.jobId === "high")?.technicianId).toBe("tech-a");
    expect(plan.assignments.find((assignment) => assignment.jobId === "critical")?.technicianId).toBe("tech-b");
    expect(plan.unassigned).toHaveLength(0);
  });

  it("reports availability and capacity failures without mutating jobs", () => {
    const plan = planBulkAssignments(
      [
        job("outside", { due_at: "2026-12-02T10:00:00.000Z" }),
        job("overflow", { due_at: "2026-12-01T11:00:00.000Z" }),
      ],
      [{ technicianId: "tech-a", availableFrom: "2026-12-01T08:00:00.000Z", availableTo: "2026-12-01T12:00:00.000Z", capacity: 1 }],
    );
    expect(plan.assignments).toHaveLength(1);
    expect(plan.unassigned).toEqual([
      { jobId: "outside", reason: "outside_availability" },
    ]);
  });
});
