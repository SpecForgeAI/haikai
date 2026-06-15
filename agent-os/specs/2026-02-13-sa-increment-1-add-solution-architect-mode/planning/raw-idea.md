# Raw Idea

Title: "SA Increment 1 – Add Solution Architect Mode + UI Entry Point (Tool-less, No Saving)"

Description:
Introduce a new chat persona "solution_architect" that allows high-level architecture discussion based on the existing Product. This increment is tool-less and does NOT persist any architecture changes. It only enables structured architecture discovery conversation.

Key scope:
- New chat mode "solution_architect" in gateway
- Dedicated SolutionArchitectChatPanel in frontend
- UI entry point on Product screen ("Discuss Architecture" button)
- Structured JSON response contract (questions | ready phases)
- Transcript persistence under kind="solution_architect"

Excludes: MCP tools, architecture writes, diagram creation, standards injection, MISSION/TECH-STACK auto-injection
