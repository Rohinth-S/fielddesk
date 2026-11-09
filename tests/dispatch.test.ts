import { describe, expect, it } from "vitest";
import { buildDispatchPage, classifySla } from "../src/dispatch.js";

const base = (overrides: Partial<any> = {}) => ({
  id: "j1", title: "Boiler inspection", description: "Inspect plant boiler", priority: "normal",
  site: "Plant A", status: "assigned", assigned_to: "u1", due_at: "2026-01-01T09:00:00.000Z", created_by: "u2", created_at: "2025-12-01T09:00:00.000Z", ...overrides,
});

describe("dispatch planning", () => {
  it("classifies overdue and terminal jobs", () => {
    expect(classifySla(base(), new Date("2026-01-01T10:30:00.000Z"))).toEqual({ state: "overdue", overdueByMinutes: 90 });
    expect(classifySla(base({ status: "completed" }), new Date("2026-01-01T10:30:00.000Z")).state).toBe("terminal");
  });

  it("ranks critical overdue work and paginates filters", () => {
    const page = buildDispatchPage([
      base({ id: "low", priority: "low", site: "Plant B" }),
      base({ id: "critical", priority: "critical" }),
      base({ id: "other", title: "Pump repair" }),
    ], { search: "inspection", page: 1, pageSize: 1, now: new Date("2026-01-01T10:00:00.000Z") });
    expect(page.total).toBe(2);
    expect(page.items[0].id).toBe("critical");
    expect(page.pages).toBe(2);
  });
});
