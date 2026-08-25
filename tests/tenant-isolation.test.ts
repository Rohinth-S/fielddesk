import { beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { db } from "../src/db.js";
import { createLocalRepository } from "../src/repository.js";

beforeEach(() => {
  for (const table of ["audit", "media", "jobs", "users"])
    db.prepare(`DELETE FROM ${table}`).run();
});

describe("FieldDesk tenant isolation", () => {
  it("keeps dispatchers and technicians inside their tenant", async () => {
    const repo = createLocalRepository();
    const alpha = crypto.randomUUID();
    const beta = crypto.randomUUID();
    await repo.createUser({ id: alpha, email: "alpha@test.local", role: "dispatcher", passwordHash: "hash", tenantId: "alpha" });
    await repo.createUser({ id: beta, email: "beta@test.local", role: "dispatcher", passwordHash: "hash", tenantId: "beta" });
    const alphaJob = crypto.randomUUID();
    const betaJob = crypto.randomUUID();
    for (const [id, tenantId, creator] of [[alphaJob, "alpha", alpha], [betaJob, "beta", beta]] as const)
      await repo.createJob({ id, title: `Job ${tenantId}`, description: "Inspect equipment", priority: "normal", site: "Plant 1", dueAt: "2026-12-01T12:00:00.000Z", createdBy: creator, tenantId });

    expect((await repo.listJobs("dispatcher", alpha, "alpha")).map((job) => job.id)).toEqual([alphaJob]);
    expect(await repo.getJob(betaJob, "alpha")).toBeUndefined();
    expect((await repo.getJob(betaJob, "beta"))?.tenant_id).toBe("beta");
  });
});
