# Raw Idea

## Title
Fix Planner JSON Regression — Stop Treating Raw JSON as Chat Message + Restore LHS Updates

## Description
The gateway is failing to parse the Planner's JSON response and returning a fallback plannerResponse where all structured fields are empty, while passing the raw JSON string through as the assistant message. This causes:
1. Chat bubble shows entire JSON blob
2. LHS Feature Definition panels never update (plannerResponse is empty)

Fix involves:
- Gateway: Parse JSON first, then sanitize message field only (not raw JSON)
- Gateway: On parse failure, return safe message, don't pass raw JSON to frontend
- Frontend: Don't overwrite LHS state with fallback/invalid plannerResponse
