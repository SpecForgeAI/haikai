# Tier C guidance - no framework pack, no IR

Neither a framework pack nor a language-level IR is available for
this file. You have only the raw source text. Treat this as a
best-effort inference task with deliberately lowered confidence.

## What you have to work with

- The raw source file contents.
- The base-layer schema.
- Your own knowledge of common architectural naming conventions and
  idioms across languages.

## What you do NOT have

- No pack-extracted candidates (do not pretend any exist).
- No parsed classes / methods / imports list (do not assume any
  specific structural fact unless you can see it directly in the
  source).
- No guarantee that the file is even in a recognized language.

## How to proceed

1. Scan for obviously architectural declarations in the source -
   class-like constructs, top-level function groups, exported
   objects, top-of-file documentation describing purpose.
2. Match those declarations against universal naming conventions
   (`*Service`, `*Controller`, `*Repository`, `*Client`, `*Handler`,
   `*Listener`, `*Job`, `*Scheduler`, `*Gateway`, `*Publisher`,
   `*Consumer`).
3. If the top of the file contains a docblock / header comment
   describing business intent, use it to populate `description` and
   to justify a higher confidence.
4. Emit only what you can defend from text you can actually see.

## Lowered confidence expectations

Because you have no structural corroboration, ceiling your
confidence values lower than in Tier A or Tier B:

- Best case (clear naming + clear docblock + clear body): 0.7-0.8.
- Moderate (clear naming only): 0.55-0.7.
- Weak (inference from body alone): do not emit.

## Safety rails

- Still output a single JSON array and nothing else.
- Still emit `[]` when you have nothing defensible.
- Still never fabricate structural facts. If you cannot see an
  import, do not claim one exists.
