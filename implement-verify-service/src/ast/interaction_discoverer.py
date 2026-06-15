"""Agentic interaction discovery.

The LLM agent has tool access to the full structural store
(_calls.txt, _index.txt, _imports.txt, _inheritance.txt)
and source files. It uses its framework knowledge to identify
external interactions (data movements) by reading and interpreting
code — no hard-coded framework patterns.

Strategy is defined in the Haikai skill file:
  haikai-profiles/default/commands/discover-interactions/single-agent/discover-interactions.md
"""
import json
import logging
from pathlib import Path
from typing import Optional

from src.ast.models import InteractionInfo
from src.ast.enrichment_tools import TOOLS

logger = logging.getLogger(__name__)

MAX_AGENT_TURNS = 30
SKILL_FILE = Path(__file__).parent.parent.parent / "haikai-profiles" / "default" / "commands" / "discover-interactions" / "single-agent" / "discover-interactions.md"
ADAPTIVE_SKILL_FILE = Path(__file__).parent.parent.parent / "haikai-profiles" / "default" / "commands" / "discover-interactions" / "single-agent" / "adaptive.md"


def _load_system_prompt() -> str:
    """Load the discovery strategy from the Haikai skill file.

    `DISCOVERY_STRATEGY=adaptive` switches to adaptive.md (tool-investigation
    flow); default uses single-agent/discover-interactions.md.
    """
    import os as _os
    if _os.environ.get("DISCOVERY_STRATEGY", "").lower().strip() == "adaptive":
        skill_file = ADAPTIVE_SKILL_FILE
    else:
        skill_file = SKILL_FILE
    try:
        return skill_file.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning(f"Skill file not found: {skill_file}, using fallback")
        return (
            "You are discovering external interactions in a codebase. "
            "Use tools to read structural store data and source code. "
            "Identify all data movements. Respond with FINAL_ANSWER as JSON array."
        )


def _build_data_availability(snapshot_path: str) -> str:
    """Assess what structural data is available."""
    snapshot = Path(snapshot_path)
    parts = []
    for store_file, label in [
        ("_imports.txt", "imports"),
        ("_calls.txt", "call graph"),
        ("_index.txt", "symbol index"),
        ("_inheritance.txt", "inheritance"),
    ]:
        p = snapshot / store_file
        if p.exists():
            lines = [l for l in p.read_text(encoding="utf-8", errors="replace").splitlines()
                     if not l.startswith("#") and l.strip()]
            if lines:
                parts.append(f"  {label}: {len(lines)} entries")
            else:
                parts.append(f"  {label}: EMPTY")
        else:
            parts.append(f"  {label}: not available")
    return "\n".join(parts)


def discover_interactions(
    llm_client,
    project_root: str = ".",
    snapshot_path: str = None,
) -> list[InteractionInfo]:
    """Discover interactions using an agentic LLM with structural store tools.

    The LLM reads the structural store (imports, calls, index) and source
    files to identify external interactions using its framework knowledge.
    No hard-coded pattern matching.

    Args:
        llm_client: LLM client for agent interaction.
        project_root: Root path for source file reading.
        snapshot_path: Path to structural store snapshot.

    Returns:
        List of discovered InteractionInfo objects.
    """
    if not llm_client:
        logger.info("No LLM client — skipping interaction discovery")
        return []

    if not snapshot_path:
        logger.warning("No snapshot path — interaction discovery requires structural store")
        return []

    availability = _build_data_availability(snapshot_path)
    # Fold skill instructions into the user message so the discovery is
    # self-contained per turn. The Claude Max proxy uses CLI-resume mode
    # which keeps system + history in local session state across calls;
    # if a resumed session has stale context (e.g. earlier debugging),
    # an under-specified user message lets Claude operate on cached context
    # instead of the target codebase. Same fix as diagram_discoverer
    # (commit 75e0e7e).
    skill_instructions = _load_system_prompt()
    user_msg = (
        f"{skill_instructions}\n\n"
        f"---\n\n"
        f"# Task context\n\n"
        f"**Codebase root:** `{project_root}`\n"
        f"**Structural snapshot:** `{snapshot_path}`\n\n"
        f"**Data availability:**\n{availability}\n\n"
        "Discover all external interactions (data movements) in this codebase. "
        "If imports and call graph are available, use them to detect libraries. "
        "If they are EMPTY, use list_files, grep, read_directory, read_index, "
        "and read_source to discover interactions directly from code. "
        "Respond with FINAL_ANSWER as a JSON array of InteractionInfo objects."
    )

    messages = [
        {"role": "user", "content": user_msg},
    ]

    interactions: list[InteractionInfo] = []

    for turn in range(MAX_AGENT_TURNS):
        try:
            response = llm_client.generate(messages=messages, max_tokens=4000)
            if not isinstance(response, str):
                response = str(response)
        except Exception as e:
            logger.warning(f"Interaction discovery agent call failed on turn {turn + 1}/{MAX_AGENT_TURNS}: {e}")
            if interactions:
                logger.info(f"Returning {len(interactions)} interactions discovered before failure")
            break

        if "FINAL_ANSWER" in response:
            interactions = _parse_interaction_answer(response)
            break
        
        # GPT-5.4+ may return bare JSON array without FINAL_ANSWER prefix
        stripped = response.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            interactions = _parse_bare_json(stripped)
            if interactions:
                break

        tool_result = _execute_tool_call(response, project_root, snapshot_path)
        if tool_result:
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": f"Tool result:\n{tool_result}"})
        else:
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": "Please provide your FINAL_ANSWER now as a JSON array."})

    # If we exhausted turns without a final answer
    if turn == MAX_AGENT_TURNS - 1 and not interactions:
        logger.warning(f"Interaction discovery reached max turns ({MAX_AGENT_TURNS}) without finding interactions")

    # Save conversation trace for debugging (mirrors diagram_discoverer / discovery_loop._save_trace)
    try:
        import tempfile
        model = getattr(llm_client, "model", "unknown")
        trace_file = Path(tempfile.gettempdir()) / f"interaction_trace_{model}.json"
        trace_file.write_text(
            json.dumps(messages, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info(f"Interaction conversation trace saved to: {trace_file}")
    except Exception as e:
        logger.warning(f"Failed to save interaction trace: {e}")

    logger.info(f"Interaction discovery complete: {len(interactions)} interactions found in {turn + 1} turn(s)")
    return interactions


def _execute_tool_call(response: str, project_root: str, snapshot_path: str) -> Optional[str]:
    """Parse and execute a tool call from the LLM response."""
    if "TOOL_CALL:" not in response:
        return None

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
            return f"Unknown tool: {tool_name}. Available: {', '.join(TOOLS.keys())}"

        kwargs = _parse_tool_args(args_str)

        try:
            tool_fn = TOOLS[tool_name]["function"]
            if tool_name in ("read_source", "list_files", "grep", "read_directory"):
                result = tool_fn(project_root, **kwargs)
            elif snapshot_path:
                result = tool_fn(snapshot_path, **kwargs)
            else:
                result = "(no snapshot path available)"
            return result
        except Exception as e:
            logger.warning(f"Tool execution failed for {tool_name}({kwargs}): {e}")
            return f"Tool error in {tool_name}: {e}"

    return None


def _parse_tool_args(args_str: str) -> dict:
    """Parse tool call arguments — supports both keyword and positional forms."""
    import re
    kwargs = {}
    for match in re.finditer(r'(\w+)\s*=\s*"([^"]*)"', args_str):
        key, value = match.group(1), match.group(2)
        if key in ("start_line", "end_line"):
            kwargs[key] = int(value)
        else:
            kwargs[key] = value
    for match in re.finditer(r'(\w+)\s*=\s*(\d+)', args_str):
        key, value = match.group(1), int(match.group(2))
        if key not in kwargs:
            kwargs[key] = value
    if kwargs:
        return kwargs
    # Positional fallback
    positional = []
    for match in re.finditer(r'"([^"]*)"|\'([^\']*)\'|(\d+)', args_str):
        val = match.group(1) or match.group(2) or match.group(3)
        positional.append(val)
    if len(positional) == 1:
        kwargs["file_pattern"] = positional[0]
    elif len(positional) == 2:
        kwargs["file_path"] = positional[0]
        try:
            kwargs["start_line"] = int(positional[1])
        except ValueError:
            kwargs["function_name"] = positional[1]
    elif len(positional) >= 3:
        kwargs["file_path"] = positional[0]
        try:
            kwargs["start_line"] = int(positional[1])
            kwargs["end_line"] = int(positional[2])
        except ValueError:
            pass
    return kwargs


def _parse_bare_json(response: str) -> list[InteractionInfo]:
    """Parse a bare JSON array (no FINAL_ANSWER prefix) into InteractionInfo list."""
    try:
        results = json.loads(response)
        if not isinstance(results, list) or not results:
            return []
        if not isinstance(results[0], dict) or "target_type" not in results[0]:
            return []
        return [
            InteractionInfo(
                source_class=item.get("source_class", ""),
                source_method=item.get("source_method", ""),
                target=item.get("target", ""),
                target_type=item.get("target_type", "UNKNOWN"),
                direction=item.get("direction", "REQUEST_RESPONSE"),
                mechanism=item.get("mechanism", ""),
                data_hint=item.get("data_hint", ""),
                file=item.get("file", ""),
                line=item.get("line", 0),
                confidence=item.get("confidence", 0.75),
            )
            for item in results if isinstance(item, dict)
        ]
    except (json.JSONDecodeError, ValueError):
        return []


def _parse_interaction_answer(response: str) -> list[InteractionInfo]:
    """Parse FINAL_ANSWER JSON into InteractionInfo list."""
    idx = response.index("FINAL_ANSWER")
    json_str = response[idx + len("FINAL_ANSWER"):].strip().lstrip(":").strip()

    if "```" in json_str:
        lines = json_str.splitlines()
        lines = [l for l in lines if not l.strip().startswith("```")]
        json_str = "\n".join(lines).strip()

    bracket_start = json_str.find("[")
    bracket_end = json_str.rfind("]")
    if bracket_start < 0 or bracket_end <= bracket_start:
        logger.warning("No JSON array found in FINAL_ANSWER")
        return []

    json_str = json_str[bracket_start:bracket_end + 1]

    try:
        results = json.loads(json_str)
        if not isinstance(results, list):
            return []

        interactions = []
        for item in results:
            if not isinstance(item, dict):
                continue
            interactions.append(InteractionInfo(
                source_class=item.get("source_class", ""),
                source_method=item.get("source_method", ""),
                target=item.get("target", ""),
                target_type=item.get("target_type", "UNKNOWN"),
                direction=item.get("direction", "REQUEST_RESPONSE"),
                mechanism=item.get("mechanism", ""),
                data_hint=item.get("data_hint", ""),
                file=item.get("file", ""),
                line=item.get("line", 0),
                confidence=item.get("confidence", 0.75),
            ))
        return interactions

    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse interaction FINAL_ANSWER: {e}")
        return []
