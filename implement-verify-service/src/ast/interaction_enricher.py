"""Agentic interaction enrichment.

The LLM agent has tool access to the full structural store
(_calls.txt, _index.txt, _imports.txt, _inheritance.txt)
and source files. It decides what to read to resolve each
interaction's target and data_entity.

Strategy is defined in the Haikai skill file:
  haikai-profiles/default/commands/enrich-interactions/single-agent/enrich-interactions.md
"""
import json
import logging
from pathlib import Path
from typing import Optional

from src.ast.models import InteractionInfo
from src.ast.enrichment_tools import TOOLS, read_calls, read_index, read_source

logger = logging.getLogger(__name__)

MAX_AGENT_TURNS = 10  # max tool calls per enrichment batch
BATCH_SIZE = 5        # interactions per agent session (small for focused investigation)

SKILL_FILE = Path(__file__).parent.parent.parent / "haikai-profiles" / "default" / "commands" / "enrich-interactions" / "single-agent" / "enrich-interactions.md"


def _load_system_prompt() -> str:
    """Load the enrichment strategy from the Haikai skill file."""
    try:
        return SKILL_FILE.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        logger.warning(f"Skill file not found: {SKILL_FILE}, using fallback")
        return "You are enriching code interactions. Resolve target and data_entity using the available tools. Respond with FINAL_ANSWER as JSON array. Call tools with TOOL_CALL: name(param=\"value\")."


MAX_ENRICHMENT_ROUNDS = 3  # outer iteration rounds


def enrich_interactions(
    interactions: list[InteractionInfo],
    llm_client,
    project_root: str = ".",
    snapshot_path: str = None,
) -> list[InteractionInfo]:
    """Enrich interactions using an agentic LLM with structural store tools.

    Iterates until all resolved or no progress:
    1. Collect unresolved interactions
    2. Batch and send to LLM agent
    3. Check what got resolved
    4. If progress made and unresolved remain → repeat
    5. Stop when all resolved, no progress, or max rounds
    """
    if not llm_client:
        return interactions

    for round_num in range(1, MAX_ENRICHMENT_ROUNDS + 1):
        unresolved = [(idx, i) for idx, i in enumerate(interactions) if _needs_enrichment(i)]
        if not unresolved:
            break

        logger.info(f"Enrichment round {round_num}: {len(unresolved)}/{len(interactions)} unresolved")

        # Process in batches
        for batch_start in range(0, len(unresolved), BATCH_SIZE):
            batch = unresolved[batch_start:batch_start + BATCH_SIZE]
            _enrich_batch_agentic(batch, interactions, llm_client, project_root, snapshot_path)

        # Check progress
        still_unresolved = sum(1 for i in interactions if _needs_enrichment(i))
        resolved_this_round = len(unresolved) - still_unresolved

        logger.info(f"Enrichment round {round_num}: resolved {resolved_this_round}, {still_unresolved} remaining")

        if resolved_this_round == 0:
            logger.info("No progress — stopping enrichment")
            break

    enriched = sum(1 for i in interactions if i.data_hint)
    logger.info(f"Enrichment complete: {enriched}/{len(interactions)} have data_hint")

    return interactions


def _enrich_batch_agentic(
    batch: list[tuple[int, InteractionInfo]],
    all_interactions: list[InteractionInfo],
    llm_client,
    project_root: str,
    snapshot_path: str,
):
    """Run agent loop for a batch of interactions."""
    # Format interactions for the prompt
    items = []
    for idx, interaction in batch:
        items.append({
            "index": idx,
            "source_class": interaction.source_class,
            "source_method": interaction.source_method,
            "target": interaction.target,
            "target_type": interaction.target_type,
            "mechanism": interaction.mechanism,
            "file": interaction.file,
            "line": interaction.line,
        })

    user_msg = f"""Enrich these interactions. Use tools to read the structural store and source code as needed.

{json.dumps(items, indent=2)}

Call tools to investigate, then respond with FINAL_ANSWER."""

    messages = [
        {"role": "system", "content": _load_system_prompt()},
        {"role": "user", "content": user_msg},
    ]

    for turn in range(MAX_AGENT_TURNS):
        try:
            response = llm_client.generate(messages=messages, max_tokens=2000)
            if not isinstance(response, str):
                response = str(response)
        except Exception as e:
            logger.warning(f"Enrichment agent call failed: {e}")
            break

        # Check for final answer
        if "FINAL_ANSWER" in response:
            _apply_final_answer(response, all_interactions)
            break

        # Check for tool calls
        tool_result = _execute_tool_call(response, project_root, snapshot_path)
        if tool_result:
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": f"Tool result:\n{tool_result}"})
        else:
            # No tool call and no final answer — ask LLM to conclude
            messages.append({"role": "assistant", "content": response})
            messages.append({"role": "user", "content": "Please provide your FINAL_ANSWER now as a JSON array."})


def _execute_tool_call(response: str, project_root: str, snapshot_path: str) -> Optional[str]:
    """Parse and execute a tool call from the LLM response."""
    if "TOOL_CALL:" not in response:
        return None

    # Parse: TOOL_CALL: tool_name(param="value", param2="value2")
    for line in response.splitlines():
        line = line.strip()
        if not line.startswith("TOOL_CALL:"):
            continue

        call_str = line[len("TOOL_CALL:"):].strip()
        # Extract function name and args
        paren_idx = call_str.find("(")
        if paren_idx == -1:
            continue

        tool_name = call_str[:paren_idx].strip()
        args_str = call_str[paren_idx + 1:].rstrip(")")

        if tool_name not in TOOLS:
            return f"Unknown tool: {tool_name}. Available: {', '.join(TOOLS.keys())}"

        # Parse args
        kwargs = _parse_tool_args(args_str)

        # Execute
        try:
            tool_fn = TOOLS[tool_name]["function"]
            if tool_name in ("read_source", "glob", "grep", "read_directory"):
                result = tool_fn(project_root, **kwargs)
            elif snapshot_path:
                result = tool_fn(snapshot_path, **kwargs)
            else:
                result = "(no snapshot path available — structural store not accessible)"
            return result
        except Exception as e:
            return f"Tool error: {e}"

    return None


def _parse_tool_args(args_str: str) -> dict:
    """Parse tool call arguments from string like: param="value", param2="value2"."""
    kwargs = {}
    # Simple parser for key="value" pairs
    import re
    for match in re.finditer(r'(\w+)\s*=\s*"([^"]*)"', args_str):
        key, value = match.group(1), match.group(2)
        if key in ("start_line", "end_line"):
            kwargs[key] = int(value)
        else:
            kwargs[key] = value
    # Also handle key=value without quotes for numbers
    for match in re.finditer(r'(\w+)\s*=\s*(\d+)', args_str):
        key, value = match.group(1), int(match.group(2))
        if key not in kwargs:
            kwargs[key] = value
    # Handle single positional string arg
    if not kwargs and args_str.strip().startswith('"'):
        kwargs["file_pattern"] = args_str.strip().strip('"')
    return kwargs


def _apply_final_answer(response: str, interactions: list[InteractionInfo]):
    """Parse FINAL_ANSWER JSON and apply to interactions."""
    # Extract JSON — find the array in the response
    import re

    # Try after FINAL_ANSWER marker
    idx = response.index("FINAL_ANSWER")
    json_str = response[idx + len("FINAL_ANSWER"):].strip().lstrip(":").strip()

    # Strip markdown fences
    if "```" in json_str:
        lines = json_str.splitlines()
        lines = [l for l in lines if not l.strip().startswith("```")]
        json_str = "\n".join(lines).strip()

    # Find JSON array in the text
    bracket_start = json_str.find("[")
    bracket_end = json_str.rfind("]")
    if bracket_start >= 0 and bracket_end > bracket_start:
        json_str = json_str[bracket_start:bracket_end + 1]

    try:
        results = json.loads(json_str)
        if not isinstance(results, list):
            return

        for item in results:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            if idx is None or idx >= len(interactions):
                continue

            interaction = interactions[idx]
            new_target = item.get("target", "")
            new_entity = item.get("data_entity", "")

            if new_target and new_target != interaction.target:
                interaction.target = new_target
            if new_entity and not interaction.data_hint:
                interaction.data_hint = new_entity

    except (json.JSONDecodeError, ValueError) as e:
        logger.warning(f"Failed to parse FINAL_ANSWER: {e}")


def _needs_enrichment(interaction: InteractionInfo) -> bool:
    """Check if an interaction needs LLM enrichment."""
    if not interaction.data_hint:
        return True
    # Target looks like a method call, not a resource name
    target = interaction.target
    if target and "." in target:
        parts = target.rsplit(".", 1)
        method = parts[-1]
        # Method names are typically camelCase or snake_case verbs
        if method and method[0].islower() and any(c.isupper() for c in method[1:]):
            return True
    return False
