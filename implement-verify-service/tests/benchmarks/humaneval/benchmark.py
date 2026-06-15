"""
HumanEval Benchmark Adapter for Standards Extractor.

Loads the 164 HumanEval problems, sends them through the Standards Extractor
API in whichever mode is selected, extracts code from the response, and
evaluates correctness by executing against HumanEval's test suites.

Evaluation uses OpenAI's human_eval package for sandboxed execution +
pass@k computation.
"""

import json
import logging
import re
import tempfile
from pathlib import Path
from typing import Any, Optional

from human_eval.data import read_problems, HUMAN_EVAL, write_jsonl
from human_eval.evaluation import evaluate_functional_correctness

from benchmarks.runner.base_benchmark import BaseBenchmark
from benchmarks.runner.config import BenchmarkConfig

logger = logging.getLogger(__name__)


class HumanEvalBenchmark(BaseBenchmark):
    """HumanEval: 164 function-level Python coding problems."""

    name = "humaneval"

    def __init__(self, config: BenchmarkConfig):
        super().__init__(config)
        self._problems_dict: Optional[dict] = None

    # ------------------------------------------------------------------
    # Dataset
    # ------------------------------------------------------------------

    def load_dataset(self) -> list[dict[str, Any]]:
        """Load all 164 HumanEval problems from the installed package."""
        logger.info("Loading HumanEval dataset from human_eval package")
        self._problems_dict = read_problems(HUMAN_EVAL)
        problems = list(self._problems_dict.values())
        logger.info(f"Loaded {len(problems)} HumanEval problems")
        return problems

    # ------------------------------------------------------------------
    # Prompt adaptation
    # ------------------------------------------------------------------

    def adapt_problem(self, problem: dict[str, Any]) -> str:
        """Transform a HumanEval problem into a prompt for the API.

        Strategy: give the model the function signature + docstring and ask
        it to complete ONLY the function body.  We explicitly instruct it
        to return raw Python code (no markdown fences) so extraction is
        simpler.
        """
        prompt = problem["prompt"]
        entry_point = problem["entry_point"]

        return (
            "Complete the following Python function. "
            "Return ONLY the function body (the code that goes after the function signature). "
            "Do NOT repeat the function signature or docstring. "
            "Do NOT wrap your answer in markdown code fences. "
            "Return raw Python code only.\n\n"
            f"{prompt}"
        )

    # ------------------------------------------------------------------
    # Code extraction
    # ------------------------------------------------------------------

    @staticmethod
    def extract_code(response: str, problem: dict[str, Any]) -> str:
        """Extract the function completion from an LLM response.

        The LLM may return:
          1. Raw indented code (ideal)
          2. Code wrapped in ```python ... ``` fences
          3. The full function (signature + body)
          4. Explanatory text mixed with code

        We try multiple strategies and return the best extraction.
        """
        prompt = problem["prompt"]
        entry_point = problem["entry_point"]

        # ----------------------------------------------------------
        # Strategy 1: Extract from markdown code fence
        # ----------------------------------------------------------
        fence_pattern = r"```(?:python)?\s*\n(.*?)```"
        fences = re.findall(fence_pattern, response, re.DOTALL)
        if fences:
            # Use the longest fenced block (most likely the answer)
            code = max(fences, key=len)
            body = _strip_signature(code, entry_point, prompt)
            if body.strip():
                return body

        # ----------------------------------------------------------
        # Strategy 2: Response is raw code (no fences)
        # ----------------------------------------------------------
        # If the response starts with whitespace (indented body), use it directly
        stripped = response.strip()
        if stripped and not stripped.startswith("def ") and not stripped.startswith("#"):
            # Looks like raw body code — indent it properly if needed
            body = _ensure_indented(stripped)
            if body.strip():
                return body

        # ----------------------------------------------------------
        # Strategy 3: Response contains the full function definition
        # ----------------------------------------------------------
        body = _strip_signature(stripped, entry_point, prompt)
        if body.strip():
            return body

        # ----------------------------------------------------------
        # Strategy 4: Fallback — take everything after the first line
        # that looks like non-code explanation
        # ----------------------------------------------------------
        lines = response.split("\n")
        code_lines = []
        in_code = False
        for line in lines:
            # Heuristic: code lines are indented or empty or contain Python keywords
            if (
                line.startswith("    ")
                or line.startswith("\t")
                or line.strip() == ""
                or line.strip().startswith("return ")
                or line.strip().startswith("if ")
                or line.strip().startswith("for ")
                or line.strip().startswith("while ")
                or "=" in line
            ):
                in_code = True
                code_lines.append(line)
            elif in_code:
                # Stop at the first non-code line after we've started
                break

        if code_lines:
            return _ensure_indented("\n".join(code_lines))

        # Last resort: return the entire response and hope for the best
        logger.warning(
            f"Could not cleanly extract code for {problem.get('task_id', '?')}. "
            "Using raw response."
        )
        return _ensure_indented(response)

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------

    def evaluate(self, generated: str, problem: dict[str, Any]) -> tuple[bool, float]:
        """Evaluate a single completion using HumanEval's test execution.

        We build the full program (prompt + completion + test), exec it in
        a subprocess, and check if all assertions pass.

        Tries two strategies:
          1. Use extracted/cleaned code
          2. If that fails, try the raw generated text (it might already be
             a valid function body with correct indentation)
        """
        task_id = problem["task_id"]
        entry_point = problem["entry_point"]
        prompt = problem["prompt"]
        test = problem["test"]

        # Strategy 1: extract and clean the code
        completion = self.extract_code(generated, problem)
        full_code = prompt + completion + "\n" + test + f"\ncheck({entry_point})\n"
        passed = _execute_code_safely(full_code, timeout=10.0)

        if not passed:
            # Strategy 2: try raw generated text (might already be indented correctly)
            raw_completion = generated
            full_code_raw = prompt + raw_completion + "\n" + test + f"\ncheck({entry_point})\n"
            passed = _execute_code_safely(full_code_raw, timeout=10.0)

        score = 1.0 if passed else 0.0

        if not passed:
            logger.debug(f"FAIL {task_id}: completion starts with: {completion[:100]!r}")

        return passed, score

    def get_expected_output(self, problem: dict[str, Any]) -> str:
        """Return the canonical solution for failure logging."""
        return problem.get("canonical_solution", "")

    def get_standards_context(self, problems: list[dict]) -> str:
        """Python coding standards for Mode B.

        These are intentionally practical and HumanEval-relevant:
        focus on correctness patterns that help with typical failures.
        """
        return """\
# Python Coding Standards

## Correctness
- Always handle edge cases: empty lists, empty strings, zero, negative numbers, single-element inputs
- Use `//` for integer division when the result should be an integer
- Prefer `math.gcd` or Euclidean algorithm for GCD; avoid naive approaches
- For floating-point comparisons, use `abs(a - b) < threshold` not `==`
- Remember that `range(n)` goes from 0 to n-1 inclusive

## Style
- Use type hints matching the function signature
- Prefer list comprehensions for simple transforms
- Use `enumerate()` when you need both index and value
- Use `collections.Counter` or `set()` for frequency/uniqueness problems
- Use `itertools` for combinations/permutations when appropriate

## Common Pitfalls
- String slicing: `s[i:j]` excludes index j
- Modifying a list while iterating over it causes bugs; iterate over a copy
- `sorted()` returns a new list; `list.sort()` modifies in place and returns None
- Integer overflow is not an issue in Python (arbitrary precision)
- `bool` is a subclass of `int` in Python: `True == 1`, `False == 0`
"""

    # ------------------------------------------------------------------
    # Batch evaluation using human_eval package
    # ------------------------------------------------------------------

    def evaluate_batch(self, completions: list[dict]) -> dict:
        """Run the official HumanEval evaluation on a batch of completions.

        Args:
            completions: list of {"task_id": str, "completion": str}

        Returns:
            dict with pass@k scores from evaluate_functional_correctness
        """
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            for item in completions:
                f.write(json.dumps(item) + "\n")
            samples_path = f.name

        try:
            results = evaluate_functional_correctness(
                sample_file=samples_path,
                k=[1],
                n_workers=4,
                timeout=10.0,
            )
            return results
        finally:
            Path(samples_path).unlink(missing_ok=True)


# ======================================================================
# Helper functions
# ======================================================================

def _strip_signature(code: str, entry_point: str, prompt: str) -> str:
    """If code contains the function signature, strip it and return only the body."""
    lines = code.split("\n")

    # Find the line with `def entry_point(`
    sig_idx = None
    for i, line in enumerate(lines):
        if re.match(rf"\s*def\s+{re.escape(entry_point)}\s*\(", line):
            sig_idx = i
            break

    if sig_idx is None:
        return code

    # Skip past the signature and any docstring
    body_start = sig_idx + 1

    # Skip docstring if present
    if body_start < len(lines):
        stripped_line = lines[body_start].strip()
        if stripped_line.startswith('"""') or stripped_line.startswith("'''"):
            quote = stripped_line[:3]
            if stripped_line.count(quote) >= 2:
                # Single-line docstring
                body_start += 1
            else:
                # Multi-line docstring
                for j in range(body_start + 1, len(lines)):
                    if quote in lines[j]:
                        body_start = j + 1
                        break

    body_lines = lines[body_start:]
    return "\n".join(body_lines)


def _ensure_indented(code: str) -> str:
    """Ensure code is indented by at least 4 spaces (function body level).
    
    If the code has NO leading indentation on its first non-empty line,
    we add 4 spaces to every non-empty line. If it's already indented,
    we leave it as-is.
    """
    lines = code.split("\n")
    
    # Find the first non-empty line to check indentation
    first_content_line = None
    for line in lines:
        if line.strip():
            first_content_line = line
            break
    
    if first_content_line is None:
        return code
    
    # If the first content line is already indented, assume the whole block is correct
    if first_content_line.startswith("    ") or first_content_line.startswith("\t"):
        return code
    
    # Otherwise, add 4-space indent to every line
    result = []
    for line in lines:
        if line.strip() == "":
            result.append("")
        else:
            result.append("    " + line)
    return "\n".join(result)


def _execute_code_safely(code: str, timeout: float = 10.0) -> bool:
    """Execute code in a subprocess and return True if it exits cleanly."""
    import subprocess
    import sys

    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        logger.debug("Execution timed out")
        return False
    except Exception as e:
        logger.debug(f"Execution error: {e}")
        return False
