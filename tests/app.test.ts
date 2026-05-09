import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { db } from "../src/db.js";
beforeEach(() => {
  for (const t of ["audit", "media", "jobs", "users"])
    db.prepare(`DELETE FROM ${t}`).run();
});
describe("FieldDesk lifecycle", () => {
  it("blocks illegal status transitions", async () => {
    const d = await request(app)
      .post("/auth/register")
      .send({
        email: "d@test.local",
        password: "correct-horse-battery",
        role: "dispatcher",
      });
    const t = await request(app)
      .post("/auth/register")
      .send({
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
  });
});
