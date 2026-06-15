# Raw Idea

## Title
Route all /api/v1 frontend requests to Gateway via Vite proxy

## Intent
Ensure that all frontend HTTP requests under the /api/v1 path are routed to the Gateway service in development, preventing accidental proxying to the architecture-model-service (localhost:8080) and eliminating "Resource not found" errors for Gateway-owned endpoints.
