"""Deterministic framework detection from import patterns.

Scans all StructuralAnalysis results and identifies frameworks
by matching import modules against known signatures.
"""
import logging
from collections import Counter
from dataclasses import dataclass
from typing import Optional

from src.ast.models import StructuralAnalysis

logger = logging.getLogger(__name__)


@dataclass
class FrameworkMatch:
    """A detected framework with evidence."""
    name: str
    category: str           # web, frontend, orm, testing, validation, etc.
    confidence: float       # 0.0-1.0
    import_count: int       # how many files import it
    evidence: list[str]     # matching import modules


# Import prefix → (framework_name, category)
FRAMEWORK_SIGNATURES: dict[str, tuple[str, str]] = {
    # Python web
    "fastapi": ("FastAPI", "web"),
    "starlette": ("FastAPI", "web"),
    "django": ("Django", "web"),
    "flask": ("Flask", "web"),
    "tornado": ("Tornado", "web"),
    "aiohttp": ("aiohttp", "web"),
    # Python ORM/DB
    "sqlalchemy": ("SQLAlchemy", "orm"),
    "tortoise": ("Tortoise ORM", "orm"),
    "peewee": ("Peewee", "orm"),
    "mongoengine": ("MongoEngine", "orm"),
    "pymongo": ("PyMongo", "database"),
    "redis": ("Redis", "database"),
    # Python validation
    "pydantic": ("Pydantic", "validation"),
    "marshmallow": ("Marshmallow", "validation"),
    # Python testing
    "pytest": ("pytest", "testing"),
    "unittest": ("unittest", "testing"),
    # Python async
    "celery": ("Celery", "async"),
    "dramatiq": ("Dramatiq", "async"),
    # JavaScript/TypeScript
    "react": ("React", "frontend"),
    "react-dom": ("React", "frontend"),
    "vue": ("Vue.js", "frontend"),
    "angular": ("Angular", "frontend"),
    "next": ("Next.js", "frontend"),
    "express": ("Express.js", "web"),
    "nestjs": ("NestJS", "web"),
    "prisma": ("Prisma", "orm"),
    "typeorm": ("TypeORM", "orm"),
    "jest": ("Jest", "testing"),
    "mocha": ("Mocha", "testing"),
    "vitest": ("Vitest", "testing"),
    # Java
    "org.springframework": ("Spring", "web"),
    "javax.persistence": ("JPA", "orm"),
    "org.hibernate": ("Hibernate", "orm"),
    "org.junit": ("JUnit", "testing"),
    "org.mockito": ("Mockito", "testing"),
    "io.micronaut": ("Micronaut", "web"),
    "io.quarkus": ("Quarkus", "web"),
    "lombok": ("Lombok", "utility"),
    # C#
    "Microsoft.AspNetCore": ("ASP.NET Core", "web"),
    "Microsoft.EntityFrameworkCore": ("EF Core", "orm"),
    "System.Text.Json": ("System.Text.Json", "serialization"),
    "Newtonsoft.Json": ("Newtonsoft.Json", "serialization"),
    "NUnit": ("NUnit", "testing"),
    "Xunit": ("xUnit", "testing"),
    # Go
    "net/http": ("net/http", "web"),
    "github.com/gin-gonic/gin": ("Gin", "web"),
    "github.com/gorilla/mux": ("Gorilla Mux", "web"),
    "gorm.io/gorm": ("GORM", "orm"),
    "github.com/stretchr/testify": ("Testify", "testing"),
    # Rust
    "actix_web": ("Actix Web", "web"),
    "axum": ("Axum", "web"),
    "tokio": ("Tokio", "async"),
    "serde": ("Serde", "serialization"),
    "diesel": ("Diesel", "orm"),
}


def detect_frameworks(
    structural_results: dict[str, StructuralAnalysis],
) -> list[FrameworkMatch]:
    """Detect frameworks from import patterns across all analyzed files.

    Args:
        structural_results: file_path → StructuralAnalysis from providers

    Returns:
        List of FrameworkMatch sorted by import_count descending.
    """
    # Collect all imports across files
    import_counter: Counter[str] = Counter()
    import_evidence: dict[str, list[str]] = {}

    for file_path, analysis in structural_results.items():
        for imp in analysis.imports:
            module = imp.module
            # Check each signature prefix
            for prefix, (fw_name, fw_cat) in FRAMEWORK_SIGNATURES.items():
                if module == prefix or module.startswith(f"{prefix}."):
                    key = f"{fw_name}|{fw_cat}"
                    import_counter[key] += 1
                    import_evidence.setdefault(key, []).append(module)
                    break

    # Build results
    total_files = max(len(structural_results), 1)
    matches: list[FrameworkMatch] = []

    for key, count in import_counter.most_common():
        name, category = key.split("|", 1)
        # Confidence based on how many files use it
        confidence = min(1.0, count / total_files * 2)
        # Deduplicate evidence
        evidence = sorted(set(import_evidence[key]))[:10]
        matches.append(FrameworkMatch(
            name=name,
            category=category,
            confidence=round(confidence, 2),
            import_count=count,
            evidence=evidence,
        ))

    return matches


def detect_languages(
    structural_results: dict[str, StructuralAnalysis],
) -> list[tuple[str, int]]:
    """Detect languages from structural results.

    Returns list of (language, file_count) sorted by count descending.
    """
    lang_counter: Counter[str] = Counter()
    for analysis in structural_results.values():
        if analysis.language:
            lang_counter[analysis.language] += 1
    return lang_counter.most_common()
