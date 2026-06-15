"""Agentic diagram discovery.

The LLM agent has tool access to the full structural store
(_calls.txt, _index.txt, _imports.txt, _inheritance.txt,
_endpoints.txt, _interactions.txt) and source files.
It decides which enrichment-dependent diagrams are worth
generating and produces DiagramModel JSON.

Strategy is defined in the Haikai skill file:
  haikai-profiles/default/commands/discover-diagrams/single-agent/discover-diagrams.md
"""
import json
import logging
from pathlib import Path
from typing import Optional

from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship
from src.ast.enrichment_tools import TOOLS

logger = logging.getLogger(__name__)

MAX_AGENT_TURNS = 25
SKILL_FILE = Path(__file__).parent.parent.parent / "haikai-profiles" / "default" / "commands" / "discover-diagrams" / "single-agent" / "discover-diagrams.md"


def _load_system_prompt() -> str:
    """Load the discovery strategy from the Haikai skill file."""
    try:
        return SKILL_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning(f"Skill file not found: {SKILL_FILE}, using fallback")
        return (
            "You are generating architecture diagrams for a codebase. "
            "Use tools to read the structural store. "
            "Produce DiagramModel JSON. Respond with FINAL_ANSWER as JSON array."
        )


def discover_diagrams(
    llm_client,
    project_root: str = ".",
    snapshot_path: str = None,
) -> list[DiagramModel]:
    """Discover and generate diagrams using an agentic LLM.

    The LLM reads the structural store (endpoints, interactions, calls,
    index, imports, inheritance) and source files. It decides which
    diagrams are worth generating and produces DiagramModel JSON.

    Args:
        llm_client: LLM client for agent interaction.
        project_root: Root path for source file reading.
        snapshot_path: Path to structural store snapshot.

    Returns:
        List of DiagramModel instances ready for serialisation.
    """
    if not llm_client:
        logger.info("No LLM client — skipping agentic diagram discovery")
        return []

    if not snapshot_path:
        logger.warning("No snapshot path — diagram discovery requires structural store")
        return []

    # Check if there's any enrichment data worth diagramming
    sp = Path(snapshot_path)
    has_endpoints = (sp / "_endpoints.txt").exists() and (sp / "_endpoints.txt").stat().st_size > 10
    has_interactions = (sp / "_interactions.txt").exists() and (sp / "_interactions.txt").stat().st_size > 10
    if not has_endpoints and not has_interactions:
        logger.info("No enrichment data (endpoints/interactions) — skipping agentic diagrams")
        return []

    # Build a self-contained user message that includes:
    # 1. The skill instructions (system prompt content)
    # 2. The codebase + snapshot paths (so Claude knows what to analyze)
    # 3. The actual task
    #
    # Why not use a separate `system` message? The Claude Max proxy
    # (LLM_BASE_URL=http://localhost:3456/v1) silently drops the system
    # role when forwarding to Claude Code CLI. Confirmed 2026-05-02 by
    # direct-curl test: sent 962 tokens of input incl. system prompt,
    # proxy reported `prompt_tokens: 3`. Without this fold, Claude got
    # no codebase context and improvised diagrams about the proxy itself.
    skill_instructions = _load_system_prompt()
    enrichment_summary = []
    if has_endpoints:
        ep_lines = (sp / "_endpoints.txt").read_text(encoding="utf-8", errors="replace").splitlines()
        enrichment_summary.append(f"  endpoints: {sum(1 for l in ep_lines if l.strip() and not l.startswith('#'))} entries in _endpoints.txt")
    if has_interactions:
        int_lines = (sp / "_interactions.txt").read_text(encoding="utf-8", errors="replace").splitlines()
        enrichment_summary.append(f"  interactions: {sum(1 for l in int_lines if l.strip() and not l.startswith('#'))} entries in _interactions.txt")

    user_msg = (
        f"{skill_instructions}\n\n"
        f"---\n\n"
        f"# Task context\n\n"
        f"**Codebase root:** `{project_root}`\n"
        f"**Structural snapshot:** `{snapshot_path}`\n\n"
        f"**Enrichment data available:**\n" + "\n".join(enrichment_summary) + "\n\n"
        f"Now perform the task described above for this specific codebase. "
        f"Start by calling `read_endpoints(\"\")` and `read_interactions(\"\")` "
        f"to survey what's there, then decide which diagram types from the skill's "
        f"tier list to generate. Respond with FINAL_ANSWER as a JSON array of DiagramModel objects."
    )

    messages = [
        {"role": "user", "content": user_msg},
    ]

    diagrams: list[DiagramModel] = []
    conversation_trace: list[dict] = [{"turn": 0, "role": "user", "content_preview": user_msg[:200]}]

    for turn in range(MAX_AGENT_TURNS):
        try:
            response = llm_client.generate(messages=messages, max_tokens=8000)
            if not isinstance(response, str):
                response = str(response)
        except Exception as e:
            logger.warning(f"Diagram discovery agent call failed: {e}")
            conversation_trace.append({"turn": turn + 1, "error": str(e)})
            break

        conversation_trace.append({
            "turn": turn + 1,
            "role": "assistant",
            "content_length": len(response),
            "content_preview": response[:300],
        })

        # Check for final answer
        if "FINAL_ANSWER" in response:
            diagrams = _parse_diagram_answer(response)
            conversation_trace.append({"turn": turn + 1, "final_answer": True, "diagrams": len(diagrams)})
            break

        # GPT-5.4+ may return bare JSON array
        stripped = response.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            parsed = _parse_bare_json(stripped)
            if parsed:
                diagrams = parsed
                break

        # Check for tool calls
        tool_result = _execute_tool_call(response, project_root, snapshot_path)
        if tool_result:
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": f"Tool result:\n{tool_result}"})
        else:
            # No tool call and no final answer — ask to conclude
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": "Please provide your FINAL_ANSWER now as a JSON array of DiagramModel objects."})

    # Save conversation trace for debugging (mirrors discovery_loop._save_trace)
    try:
        import tempfile, json as _json
        model = getattr(llm_client, "model", "unknown")
        trace_file = Path(tempfile.gettempdir()) / f"diagram_trace_{model}.json"
        trace_file.write_text(
            _json.dumps(conversation_trace, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info(f"Diagram conversation trace saved to: {trace_file}")
    except Exception as e:
        logger.warning(f"Failed to save diagram trace: {e}")

    logger.info(f"Diagram discovery complete: {len(diagrams)} diagrams generated")
    return diagrams


def _execute_tool_call(response: str, project_root: str, snapshot_path: str) -> Optional[str]:
    """Parse and execute a tool call from the LLM response."""
    if "TOOL_CALL:" not in response:
        return None

    results = []
    for line in response.splitlines():
        line = line.strip()
        if not line.startswith("TOOL_CALL:"):
            continue

        call_str = line[len("TOOL_CALL:"):].strip()
        paren_idx = call_str.find("(")
        if paren_idx == -1:
            continue

        tool_name = call_str[:paren_idx].strip()
        args_str = call_str[paren_idx + 1:].rstrip(")")

        if tool_name not in TOOLS:
            results.append(f"Unknown tool: {tool_name}. Available: {', '.join(TOOLS.keys())}")
            continue

        kwargs = _parse_tool_args(args_str)

        try:
            tool_fn = TOOLS[tool_name]["function"]
            if tool_name in ("read_source", "glob", "grep", "read_directory"):
                result = tool_fn(project_root, **kwargs)
            elif snapshot_path:
                result = tool_fn(snapshot_path, **kwargs)
            else:
                result = "(no snapshot path available)"
            results.append(f"[{tool_name}]\n{result}")
        except Exception as e:
            results.append(f"Tool error ({tool_name}): {e}")

    return "\n\n".join(results) if results else None


def _parse_tool_args(args_str: str) -> dict:
    """Parse tool call arguments — supports keyword and positional forms."""
    import re

    kwargs = {}
    if not args_str.strip():
        return kwargs

    # Try keyword form: key="value"
    kw_matches = re.findall(r'(\w+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|(\d+))', args_str)
    if kw_matches:
        for key, dq, sq, num in kw_matches:
            value = dq or sq or num
            if num:
                kwargs[key] = int(num)
            else:
                kwargs[key] = value
        return kwargs

    # Positional form: just a quoted string
    pos_matches = re.findall(r'"([^"]*)"|\'([^\']*)\'', args_str)
    if pos_matches:
        values = [dq or sq for dq, sq in pos_matches]
        # Map positional args based on tool expectations
        if values:
            kwargs["file_pattern"] = values[0]
        if len(values) > 1:
            kwargs["start_line"] = int(values[1]) if values[1].isdigit() else values[1]
        if len(values) > 2:
            kwargs["end_line"] = int(values[2]) if values[2].isdigit() else values[2]
        return kwargs

    # Bare unquoted string
    stripped = args_str.strip().strip("\"'")
    kwargs["file_pattern"] = stripped
    return kwargs


def _parse_diagram_answer(response: str) -> list[DiagramModel]:
    """Parse FINAL_ANSWER JSON into DiagramModel list."""
    try:
        idx = response.index("FINAL_ANSWER")
        json_str = response[idx + len("FINAL_ANSWER"):].strip()
        return _json_to_models(json_str)
    except (ValueError, json.JSONDecodeError) as e:
        logger.warning(f"Failed to parse diagram FINAL_ANSWER: {e}")
        return []


def _parse_bare_json(json_str: str) -> list[DiagramModel]:
    """Parse bare JSON array into DiagramModel list."""
    try:
        return _json_to_models(json_str)
    except (json.JSONDecodeError, Exception) as e:
        logger.warning(f"Failed to parse bare JSON diagrams: {e}")
        return []


def _json_to_models(json_str: str) -> list[DiagramModel]:
    """Convert JSON string to list of DiagramModel."""
    # Handle markdown code fences
    if "```" in json_str:
        import re
        match = re.search(r'```(?:json)?\s*\n?(.*?)```', json_str, re.DOTALL)
        if match:
            json_str = match.group(1).strip()

    data = json.loads(json_str)
    if not isinstance(data, list):
        data = [data]

    models = []
    for item in data:
        if not isinstance(item, dict):
            continue

        entities = []
        for e in item.get("entities", []):
            entities.append(DiagramEntity(
                id=e.get("id", ""),
                name=e.get("name", ""),
                entity_type=e.get("entity_type", ""),
                parent_id=e.get("parent_id"),
                properties=e.get("properties", {}),
            ))

        relationships = []
        for r in item.get("relationships", []):
            relationships.append(DiagramRelationship(
                source_id=r.get("source_id", ""),
                target_id=r.get("target_id", ""),
                rel_type=r.get("rel_type", ""),
                label=r.get("label"),
            ))

        model = DiagramModel(
            diagram_type=item.get("diagram_type", "unknown"),
            title=item.get("title", ""),
            entities=entities,
            relationships=relationships,
            metadata=item.get("metadata", {}),
        )
        models.append(model)

    return models
