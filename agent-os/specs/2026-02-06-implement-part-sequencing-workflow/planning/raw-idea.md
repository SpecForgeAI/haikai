# Raw Idea

## Title
Implement-part sequencing workflow (Planner split → per-part shape-spec Q&A → async orchestration jobs)

## Intent
Add an explicit "split into parts" handoff workflow where the Planner LLM signals it has no more questions and provides X implementation parts. The UI then processes parts sequentially: for each part, send details to shape-spec/stream, collect Q&A, call orchestration job, poll until complete, then advance to next part.
