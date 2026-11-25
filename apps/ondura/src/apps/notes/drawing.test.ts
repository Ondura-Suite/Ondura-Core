// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

const sent: { path: string; o: Record<string, unknown> }[] = [];
vi.mock("../../lib/graphApps", async (orig) => ({
  ...(await orig<typeof import("../../lib/graphApps")>()),
  graphRaw: vi.fn(async (_a: string, _area: string, _m: string, path: string, o: Record<string, unknown>) => {
    sent.push({ path, o });
    return { status: 204, etag: null, contentType: null, body: "", base64: false };
  }),
}));
vi.mock("./drawing", async (orig) => ({ ...(await orig<typeof import("./drawing")>()), drawingPng: vi.fn(async () => ({ png: new Uint8Array([137, 80, 78, 71]), width: 640, height: 120 })) }));

import { hits, neededHeight, parseDrawing, strokePath, isDrawing } from "./drawing";
import { drawingsToImages, patchPage, diffBlocks } from "./onenote";

const drawingHtml = (s: unknown[]) => `<div data-ink='${JSON.stringify({ w: 640, h: 240, s })}' class="nx-ink"><svg></svg></div>`;

describe("Drawings", () => {
  it("smooths strokes and draws single taps as dots", () => {
    expect(strokePath([1, 2])).toBe("M1 2l0 0");
    expect(strokePath([0, 0, 10, 0])).toBe("M0 0L10 0");
    expect(strokePath([0, 0, 10, 0, 20, 10, 30, 10])).toMatch(/^M0 0Q10 0 15 5Q20 10 25 10L30 10$/);
  });

  it("erases strokes the eraser touches", () => {
    const s = { c: "#000", w: 2, p: [0, 0, 100, 0] };
    expect(hits(s, 50, 5, 4)).toBe(true);
    expect(hits(s, 50, 20, 4)).toBe(false);
  });

  it("grows below the lowest stroke", () => {
    expect(neededHeight({ w: 640, h: 240, s: [{ c: "#000", w: 4, p: [0, 300] }] })).toBe(364);
    expect(neededHeight({ w: 640, h: 240, s: [] })).toBe(240);
  });

  it("accepts only well-formed drawing data", () => {
    const d = parseDrawing(JSON.stringify({ w: 500, h: 100, s: [{ c: "red;evil", w: 2, p: [1, 2] }, { c: "#fff", p: ["x"] }, null] }));
    expect(d.s).toEqual([{ c: "#000000", w: 2, hl: false, p: [1, 2] }]);
    expect(parseDrawing("{not json").s).toEqual([]);
    expect(isDrawing(drawingHtml([]))).toBe(true);
  });
});

describe("Drawings on OneNote pages", () => {
  it("are sent as PNG pictures; empty ones are left out", async () => {
    const before = [{ id: "p:{a}{1}", html: "<p>Text</p>" }];
    const after = [
      { id: "p:{a}{1}", html: "<p>Text</p>" },
      { id: null, html: drawingHtml([{ c: "#e81224", w: 3, p: [10, 10, 50, 40] }]) },
      { id: null, html: drawingHtml([]) },
    ];
    const cmds = diffBlocks(before, after, "", "");
    const { cmds: out, parts } = await drawingsToImages(cmds);
    expect(parts).toHaveLength(1);
    expect(out).toEqual([{ target: "p:{a}{1}", action: "insert", position: "after", content: expect.stringMatching(/^<img src="name:ink1" width="640" height="120" alt="[^"]+">$/) }]);

    await patchPage("acc", "page1", out, parts);
    const req = sent.at(-1)!;
    expect(req.o.bodyBase64).toBe(true);
    const boundary = /boundary=(\S+)/.exec(req.o.contentType as string)![1];
    const text = atob(req.o.body as string);
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="Commands"\r\nContent-Type: application/json`);
    expect(text).toContain('name="ink1"\r\nContent-Type: image/png\r\n\r\n\x89PNG\r\n');
    expect(text.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("a drawing erased completely removes its picture", async () => {
    const { cmds } = await drawingsToImages([{ target: "img:{a}{9}", action: "replace", content: drawingHtml([]) }]);
    expect(cmds).toEqual([{ target: "img:{a}{9}", action: "replace", content: "<p></p>" }]);
  });
});
