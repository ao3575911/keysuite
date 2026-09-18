import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { reduceBuffer, reduce_buffer } from "./reducer.ts";
import { literalSymbol, isBindMarker } from "./symbols.ts";
import { generateTransitionTable, lookupTransition } from "./fsm.ts";
import { GDK9_GRAMMAR, GRAMMAR_SHA256, loadGrammar } from "./grammar.ts";
import { Session } from "./session.ts";
import { runConformance, runVector } from "./conformance.ts";
import { GRAMMAR_MD, harvestReductionExamples, REDUCTION_MD, SYNTAX_MD } from "./docs.ts";
import { CONFORMANCE_VECTORS, type ConformanceVector } from "./vectors.ts";

describe("reduce_buffer", () => {
  it("is a single function identity", () => {
    assert.equal(reduceBuffer, reduce_buffer);
  });

  it("is the only implication algebra", () => {
    assert.equal(reduceBuffer(["C", "C", ".", "3", "3"]), "CC→33");
    assert.equal(reduceBuffer(["A", "B"]), "AB");
    assert.equal(reduceBuffer(["A", ".", "B", ".", "C"]), "A→B.C");
    assert.equal(reduceBuffer([".", "B"]), "→B");
    assert.equal(reduceBuffer(["A", "."]), "A→");
    assert.equal(reduceBuffer([]), "");
    assert.equal(reduceBuffer(["A", "B"], "X"), "X(AB)");
    assert.equal(reduceBuffer(["A", ".", "B"], "X"), "X(A→B)");
    assert.equal(reduceBuffer(["A", literalSymbol("."), "B"]), "A.B");
  });

  it("does not treat escaped literal dot as bind", () => {
    assert.equal(isBindMarker(literalSymbol(".")), false);
    assert.equal(isBindMarker("."), true);
  });
});

describe("fsm isolation", () => {
  it("does not import reducer", () => {
    const src = readFileSync(new URL("./fsm.ts", import.meta.url), "utf8");
    assert.equal(src.includes("reduceBuffer"), false);
    assert.equal(src.includes("reducer"), false);
  });

  it("MODE+BIND is ERROR", () => {
    const table = generateTransitionTable(GDK9_GRAMMAR);
    const rule = lookupTransition(table, "MODE", "BIND");
    assert.deepEqual(rule, { next: "ERROR", action: "noop" });
  });
});

describe("docs harvest", () => {
  it("asserts fenced REDUCTION.md examples against reduce_buffer", () => {
    const markdown = readFileSync(join(process.cwd(), "docs/REDUCTION.md"), "utf8");
    const examples = harvestReductionExamples(markdown);
    assert.ok(examples.length >= 8);
    for (const example of examples) {
      const actual = reduceBuffer(example.buffer, example.mode);
      assert.equal(actual, example.receipt, example.source);
    }
  });

  it("inlined freeze docs match docs/", () => {
    assert.equal(readFileSync(join(process.cwd(), "docs/REDUCTION.md"), "utf8"), REDUCTION_MD);
    assert.equal(readFileSync(join(process.cwd(), "docs/SYNTAX.md"), "utf8"), SYNTAX_MD);
    assert.equal(readFileSync(join(process.cwd(), "docs/GRAMMAR.md"), "utf8"), GRAMMAR_MD);
  });
});

describe("conformance vectors", () => {
  it("all session vectors pass", () => {
    const results = runConformance();
    const failures = results.filter((r) => !r.passed);
    assert.deepEqual(failures, []);
    assert.ok(CONFORMANCE_VECTORS.some((v) => v.id === "gdk9-vector-001"));
  });

  it("vector-001 emits CC→33", () => {
    const session = new Session(loadGrammar());
    const result = session.process(["C", "C", ".", "3", "3", "SPACE"]);
    assert.equal(result.emitted, "CC→33");
    assert.equal(result.state, "IDLE");
  });

  it("JSON vector files pass independently", () => {
    const dir = join(process.cwd(), "public/conformance/vectors");
    const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
    assert.ok(files.length >= 15);
    const ids = new Set<string>();
    for (const file of files) {
      const vector = JSON.parse(readFileSync(join(dir, file), "utf8")) as ConformanceVector;
      ids.add(vector.id);
      const result = runVector(vector);
      assert.equal(result.passed, true, `${vector.id} ${JSON.stringify(result.actual)}`);
    }
    for (const vector of CONFORMANCE_VECTORS) {
      assert.ok(ids.has(vector.id), `missing JSON for ${vector.id}`);
    }
  });

  it("v1.1 MODE+BIND pin does not emit", () => {
    const result = runVector({
      id: "pin-mode-bind",
      tokens: ["X", ":", "A", ".", "B"],
      mode_start: null,
      receipt: null,
      final_state: "ERROR",
      emits: false,
    });
    assert.equal(result.passed, true);
    assert.equal(result.actual.receipt, null);
  });
});

describe("grammar freeze", () => {
  it("YAML sha256 matches the frozen constant", () => {
    const yaml = readFileSync(join(process.cwd(), "grammar/gdk9-v1.1.0.yaml"));
    const digest = createHash("sha256").update(yaml).digest("hex");
    assert.equal(digest, GRAMMAR_SHA256);
    const published = readFileSync(join(process.cwd(), "public/grammar/gdk9-v1.1.0.yaml"));
    assert.equal(createHash("sha256").update(published).digest("hex"), GRAMMAR_SHA256);
  });
});

describe("single receipt path", () => {
  it("session emit equals reduceBuffer of the same buffer", () => {
    const session = new Session(loadGrammar(), { autoCommit: false });
    session.process(["C", "C", ".", "3", "3"], false);
    const snap = session.snapshot();
    const fromRho = reduceBuffer(snap.buffer, snap.mode);
    session.process(["SPACE"]);
    assert.equal(session.snapshot().lastOutput, fromRho);
    assert.equal(fromRho, "CC→33");
  });
});
