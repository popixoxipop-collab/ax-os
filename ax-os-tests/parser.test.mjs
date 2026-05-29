/** ReAct parser — tool call extraction */
import { describe, it, expect } from "vitest";
import { parseToolCalls, stripToolCalls, buildObservation } from "../ax-os-dist/ax-os-react-parser.js";

describe("parseToolCalls", () => {
  it("extracts a single well-formed tool call", () => {
    const calls = parseToolCalls(`pre <tool_call>{"name":"foo","args":{"x":1}}</tool_call> post`);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("foo");
    expect(calls[0].args.x).toBe(1);
  });

  it("extracts multiple tool calls in order", () => {
    const calls = parseToolCalls(`<tool_call>{"name":"a","args":{}}</tool_call><tool_call>{"name":"b","args":{}}</tool_call>`);
    expect(calls.map(c => c.name)).toEqual(["a", "b"]);
  });

  it("returns empty array when no tool calls present", () => {
    expect(parseToolCalls("just plain text, no tools")).toHaveLength(0);
  });

  it("skips malformed JSON inside tags", () => {
    expect(parseToolCalls(`<tool_call>{not valid json}</tool_call>`)).toHaveLength(0);
  });

  it("accepts 'arguments' as an alias for args", () => {
    const calls = parseToolCalls(`<tool_call>{"name":"f","arguments":{"k":"v"}}</tool_call>`);
    expect(calls[0].args.k).toBe("v");
  });
});

describe("stripToolCalls", () => {
  it("removes tool_call blocks leaving clean text", () => {
    const out = stripToolCalls(`answer <tool_call>{"name":"x","args":{}}</tool_call> done`);
    expect(out).not.toContain("tool_call");
    expect(out).toContain("answer");
    expect(out).toContain("done");
  });
});

describe("buildObservation", () => {
  it("formats a successful observation", () => {
    const o = buildObservation("mytool", "the result", true);
    expect(o).toContain("Observation [mytool]");
    expect(o).toContain("the result");
  });

  it("marks failed observations as ERROR", () => {
    expect(buildObservation("t", "boom", false)).toContain("ERROR");
  });

  it("truncates very long results", () => {
    const long = "x".repeat(5000);
    const o = buildObservation("t", long, true);
    expect(o).toContain("truncated");
    expect(o.length).toBeLessThan(long.length);
  });
});
