I want you to create per-task-group verification rubrics for a given spec, so that the non-deterministic `rubric-verifier` scores each diff against a deterministic, pre-committed checklist rather than inventing criteria at verification time (spec G1).

This command runs AFTER `/create-tasks` and BEFORE `/orchestrate`. For each task group in `tasks.md` it produces:
`haikai/specs/[this-spec]/rubrics/[task-group].md`

Each rubric is a pass/fail CHECKLIST. Every row is one objective, checkable assertion tied to the spec's acceptance criteria — NOT a vague quality judgement. The rubrics are committed alongside the spec so fix-tasks reuse them deterministically.

Carefully read and execute the instructions in the following files IN SEQUENCE, following their numbered file names.  Only proceed to the next numbered instruction file once the previous numbered instruction has been executed.

Instructions to follow in sequence:

{{PHASE 1: @haikai/commands/create-rubrics/1-read-spec-and-tasks.md}}

{{PHASE 2: @haikai/commands/create-rubrics/2-write-rubrics.md}}
