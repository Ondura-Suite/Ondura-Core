import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let statuses: string[] = [];
vi.mock("../../lib/graphApps", () => ({
  graph: vi.fn(async (_account: string, _area: string, method: string, path: string) => {
    calls.push(`${method} ${path}`);
    if (path.endsWith("/copyToSection")) return { id: "op1", status: "NotStarted" };
    if (path.includes("/operations/")) return { status: statuses.shift() ?? "Running" };
    return null;
  }),
  graphAll: vi.fn(),
  graphRaw: vi.fn(async (_account: string, _area: string, method: string, path: string) => {
    calls.push(`${method} ${path}`);
    return { status: 204, body: "" };
  }),
}));

const { movePage } = await import("./onenote");
const now = () => Promise.resolve();

describe("OneNote page move", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("copies, waits for the operation and deletes the original", async () => {
    statuses = ["Running", "Completed"];
    await movePage("acc", "p 1", "s2", now);
    expect(calls).toEqual([
      "POST /me/onenote/pages/p%201/copyToSection",
      "GET /me/onenote/operations/op1",
      "GET /me/onenote/operations/op1",
      "DELETE /me/onenote/pages/p%201",
    ]);
  });

  it("keeps the original when the copy fails", async () => {
    statuses = ["Failed"];
    await expect(movePage("acc", "p1", "s2", now)).rejects.toThrow();
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });
});
