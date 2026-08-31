import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { db } from "../src/db.js";
beforeEach(() => {
  for (const t of ["outbox", "audit", "media", "jobs", "users"])
    db.prepare(`DELETE FROM ${t}`).run();
});
describe("FieldDesk lifecycle", () => {
  it("blocks illegal status transitions", async () => {
    const d = await request(app).post("/auth/register").send({
      email: "d@test.local",
      password: "correct-horse-battery",
      role: "dispatcher",
    });
    const t = await request(app).post("/auth/register").send({
      email: "t@test.local",
      password: "correct-horse-battery",
      role: "technician",
    });
    const l = await request(app)
      .post("/auth/login")
      .send({ email: "d@test.local", password: "correct-horse-battery" });
    const j = await request(app)
      .post("/jobs")
      .set("Authorization", `Bearer ${l.body.token}`)
      .send({
        title: "HVAC inspection",
        description: "Inspect rooftop HVAC and attach photos",
        site: "Plant 4",
        dueAt: "2026-12-01T12:00:00.000Z",
      });
    await request(app)
      .post(`/jobs/${j.body.id}/assign`)
      .set("Authorization", `Bearer ${l.body.token}`)
      .send({ technicianId: t.body.id });
    const bad = await request(app)
      .post(`/jobs/${j.body.id}/status`)
      .set("Authorization", `Bearer ${l.body.token}`)
      .send({ status: "completed" });
    expect(bad.status).toBe(409);
    const outbox = await request(app)
      .get("/outbox")
      .set("Authorization", `Bearer ${l.body.token}`);
    expect(outbox.status).toBe(200);
    expect(outbox.body.some((entry: { topic: string }) => entry.topic === "fielddesk.job.created")).toBe(true);
  });

  it("previews and applies a capacity-aware bulk dispatch plan", async () => {
    const dispatcher = await request(app).post("/auth/register").send({
      email: "bulk-dispatcher@test.local",
      password: "correct-horse-battery",
      role: "dispatcher",
      tenantId: "bulk-tenant",
    });
    const technician = await request(app).post("/auth/register").send({
      email: "bulk-tech@test.local",
      password: "correct-horse-battery",
      role: "technician",
      tenantId: "bulk-tenant",
    });
    const token = (await request(app).post("/auth/login").send({
      email: "bulk-dispatcher@test.local",
      password: "correct-horse-battery",
    })).body.token;
    const create = async (title: string) => request(app).post("/jobs").set("Authorization", `Bearer ${token}`).send({
      title,
      description: "Inspect critical equipment and attach evidence",
      priority: "high",
      site: "Plant A",
      dueAt: "2026-12-01T10:00:00.000Z",
    });
    const first = await create("Bulk job one");
    const second = await create("Bulk job two");
    const body = {
      jobIds: [first.body.id, second.body.id],
      technicians: [{ technicianId: technician.body.id, availableFrom: "2026-12-01T08:00:00.000Z", availableTo: "2026-12-01T12:00:00.000Z", sites: ["Plant A"], capacity: 1 }],
      dryRun: false,
    };
    const response = await request(app).post("/jobs/bulk-dispatch").set("Authorization", `Bearer ${token}`).send(body);
    expect(response.status).toBe(200);
    expect(response.body.applied).toBe(1);
    expect(response.body.unassigned).toHaveLength(1);
    const jobs = (await request(app).get("/jobs").set("Authorization", `Bearer ${token}`)).body as Array<{ id: string; status: string }>;
    expect([first.body.id, second.body.id].filter((id) => jobs.find((job) => job.id === id)?.status === "assigned")).toHaveLength(1);
  });
});
