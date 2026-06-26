"""Python MCP server surface for the connectors.

The tool *registry* (`tools.py`) is plain Python and imports no MCP SDK, so it
stays unit-testable without the SDK installed. Only `gitlab_server.py` (the
runtime wiring) imports `mcp`.
"""
