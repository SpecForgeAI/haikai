# Task Breakdown: Business Point Super-Entity

## Overview
Total Tasks: 6 Task Groups, approximately 35+ sub-tasks

This feature introduces a new "Business Point" super-entity that mirrors the existing Application Point pattern. Business Points are auto-created for Business Processes and Process Activities, enabling two refactored relationships: User <-> Business Point (formerly User <-> Process) and App Point <-> Business Point (formerly App Point <-> Process).

## Reference Patterns
- **Application Point Implementation**: `frontend/src/utils/applicationPointSync.ts`
- **Application Point Formatters**: `frontend/src/utils/formatters.ts`
- **Grid Configurations**: `frontend/src/config/gridConfigs.ts`
- **Type Definitions**: `frontend/src/types/model.ts`

---