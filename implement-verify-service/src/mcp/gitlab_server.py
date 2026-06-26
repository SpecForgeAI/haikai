"""GitLab MCP server — exposes the connector tool registry over MCP (stdio).

Runtime wiring only. The `mcp` SDK is imported lazily inside `build_server()` so
that importing the registry (`tools.py`) never drags in the SDK — the tests
target the registry, not this module. Run with:

    python -m src.mcp.gitlab_server

Requires `mcp` in the environment (see requirements.txt).
"""

from __future__ import annotations

from src.mcp.tools import TOOLS


def build_server():
    """Construct a FastMCP server with every spec in TOOLS registered."""
    from mcp.server.fastmcp import FastMCP  # lazy: keep tools.py SDK-free

    server = FastMCP("gitlab-connectors")
    for spec in TOOLS:
        server.add_tool(spec.fn, name=spec.name, description=spec.description)
    return server


def main() -> None:
    build_server().run()


if __name__ == "__main__":
    main()
