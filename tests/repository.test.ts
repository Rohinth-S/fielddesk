import { describe, expect, it } from "vitest";
import { createPostgresRepositoryFromExecutor } from "../src/repository.js";

describe("FieldDesk Postgres repository contract", () => {
  it("uses prefixed managed tables and parameterized queries", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const executor = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        if (text.startsWith("SELECT id,email"))
          return {
            rows: [
              {
                id: "u1",
                email: "tech@example.test",
                role: "technician",
                password_hash: "scrypt$demo$hash",
              },
            ],
          };
        if (text.startsWith("SELECT * FROM fielddesk_jobs"))
          return {
            rows: [{ id: "j1", status: "assigned", assigned_to: "u1" }],
          };
        return { rows: [] };
      },
    };
    const repo = createPostgresRepositoryFromExecutor(executor);
    const user = await repo.getUserByEmail("tech@example.test");
    expect(user?.id).toBe("u1");
    await repo.createJob({
      id: "j1",
      title: "Inspection",
      description: "Inspect equipment",
      priority: "normal",
      site: "Plant 4",
      dueAt: "2026-12-01T12:00:00.000Z",
      createdBy: "u2",
    });
    await repo.updateJobStatus("j1", "completed");
    expect(calls.some((call) => call.text.includes("fielddesk_users"))).toBe(
      true,
    );
    expect(calls.some((call) => call.text.includes("fielddesk_jobs"))).toBe(
      true,
    );
    expect(
      calls.every((call) => !call.text.includes("tech@example.test")),
    ).toBe(true);
  });
});
