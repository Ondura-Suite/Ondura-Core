// @vitest-environment happy-dom
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseDrawio, toDrawio } from "./drawio";
import { route } from "./geometry";
import { flowchartTemplate, networkTemplate } from "./templates";

describe("draw.io files", () => {
  it("round-trips Ondura's own diagrams", async () => {
    const d = flowchartTemplate();
    d.pages[0].shapes[0].bold = true;
    d.pages[0].edges[0].dashed = true;
    const back = await parseDrawio(toDrawio(d));
    const [p, q] = [d.pages[0], back.pages[0]];
    expect(q.shapes.map((s) => [s.kind, s.text, s.x, s.y, s.w, s.h, s.fill])).toEqual(p.shapes.map((s) => [s.kind, s.text, s.x, s.y, s.w, s.h, s.fill]));
    expect(q.shapes[0].bold).toBe(true);
    expect(q.edges.map((e) => [e.source, e.target, e.text, e.endArrow, e.style])).toEqual(p.edges.map((e) => [e.source, e.target, e.text, e.endArrow, e.style]));
    expect(q.edges[0].dashed).toBe(true);
    expect(q.edges.find((e) => e.sourcePort)?.sourcePort).toEqual({ x: 0.5, y: 0 });
  });

  it("keeps network icons", async () => {
    const back = await parseDrawio(toDrawio(networkTemplate()));
    expect(back.pages[0].shapes.map((s) => s.kind)).toContain("router");
  });

  it("opens compressed files from diagrams.net with groups", async () => {
    const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="g" value="" style="group" vertex="1" parent="1"><mxGeometry x="100" y="100" width="200" height="100" as="geometry"/></mxCell>
      <mxCell id="a" value="&lt;b&gt;Hallo&lt;/b&gt;&lt;br&gt;Welt" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;" vertex="1" parent="g"><mxGeometry x="10" y="20" width="80" height="40" as="geometry"/></mxCell>
      <mxCell id="b" value="X" style="shape=mxgraph.aws4.lambda;" vertex="1" parent="1"><mxGeometry x="400" y="100" width="60" height="60" as="geometry"/></mxCell>
      <mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;endArrow=open;endFill=0;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const packed = Buffer.from(deflateRawSync(Buffer.from(encodeURIComponent(model)))).toString("base64");
    const d = await parseDrawio(`<mxfile><diagram name="Plan" id="x">${packed}</diagram></mxfile>`);
    const p = d.pages[0];
    expect(p.name).toBe("Plan");
    const a = p.shapes.find((s) => s.id === "a")!;
    expect([a.kind, a.x, a.y, a.text, a.fill]).toEqual(["roundRect", 110, 120, "Hallo\nWelt", "#ffe6cc"]);
    // Unknown shapes keep their style for the next save.
    expect(p.shapes.find((s) => s.id === "b")!.extra).toContain("mxgraph.aws4.lambda");
    expect(toDrawio(d)).toContain("mxgraph.aws4.lambda");
    expect(p.edges[0].endArrow).toBe("open");
    expect(route(p.edges[0], p)).not.toBeNull();
  });
});

describe("routes", () => {
  it("connects facing sides with right angles", () => {
    const d = flowchartTemplate();
    const p = d.pages[0];
    for (const e of p.edges) {
      const r = route(e, p)!;
      for (let i = 1; i < r.points.length; i++) {
        const [a, b] = [r.points[i - 1], r.points[i]];
        expect(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5).toBe(true);
      }
    }
  });
});
