# Raw Idea

## Title
Route all Shape-Spec + Orchestration traffic through Gateway with upstream Bearer auth (remove direct localhost:8000 usage)

## Intent
Fix the Implement flow so the browser never calls localhost:8000 directly (preventing 401s and avoiding leaking service credentials). All Shape-Spec streaming and Orchestration calls must go via the Gateway, and the Gateway must inject the upstream Bearer token for ALL requests it makes to localhost:8000.
