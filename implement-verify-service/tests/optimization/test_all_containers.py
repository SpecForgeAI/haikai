"""
Comprehensive optimization testing across all containers.
Tests baseline vs caching vs early-exit vs combined.

Usage:
    python tests/optimization/test_all_containers.py
"""

import requests
import time
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple
from dataclasses import dataclass, asdict


@dataclass
class TestResult:
    """Results from a single test run."""
    optimization: str
    port: int
    company: str
    doc_count: int
    success: bool
    duration_seconds: float
    outputs: List[str]
    errors: List[str]
    timestamp: str


# Real test documents - varied types and sizes
TEST_DOCUMENTS = {
    "small_tech_stack": {
        "name": "Google Java Style Guide",
        "urls": ["https://google.github.io/styleguide/javaguide.html"],
        "expected_techs": ["Java"],
        "size": "small"
    },
    "medium_react": {
        "name": "React Documentation",
        "urls": ["https://react.dev/learn"],
        "expected_techs": ["React", "JavaScript", "JSX"],
        "size": "medium"
    },
    "large_aws": {
        "name": "AWS Well-Architected Framework",
        "urls": ["https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html"],
        "expected_techs": ["AWS"],
        "size": "large"
    },
    "multi_doc": {
        "name": "Multiple Docs (Python + Django + PostgreSQL)",
        "urls": [
            "https://docs.python.org/3/tutorial/index.html",
            "https://docs.djangoproject.com/en/stable/intro/tutorial01/",
            "https://www.postgresql.org/docs/current/tutorial.html"
        ],
        "expected_techs": ["Python", "Django", "PostgreSQL"],
        "size": "multi"
    },
    "irrelevant": {
        "name": "Non-Technical Document (should early-exit fast)",
        "urls": ["https://en.wikipedia.org/wiki/History_of_computing"],
        "expected_techs": [],
        "size": "irrelevant"
    }
}

CONTAINERS = {
    "baseline": {"port": 8000, "description": "Current optimized chunking (22x speedup)"},
    "caching": {"port": 8002, "description": "Baseline + document/LLM caching"},
    "early-exit": {"port": 8003, "description": "Baseline + smart irrelevant doc detection"},
    "combined": {"port": 8004, "description": "All optimizations enabled"}
}

AUTH_TOKEN = "changeit"


def run_test(optimization: str, port: int, test_case: Dict, company: str) -> TestResult:
    """Run a single test against a container."""
    print(f"\n{'='*60}")
    print(f"Testing: {optimization.upper()} (port {port})")
    print(f"Test Case: {test_case['name']}")
    print(f"{'='*60}")
    
    url = f"http://localhost:{port}/api/v1/standards/global/generate"
    headers = {
        "Authorization": f"Bearer {AUTH_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "company": company,
        "technical_documents": {
            "tech_stack": test_case["urls"]
        }
    }
    
    start_time = time.time()
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=600)
        duration = time.time() - start_time
        
        if response.status_code == 200:
            result = response.json()
            success = result.get("success", False)
            outputs = result.get("outputs", [])
            errors = result.get("errors", [])
            
            print(f"✓ Success: {success}")
            print(f"⏱ Duration: {duration:.2f}s")
            print(f"📄 Outputs: {len(outputs)} files")
            
            return TestResult(
                optimization=optimization,
                port=port,
                company=company,
                doc_count=len(test_case["urls"]),
                success=success,
                duration_seconds=duration,
                outputs=outputs,
                errors=errors if errors else [],
                timestamp=datetime.now().isoformat()
            )
        else:
            duration = time.time() - start_time
            print(f"✗ HTTP Error: {response.status_code}")
            print(f"⏱ Duration: {duration:.2f}s")
            
            return TestResult(
                optimization=optimization,
                port=port,
                company=company,
                doc_count=len(test_case["urls"]),
                success=False,
                duration_seconds=duration,
                outputs=[],
                errors=[f"HTTP {response.status_code}: {response.text}"],
                timestamp=datetime.now().isoformat()
            )
    
    except Exception as e:
        duration = time.time() - start_time
        print(f"✗ Exception: {str(e)}")
        print(f"⏱ Duration: {duration:.2f}s")
        
        return TestResult(
            optimization=optimization,
            port=port,
            company=company,
            doc_count=len(test_case["urls"]),
            success=False,
            duration_seconds=duration,
            outputs=[],
            errors=[str(e)],
            timestamp=datetime.now().isoformat()
        )


def run_all_tests() -> List[TestResult]:
    """Run all tests across all containers."""
    results = []
    
    print("\n" + "="*60)
    print("OPTIMIZATION TESTING SUITE")
    print("="*60)
    print(f"Test Cases: {len(TEST_DOCUMENTS)}")
    print(f"Containers: {len(CONTAINERS)}")
    print(f"Total Tests: {len(TEST_DOCUMENTS) * len(CONTAINERS)}")
    print("="*60)
    
    for test_name, test_case in TEST_DOCUMENTS.items():
        for opt_name, opt_config in CONTAINERS.items():
            company = f"Test_{test_name}_{opt_name}"
            
            result = run_test(
                optimization=opt_name,
                port=opt_config["port"],
                test_case=test_case,
                company=company
            )
            results.append(result)
            
            # Brief pause between tests
            time.sleep(2)
    
    return results


def generate_report(results: List[TestResult]) -> str:
    """Generate comparison report from test results."""
    report = []
    report.append("\n" + "="*80)
    report.append("OPTIMIZATION TEST RESULTS")
    report.append("="*80 + "\n")
    
    # Group by optimization
    by_optimization = {}
    for result in results:
        if result.optimization not in by_optimization:
            by_optimization[result.optimization] = []
        by_optimization[result.optimization].append(result)
    
    # Summary table
    report.append("SUMMARY BY OPTIMIZATION")
    report.append("-" * 80)
    report.append(f"{'Optimization':<15} {'Tests':<8} {'Success':<10} {'Avg Time':<12} {'Total Time':<12}")
    report.append("-" * 80)
    
    for opt_name, opt_results in sorted(by_optimization.items()):
        total_tests = len(opt_results)
        successful = sum(1 for r in opt_results if r.success)
        avg_time = sum(r.duration_seconds for r in opt_results) / total_tests
        total_time = sum(r.duration_seconds for r in opt_results)
        
        report.append(
            f"{opt_name:<15} {total_tests:<8} {successful}/{total_tests:<8} "
            f"{avg_time:<12.2f}s {total_time:<12.2f}s"
        )
    
    report.append("-" * 80 + "\n")
    
    # Detailed results by test case
    report.append("DETAILED RESULTS BY TEST CASE")
    report.append("-" * 80)
    
    for test_name, test_case in TEST_DOCUMENTS.items():
        report.append(f"\n{test_case['name']} ({test_case['size']})")
        report.append(f"  Docs: {len(test_case['urls'])}")
        report.append(f"  Expected: {', '.join(test_case['expected_techs']) if test_case['expected_techs'] else 'None (irrelevant)'}")
        report.append("  Results:")
        
        test_results = [r for r in results if test_name in r.company.lower()]
        
        for result in sorted(test_results, key=lambda x: x.optimization):
            status = "✓" if result.success else "✗"
            report.append(
                f"    {status} {result.optimization:<12} - {result.duration_seconds:>6.2f}s - "
                f"{len(result.outputs)} outputs"
            )
            if result.errors:
                for error in result.errors:
                    report.append(f"      Error: {error}")
    
    report.append("\n" + "="*80)
    
    # Winner analysis
    report.append("\nWINNER ANALYSIS")
    report.append("-" * 80)
    
    fastest_by_case = {}
    for test_name in TEST_DOCUMENTS.keys():
        test_results = [r for r in results if test_name in r.company.lower() and r.success]
        if test_results:
            fastest = min(test_results, key=lambda x: x.duration_seconds)
            fastest_by_case[test_name] = fastest
    
    for test_name, winner in fastest_by_case.items():
        report.append(f"  {TEST_DOCUMENTS[test_name]['name']}")
        report.append(f"    Winner: {winner.optimization} ({winner.duration_seconds:.2f}s)")
    
    report.append("\n" + "="*80 + "\n")
    
    return "\n".join(report)


def main():
    """Main test runner."""
    # Run all tests
    results = run_all_tests()
    
    # Generate report
    report = generate_report(results)
    print(report)
    
    # Save results
    output_dir = Path("tests/optimization/results")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Save JSON
    json_path = output_dir / f"test_results_{timestamp}.json"
    with open(json_path, 'w') as f:
        json.dump([asdict(r) for r in results], f, indent=2)
    
    print(f"JSON results saved: {json_path}")
    
    # Save report
    report_path = output_dir / f"test_report_{timestamp}.txt"
    with open(report_path, 'w') as f:
        f.write(report)
    
    print(f"Report saved: {report_path}")


if __name__ == "__main__":
    main()
