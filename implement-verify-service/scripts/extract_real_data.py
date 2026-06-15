"""Extract real endpoint + interaction data from all test repos for spec planning."""
import json
import tempfile
from pathlib import Path

from src.ast.ctags_provider import CtagsProvider
from src.ast.store import FileStore
from src.ast.provider import ProviderRegistry
from src.ast.pipeline import run_structural_pipeline
from src.ast.extractors.endpoint_config import reset_caches


def norm(path, base):
    result = path.replace(base, "")
    result = result.lstrip("/").lstrip("\\")
    result = result.replace("\\", "/")
    return result


repos = {
    "standards-extractor": ("src", [".py"], "."),
    "yas": (None, [".java"], r"D:\Work\Gary\test-repos\yas"),
    "eShop": (None, [".cs"], r"D:\Work\Gary\test-repos\eShop"),
    "piggymetrics": (None, [".java"], r"D:\Work\Gary\test-repos\piggymetrics"),
    "go-kafka-grpc": (None, [".go"], r"D:\Work\Gary\test-repos\go-kafka-grpc"),
    "vendure": (None, [".ts"], r"D:\Work\Gary\test-repos\vendure"),
    "saleor": (None, [".py"], r"D:\Work\Gary\test-repos\saleor"),
}

output = {}

for name, (subdir, exts, root) in repos.items():
    reset_caches()
    base = Path(root)
    scan = base / subdir if subdir else base

    files = []
    for ext in exts:
        files.extend(
            str(f) for f in scan.rglob(f"*{ext}")
            if ".git" not in str(f) and "node_modules" not in str(f)
            and "vendor" not in str(f)
            and not any(p in f.name.lower() for p in ["test", "spec", "mock"])
        )
    files = files[:300]
    if not files:
        continue

    ctags = CtagsProvider()
    ctags_results = ctags.analyze_batch(files)
    if not ctags_results:
        continue

    with tempfile.TemporaryDirectory() as tmp:
        store = FileStore(
            base_path=str(Path(tmp) / "structural"),
            config={"diagrams": {"auto_generate": False}},
        )
        registry = ProviderRegistry()
        analyses = run_structural_pipeline(
            file_paths=files,
            ctags_results=ctags_results,
            store=store,
            registry=registry,
            repo_name=name,
            commit_sha="test",
            branch="main",
            project_root=str(base),
        )

        all_eps = [ep for a in analyses.values() for ep in a.endpoints]
        all_ints = [i for a in analyses.values() for i in a.interactions]

        repo_data = {
            "file_count": len(files),
            "endpoint_count": len(all_eps),
            "interaction_count": len(all_ints),
            "endpoints": [],
            "interactions": [],
        }

        for ep in all_eps:
            repo_data["endpoints"].append({
                "type": ep.type,
                "path": ep.path,
                "operation": ep.operation,
                "handler_class": ep.handler_class,
                "handler_method": ep.handler_method,
                "file": norm(ep.file, str(base)),
                "line": ep.line,
                "direction": ep.direction,
                "protocol": ep.protocol,
                "framework": ep.framework,
                "confidence": ep.confidence,
            })

        for i in all_ints:
            repo_data["interactions"].append({
                "source_class": i.source_class,
                "source_method": i.source_method,
                "target": i.target,
                "target_type": i.target_type,
                "direction": i.direction,
                "mechanism": i.mechanism,
                "data_hint": i.data_hint,
                "file": norm(i.file, str(base)),
                "line": i.line,
                "confidence": i.confidence,
            })

        output[name] = repo_data
        print(f"{name}: {len(files)} files, {len(all_eps)} endpoints, {len(all_ints)} interactions")

outpath = "haikai/specs/2026-04-06-metamodel-endpoint-interaction-mapping/planning/real-extraction-data.json"
with open(outpath, "w") as f:
    json.dump(output, f, indent=2)
print(f"Written to {outpath}")
