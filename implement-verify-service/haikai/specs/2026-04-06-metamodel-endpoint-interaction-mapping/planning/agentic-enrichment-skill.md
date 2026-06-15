# Spec: Agentic Interaction Enrichment Skill

## Problem

The enricher needs to resolve `target` (resource name) and `data_entity` (data type) for every detected interaction. This requires tracing data flows through code — following variables, reading type definitions, checking callers. A fixed prompt with truncated source can't do this. The LLM needs tool access to the full structural store and the ability to investigate iteratively.

## Solution

An agentic enricher with tool access to all structural store outputs. The LLM follows a hypothesis/probe/assess reasoning loop, deciding what to read and how deep to trace.

## Reasoning Loop

See [enrichment-strategy.dot](visuals/enrichment-strategy.dot)

```
1. HYPOTHESIZE — form best guess for target and data_entity
2. CHOOSE PROBE — pick single best tool call to test hypothesis
3. RUN PROBE — execute one tool call
4. ASSESS EVIDENCE:
   - Confirmed (high confidence) → RESOLVED
   - Weakened/contradicted → refine hypothesis, go to 2
   - No signal → choose different probe, go to 2
   - Max hops (3) reached → LEAVE EMPTY
```

## Iteration Levels

```
Outer: rounds (max 3)
  │  Collect unresolved interactions
  │  If no progress from last round → stop
  │
  ├── Middle: batches of 15 interactions per agent session
  │     │
  │     └── Inner: LLM agent tool calls (max 10 per batch)
  │           │
  │           ├── hypothesis/probe/assess loop
  │           ├── one tool call at a time
  │           └── FINAL_ANSWER when done
  │
  └── Check progress → if resolved > 0 → next round
```

Round 1 resolves the easy ones. Round 2 gets a fresh attempt at the remainder. Round 3 is the last try. Stops early if no progress.

## Tools

| Tool | Source | Returns |
|------|--------|---------|
| `read_calls(file_pattern)` | `_calls.txt` | Call graph: caller → callee, line, confidence |
| `read_index(file_pattern)` | `_index.txt` | Symbols: classes, methods, types, signatures, scope |
| `read_imports(file_pattern)` | `_imports.txt` | Import statements |
| `read_inheritance(file_pattern)` | `_inheritance.txt` | Type hierarchies: extends, implements |
| `read_source(file, start, end)` | Source files | Source code by line range |
| `read_source(file, function_name)` | Source files | Source of a specific function |

## System Prompt

The LLM receives:
- Tool descriptions
- Reasoning loop instructions (hypothesize/probe/assess)
- Output format (`FINAL_ANSWER` as JSON array)
- Tool call format (`TOOL_CALL: name(param="value")`)

The LLM does NOT receive:
- A prescribed investigation sequence
- Pre-selected source snippets
- Truncated context

## Proven Results

piggymetrics (Java, 12 interactions):
- Before: 0/12 data_hint populated
- After: 12/12 data_hint populated (100%)

Examples:
- `repository.save` → target=`accounts`, data_entity=`Account`
- `restTemplate.getForEntity` → target=`user-info`, data_entity=`UserDTO`
- `mailSender.send` → target=`email`, data_entity=`EmailMessage`

## Implementation

- `src/ast/enrichment_tools.py` — tool functions reading from structural store
- `src/ast/interaction_enricher.py` — agent loop with outer iteration
- Wired into `InteractionClassifier.classify()` after classification
- Pipeline passes `snapshot_path` for tool access
