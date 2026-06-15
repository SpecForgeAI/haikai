#!/usr/bin/env python3
"""
Standalone HumanEval runner using direct LLM calls.

This bypasses the Standards Extractor API and calls LLM providers directly.
Used for establishing raw LLM baselines (Mode A) and standards-enhanced
baselines (Mode B) without requiring the full application stack.

Usage:
    python -m benchmarks.humaneval.run --model claude-sonnet-4-5-20250929 --provider anthropic --limit 10
    python -m benchmarks.humaneval.run --model gpt-4.1-mini --provider openai --mode with_standards
    python -m benchmarks.humaneval.run --model claude-sonnet-4-5-20250929 --provider anthropic  # all 164

Results are saved to benchmarks/results/humaneval/{model}/{timestamp}/
"""

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from human_eval.data import read_problems, HUMAN_EVAL

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from benchmarks.humaneval.benchmark import HumanEvalBenchmark
from benchmarks.humaneval.direct_llm import DirectLLMClient, DirectLLMResponse
from benchmarks.runner.results import BenchmarkResults, ProblemResult, ResultsManager

logger = logging.getLogger(__name__)


STANDARDS_CONTEXT = """\
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


def build_prompt(problem: dict, mode: str = "direct") -> tuple[str, str]:
    """Build prompt and system message for a HumanEval problem.
    
    Returns: (user_prompt, system_prompt)
    """
    func_prompt = problem["prompt"]

    user_msg = (
        "Complete the following Python function. "
        "Return ONLY the function body (the code that goes after the function signature). "
        "Do NOT repeat the function signature or docstring. "
        "Do NOT wrap your answer in markdown code fences. "
        "Return raw Python code only.\n\n"
        f"{func_prompt}"
    )

    system_msg = ""
    if mode == "with_standards":
        system_msg = STANDARDS_CONTEXT

    return user_msg, system_msg


def run_benchmark(
    model_name: str,
    provider: str,
    mode: str = "direct",
    limit: Optional[int] = None,
    verbose: bool = False,
) -> BenchmarkResults:
    """Run HumanEval benchmark with direct LLM calls."""

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    # Load dataset
    logger.info("Loading HumanEval dataset...")
    all_problems = read_problems(HUMAN_EVAL)
    dataset = list(all_problems.values())
    if limit:
        dataset = dataset[:limit]
    total = len(dataset)
    logger.info(f"Running {total} problems | model={model_name} | mode={mode}")

    # Initialize
    llm = DirectLLMClient(model_name, provider)
    bench = HumanEvalBenchmark.__new__(HumanEvalBenchmark)  # just for evaluate/extract
    results_mgr = ResultsManager(
        base_dir="benchmarks/results",
        repo_root=str(PROJECT_ROOT),
    )

    results = BenchmarkResults(
        benchmark="humaneval",
        model=model_name,
        mode=mode,
        timestamp=timestamp,
        config_snapshot={
            "model": model_name,
            "provider": provider,
            "mode": mode,
            "limit": limit,
            "total_in_dataset": 164,
            "client": "direct_llm",
        },
    )

    total_input_tokens = 0
    total_output_tokens = 0

    try:
        for i, problem in enumerate(dataset):
            task_id = problem["task_id"]
            logger.info(f"[{i+1}/{total}] {task_id}")

            user_prompt, system_prompt = build_prompt(problem, mode)

            # Call LLM
            start = time.monotonic()
            response = llm.generate(user_prompt, system=system_prompt)
            latency = time.monotonic() - start

            if response.success:
                total_input_tokens += response.input_tokens
                total_output_tokens += response.output_tokens

                # Evaluate
                passed, score = bench.evaluate(response.content, problem)
            else:
                passed, score = False, 0.0

            status = "✅" if passed else "❌"
            if verbose or not passed:
                logger.info(f"  {status} {task_id} ({latency:.1f}s)")

            result = ProblemResult(
                problem_id=task_id,
                passed=passed,
                score=score,
                generated_output=response.content[:10000],
                expected_output=problem.get("canonical_solution", "")[:5000],
                error=response.error,
                latency_seconds=latency,
                mode=mode,
                model=model_name,
                metadata={
                    "input_tokens": response.input_tokens,
                    "output_tokens": response.output_tokens,
                    "actual_model": response.model,
                },
            )
            results.problems.append(result)

            # Progress every 10
            if (i + 1) % 10 == 0 or (i + 1) == total:
                done = sum(1 for p in results.problems if p.passed)
                logger.info(
                    f"Progress: {i+1}/{total} done, "
                    f"{done}/{i+1} passed ({done/(i+1):.1%}) | "
                    f"tokens: {total_input_tokens:,}in/{total_output_tokens:,}out"
                )

    except KeyboardInterrupt:
        logger.warning("Interrupted! Saving partial results...")
    finally:
        llm.close()

    # Compute stats
    results.compute_stats()

    # Save
    run_dir = results_mgr.save(results, create_symlink=True)

    # Add token usage to the report
    token_report = (
        f"\n## Token Usage\n\n"
        f"| Metric | Value |\n"
        f"|--------|-------|\n"
        f"| Input Tokens | {total_input_tokens:,} |\n"
        f"| Output Tokens | {total_output_tokens:,} |\n"
        f"| Total Tokens | {total_input_tokens + total_output_tokens:,} |\n"
    )
    report_path = run_dir / "report.md"
    report_path.write_text(report_path.read_text() + token_report)

    # Generate learnings template
    learnings = results_mgr.generate_learnings_template(results)
    (run_dir / "learnings.md").write_text(learnings)

    logger.info(
        f"\n{'='*60}\n"
        f"Benchmark: humaneval\n"
        f"Model:     {model_name}\n"
        f"Mode:      {mode}\n"
        f"{'='*60}\n"
        f"Total:     {results.total}\n"
        f"Passed:    {results.passed}\n"
        f"Failed:    {results.failed}\n"
        f"Errors:    {results.errors}\n"
        f"Pass Rate: {results.pass_rate:.1%}\n"
        f"Avg Time:  {results.avg_latency_seconds:.1f}s\n"
        f"Tokens:    {total_input_tokens:,}in / {total_output_tokens:,}out\n"
        f"Results:   {run_dir}\n"
        f"{'='*60}"
    )

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Run HumanEval benchmark with direct LLM calls",
    )
    parser.add_argument("--model", "-m", required=True, help="Model name (e.g., claude-sonnet-4-5-20250929)")
    parser.add_argument("--provider", "-p", required=True, choices=["anthropic", "openai"], help="LLM provider")
    parser.add_argument("--mode", default="direct", choices=["direct", "with_standards"], help="Evaluation mode")
    parser.add_argument("--limit", type=int, default=None, help="Max problems to run")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")

    args = parser.parse_args()

    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    results = run_benchmark(
        model_name=args.model,
        provider=args.provider,
        mode=args.mode,
        limit=args.limit,
        verbose=args.verbose,
    )

    sys.exit(0 if results.errors == 0 else 1)


if __name__ == "__main__":
    main()
