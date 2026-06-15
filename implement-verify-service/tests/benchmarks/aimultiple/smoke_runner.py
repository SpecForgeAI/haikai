#!/usr/bin/env python3
"""
YAML-driven HTTP smoke test runner for AIMultiple-style benchmarks.
Reads a YAML test spec, executes steps sequentially, saves variables, scores results.
"""
import re
import sys
import json
import yaml
import httpx
import argparse
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class StepResult:
    name: str
    passed: bool
    status_code: int = 0
    expected_status: str = ""
    response_body: Any = None
    error: str = ""


@dataclass
class SmokeTestResult:
    total: int = 0
    passed: int = 0
    failed: int = 0
    details: list[StepResult] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        return self.passed / self.total if self.total > 0 else 0.0


class SmokeTestRunner:
    """Execute YAML-defined smoke tests against a running backend."""

    def __init__(self, base_url: str = "http://localhost:9000", verbose: bool = False):
        self.base_url = base_url.rstrip("/")
        self.variables: dict[str, Any] = {}
        self.verbose = verbose

    def run(self, yaml_path: str) -> SmokeTestResult:
        with open(yaml_path) as f:
            spec = yaml.safe_load(f)

        # Override base_url from spec if present
        if "backend_url" in spec:
            self.base_url = spec["backend_url"].rstrip("/")

        steps = spec.get("steps", [])
        results = []

        for i, step in enumerate(steps, 1):
            result = self._execute_step(step)
            results.append(result)

            icon = "✅" if result.passed else "❌"
            print(f"  {icon} [{i}/{len(steps)}] {result.name}", end="")
            if not result.passed:
                print(f"  — got {result.status_code}, expected {result.expected_status}", end="")
                if result.error:
                    print(f" ({result.error})", end="")
            print()

            # Save variables if step defines save and step passed
            if result.passed and "save" in step:
                self._save_variables(step["save"], result.response_body, result.status_code)

        total = len(results)
        passed = sum(1 for r in results if r.passed)
        return SmokeTestResult(total=total, passed=passed, failed=total - passed, details=results)

    def _execute_step(self, step: dict) -> StepResult:
        name = step.get("name", "unnamed")
        method = step.get("method", "GET").upper()
        path = self._resolve_variables(step.get("path", "/"))
        headers = {"Content-Type": "application/json"}

        # Auth injection
        if "auth" in step:
            token = self.variables.get(step["auth"], "")
            if token:
                headers["Authorization"] = f"Bearer {token}"

        # Body
        body = None
        if "body" in step:
            body = self._resolve_body(step["body"])

        url = f"{self.base_url}{path}"

        try:
            if self.verbose:
                print(f"    → {method} {url}")
                if body:
                    print(f"    → Body: {json.dumps(body)[:200]}")

            response = httpx.request(
                method, url, json=body, headers=headers, timeout=15.0
            )

            response_body = None
            try:
                response_body = response.json()
            except Exception:
                response_body = response.text

            if self.verbose:
                print(f"    ← {response.status_code}: {json.dumps(response_body) if isinstance(response_body, (dict, list)) else str(response_body)[:200]}")

            passed, error = self._check_expect(step.get("expect", {}), response, response_body)

            return StepResult(
                name=name,
                passed=passed,
                status_code=response.status_code,
                expected_status=str(step.get("expect", {}).get("status", "any")),
                response_body=response_body,
                error=error,
            )

        except Exception as e:
            return StepResult(
                name=name, passed=False, error=str(e),
                expected_status=str(step.get("expect", {}).get("status", "any")),
            )

    def _check_expect(self, expect: dict, response, body) -> tuple[bool, str]:
        """Check all expectations. Returns (passed, error_message)."""
        if not expect:
            return True, ""

        # Status check
        if "status" in expect:
            allowed = [int(s.strip()) for s in str(expect["status"]).split("|")]
            if response.status_code not in allowed:
                return False, f"status {response.status_code} not in {allowed}"

        # JSON has fields
        if "json_has" in expect and isinstance(body, dict):
            for field_name in expect["json_has"]:
                if field_name not in body:
                    return False, f"missing field '{field_name}' in response"

        # Min length (for list responses)
        if "min_length" in expect:
            if isinstance(body, list) and len(body) < expect["min_length"]:
                return False, f"list length {len(body)} < {expect['min_length']}"

        # Max length
        if "max_length" in expect:
            if isinstance(body, list) and len(body) > expect["max_length"]:
                return False, f"list length {len(body)} > {expect['max_length']}"

        return True, ""

    def _save_variables(self, save: dict, body: Any, status_code: int):
        """Save response data to variables."""
        if "token_as" in save and isinstance(body, dict):
            token = body.get("access_token", body.get("token", ""))
            self.variables[save["token_as"]] = token
            if self.verbose:
                print(f"    💾 Saved {save['token_as']} = {token[:20]}...")

        if "json_as" in save and isinstance(body, dict):
            self.variables[save["json_as"]] = body
            if self.verbose:
                print(f"    💾 Saved {save['json_as']} = {json.dumps(body)[:100]}...")

    def _resolve_variables(self, text: str) -> str:
        """Replace $variable.path references."""
        def replacer(match):
            var_name = match.group(1)
            field_name = match.group(2) if match.group(2) else None
            val = self.variables.get(var_name)
            if val is None:
                return match.group(0)
            if field_name and isinstance(val, dict):
                val = val.get(field_name, match.group(0))
            return str(val)

        # Match $var.field or $var
        return re.sub(r'\$(\w+)(?:\.(\w+))?', replacer, text)

    def _resolve_body(self, body: Any) -> Any:
        """Resolve variables in request body."""
        if isinstance(body, str):
            return self._resolve_variables(body)
        if isinstance(body, dict):
            return {k: self._resolve_body(v) for k, v in body.items()}
        if isinstance(body, list):
            return [self._resolve_body(item) for item in body]
        return body


def main():
    parser = argparse.ArgumentParser(description="Run YAML smoke tests")
    parser.add_argument("yaml_file", help="Path to YAML test spec")
    parser.add_argument("--url", default=None, help="Override backend URL")
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    args = parser.parse_args()

    url = args.url or "http://localhost:9000"
    runner = SmokeTestRunner(base_url=url, verbose=args.verbose)

    print(f"\n🧪 Running smoke tests: {args.yaml_file}")
    print(f"   Target: {runner.base_url}\n")

    result = runner.run(args.yaml_file)

    print(f"\n{'='*50}")
    print(f"Results: {result.passed}/{result.total} passed ({result.pass_rate:.1%})")
    print(f"{'='*50}\n")

    return 0 if result.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
