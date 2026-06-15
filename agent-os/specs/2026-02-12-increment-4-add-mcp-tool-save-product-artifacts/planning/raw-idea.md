# Increment 4 – Add MCP Tool: save_product_artifacts (MISSION.MD Writer + Minimal DB Upsert)

## Raw Description

Add an extensible MCP tool that persists the product "view" at commit time. In v0.1 it will:
(1) write Agent-OS product mission file to <projectParentFolder>/agent-os/product/MISSION.MD
(2) upsert minimal ProductDefinition in architecture-model-service (projectId + productName)
This increment introduces the tool and wiring in gateway + mcp-server, but does not change the PM conversation flow (confirmation + invocation wiring is Increment 5).

## Metadata

- **Spec Initiated**: 2026-02-12
- **Status**: Requirements Research Phase
