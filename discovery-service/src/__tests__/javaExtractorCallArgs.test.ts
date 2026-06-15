/**
 * Tests for Java call-argument-literal retention (Outbound Integration Graph,
 * Spec #5, Task Group 1; the shared substrate Spec #6's SQL-text capture also
 * consumes).
 *
 * Spec: 2026-05-30 Outbound Integration Graph for Discovery
 * (Java / Spring Classic + Spring Boot).
 *
 * The Java extractor used to hardcode `CallIR.args: []` (arity-only via
 * `argCount`). This group POPULATES the arguments: each call's positional
 * argument text is captured onto `CallInfo.args` by the AST walk
 * (`extractMethodCalls`, the `astUtils` layer that owns `argCount`) and mapped
 * onto `CallIR.args` by `extract.ts`'s `toCallIR` passthrough.
 *
 * Layers asserted:
 *   - `CallInfo.args` + `argCount` via `extractMethodCalls(methodNode)`
 *     (argCount lives on CallInfo, NOT on the IR's CallIR).
 *   - `CallIR.args` via the public `extractJavaIR` pipeline (the passthrough).
 *
 * CAUTION (tree-sitter test isolation): run THIS file alone by path. Many
 * Java-parsing suites fail when run together in one process (pre-existing,
 * unrelated). See the spec's test-isolation note.
 */
import { parseJavaFile, type SyntaxNode } from '../services/extensionPacks/languageExtractors/java/javaParser';
import { extractMethodCalls, type CallInfo } from '../services/extensionPacks/languageExtractors/java/astUtils';
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { CallIR, SourceFileIR } from '../services/extensionPacks/languageIR';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the first descendant node of `type` (depth-first). */
function firstOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  if (node.type === type) return node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      const found = firstOfType(child, type);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Wrap a method body in a class, parse it, and return the CallInfo list that
 * `extractMethodCalls` produces for the wrapping method (the astUtils layer,
 * which carries BOTH `args` and `argCount`).
 */
function callsFromBody(body: string): CallInfo[] {
  const src = `package com.foo;\npublic class C {\n  public void m() {\n${body}\n  }\n}\n`;
  const tree = parseJavaFile(src);
  if (!tree) throw new Error('parse failed');
  const method = firstOfType(tree.rootNode, 'method_declaration');
  if (!method) throw new Error('no method_declaration');
  return extractMethodCalls(method);
}

/** The (first) CallInfo with a given method name. */
function infoNamed(calls: CallInfo[], methodName: string): CallInfo {
  const found = calls.find((c) => c.methodName === methodName);
  if (!found) throw new Error(`no call named ${methodName}`);
  return found;
}

/** Parse a full Java source via the public extractor (the CallIR / IR layer). */
function parseIR(src: string): SourceFileIR {
  const ir = extractJavaIR('Test.java', src);
  if (!ir) throw new Error('parse failed');
  return ir;
}

/** The (first) IR-level CallIR with a given method name, across all methods. */
function irCallNamed(ir: SourceFileIR, methodName: string): CallIR {
  for (const cls of ir.classes) {
    for (const m of cls.methods) {
      const found = (m.calls ?? []).find((c) => c.methodName === methodName);
      if (found) return found;
    }
  }
  throw new Error(`no IR call named ${methodName}`);
}

// ===========================================================================
// 1. HTTP-client URL string literal -> unquoted text, on CallInfo AND CallIR
// ===========================================================================

describe('string-literal arguments are retained unquoted', () => {
  it('restTemplate.getForObject("http://inventory/items", X.class) -> args[0] is the bare URL', () => {
    const calls = callsFromBody(`    restTemplate.getForObject("http://inventory/items", X.class);`);
    const call = infoNamed(calls, 'getForObject');
    // String literal -> UNQUOTED text (no surrounding double quotes).
    expect(call.args).toContain('http://inventory/items');
    expect(call.args[0]).toBe('http://inventory/items');
    // Arity + ordering preserved: the non-literal `X.class` is captured as a
    // stable placeholder in slot 1 (NOT dropped, NOT a fabricated literal).
    expect(call.args).toHaveLength(2);
    expect(call.args[1]).toBe('X.class');
    expect(call.argCount).toBe(2);
  });

  it('CallIR.args (the IR passthrough) carries the same unquoted URL literal', () => {
    const ir = parseIR(`
package com.foo;
public class InventoryClient {
  public void load() {
    restTemplate.getForObject("http://inventory/items", X.class);
  }
}
`);
    const call = irCallNamed(ir, 'getForObject');
    // toCallIR used to hardcode `[]`; it now maps CallInfo.args through.
    expect(call.args).toEqual(['http://inventory/items', 'X.class']);
  });

  it('decodes common escape sequences in the string body (verbatim target stays readable)', () => {
    const calls = callsFromBody(`    client.call("a/\\"quoted\\"/b\\tc");`);
    const call = infoNamed(calls, 'call');
    // \\" -> " and \\t -> a tab, with the surrounding quotes stripped.
    expect(call.args[0]).toBe('a/"quoted"/b\tc');
  });
});

// ===========================================================================
// 2. Messaging-producer topic literal -> retained with ordering
// ===========================================================================

describe('messaging-producer topic/queue literals are retained with ordering', () => {
  it('kafkaTemplate.send("orders-topic", payload) -> ["orders-topic", "payload"]', () => {
    const calls = callsFromBody(`    kafkaTemplate.send("orders-topic", payload);`);
    const call = infoNamed(calls, 'send');
    expect(call.args).toContain('orders-topic');
    // Ordering preserved: topic literal first, identifier arg second.
    expect(call.args).toEqual(['orders-topic', 'payload']);
    expect(call.argCount).toBe(2);
  });

  it('mixed literal + non-literal builder arg keeps a placeholder so arity stays correct', () => {
    const calls = callsFromBody(`    producer.send("events", buildEvent("x").withId(makeId()));`);
    const call = infoNamed(calls, 'send');
    expect(call.args).toHaveLength(2);
    expect(call.args[0]).toBe('events');
    // The builder chain (a method_invocation) -> stable placeholder = its raw
    // source text. It is NOT a fabricated literal and slot/arity are preserved.
    expect(call.args[1]).toBe('buildEvent("x").withId(makeId())');
    expect(call.argCount).toBe(2);
  });
});

// ===========================================================================
// 3. No-arg call -> empty args + zero argCount
// ===========================================================================

describe('no-argument call', () => {
  it('a no-arg call yields args: [] and argCount: 0', () => {
    const calls = callsFromBody(`    helper.refresh();`);
    const call = infoNamed(calls, 'refresh');
    expect(call.args).toEqual([]);
    expect(call.argCount).toBe(0);
  });
});

// ===========================================================================
// 4. Literal kinds (numeric/char/boolean/constant identifier) -> raw text
// ===========================================================================

describe('primitive literals and bare constants are retained as their source text', () => {
  it('captures numeric, char and boolean literals plus a bare constant identifier verbatim', () => {
    const calls = callsFromBody(`
    repo.findById(42L);
    api.flag(true, 'c', 3.14);
    producer.send(TOPIC);
`);
    expect(infoNamed(calls, 'findById').args).toEqual(['42L']);
    expect(infoNamed(calls, 'flag').args).toEqual(['true', "'c'", '3.14']);
    // Bare static-constant identifier -> identifier text (best-effort; the
    // resolver resolves the constant value, not the extractor).
    expect(infoNamed(calls, 'send').args).toEqual(['TOPIC']);
  });
});

// ===========================================================================
// 5. Regression: argCount still equals the real positional arity, and
//    args.length tracks argCount for every captured call.
// ===========================================================================

describe('regression: argCount keeps working and args.length === argCount', () => {
  it('argCount equals the positional argument count across varied arities', () => {
    const calls = callsFromBody(`
    zero.a();
    one.b("x");
    three.c("x", y, z);
`);
    expect(infoNamed(calls, 'a').argCount).toBe(0);
    expect(infoNamed(calls, 'b').argCount).toBe(1);
    expect(infoNamed(calls, 'c').argCount).toBe(3);

    // Invariant the resolver relies on: one args entry per positional arg.
    for (const call of calls) {
      expect(call.args).toHaveLength(call.argCount);
    }
  });
});
