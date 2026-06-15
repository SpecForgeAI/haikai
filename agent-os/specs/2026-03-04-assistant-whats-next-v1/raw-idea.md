title: "Assistant 'What's Next' v1: deterministic signals + clickable actions (panel launches)"

intent:
Enable @assistant "what's next" to produce a deterministic, grounded set of up to 5 recommended next actions (with reasons) based on current project signals and dashboard scope. Render actions as clickable items; clicking an action navigates to the correct screen/tab, opens the RHS chat panel, switches persona, and auto-sends the task label to begin that workflow. This is advisory (Level 1): nothing runs automatically without a click.

scope:
gateway:
  - Add a ProjectSignals snapshot builder (new service/module) that can be computed on-demand:
      * Inputs: projectId, current dashboard scope (scopeType + scopeValue if applicable)
      * Signals (v1):
        - missionExists (filesystem)
        - techStandardsExists (filesystem; treat current TECH-STACK/standards file as "tech standards" existence)
        - roadmapExists (database; initiatives/epics present)
        - architectureBaselineExists (database; metamodel/baseline present)
        - testStrategyExists (filesystem if present; else false)
        - epicCount (db)
        - storyCount (db)
        - storiesWithAC (db if available, else 0)
        - storiesInProgress/storiesDone/storiesVerified (gateway/db if available; else 0)
      * Must degrade gracefully: missing data sources return safe defaults (false/0) without failing the endpoint.
  - Implement DeterministicNextActionsEvaluator (new module):
      * Hard rule: if missionExists == false => only action is "Define Product Mission".
      * Preferred bootstrapping order (soft): Tech Standards -> Roadmap -> Architecture Baseline -> Test Strategy.
      * Once all bootstrapping artifacts exist, propose optimisation actions (up to 5 total).
      * Always return explanation text and actions array (max 5), sorted by priority descending.
  - Extend the assistant chat handling:
      * Detect "what's next" intent when active persona is assistant.
      * On detection, compute ProjectSignals + NextActions and return structured response.
  - Define action contract returned to frontend.

frontend:
  - In UnifiedChatPanel message rendering, support structured "action list" assistant message.
  - Clicking an action navigates to screen/tab, opens RHS panel, switches persona, auto-sends action label.
  - Ensure dashboard scope is available to gateway for "what's next".

constraints:
  - Do not implement the Implement work-item picker flow.
  - Do not implement the Generate Standards modal launch.
  - Do not introduce new artifact endpoints; reuse existing chat + save mechanics.
  - Do not change Implement screen.
  - No streaming, summarisation, completion chips, or diff/merge.
