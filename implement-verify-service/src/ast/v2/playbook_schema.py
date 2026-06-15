"""Pydantic schema for V2 playbooks.

Validates shape + required fields. Emits useful error messages when a playbook
is malformed, so authors (human or agent) get actionable feedback.
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError


class ManifestMatch(BaseModel):
    file: str
    substring: str


class Detection(BaseModel):
    imports_match: list[str] = Field(default_factory=list)
    files_match: list[str] = Field(default_factory=list)
    manifest_contains: list[ManifestMatch] = Field(default_factory=list)


class ExtractStep(BaseModel):
    id: Optional[str] = None
    query: Literal["annotations", "call_args", "configs", "method_decls", "files"]
    # Shared optional flags
    file_filter: Literal["routing_imports", "all"] = "routing_imports"
    file_extensions: Optional[list[str]] = None

    # annotations
    annotation_names: Optional[list[str]] = None
    target_kind: Optional[Literal["method", "class"]] = None

    # call_args
    callee_pattern: Optional[str] = None
    path_arg_index: Optional[int] = None
    verb: Optional[str] = None
    verb_from: Optional[str] = None
    path_must_match: Optional[str] = None

    # configs
    parser: Optional[str] = None
    file_glob: Optional[str] = None

    # method_decls + files
    # path_from: how to derive the URL path
    #   method_name_strip  → strip prefix from method name + snake_case
    #   class_name_strip   → derive from enclosing class name + snake_case
    #   file_path          → file's repo-relative path with extension stripped
    name_pattern: Optional[str] = None
    strip_prefix: Optional[str] = None
    path_from: Optional[Literal[
        "method_name_strip", "class_name_strip", "file_path"
    ]] = None
    strip_suffix: Optional[str] = None    # e.g. ".php" for files-as-routes
    root_strip: Optional[str] = None      # e.g. "htdocs" — drop leading dir from path
    class_pattern: Optional[str] = None   # method_decls: only emit when enclosing class matches this regex
    exclude_globs: Optional[list[str]] = None  # files: drop matches matching any of these globs


class Emit(BaseModel):
    type: str = "REST"
    protocol: str = "HTTP"
    framework: str


class VerificationStep(BaseModel):
    id: Optional[str] = None
    query: Optional[str] = None
    annotation_names: Optional[list[str]] = None
    callee_pattern: Optional[str] = None
    target_kind: Optional[str] = None
    expected_count: Optional[str] = None  # e.g. "same_as_output_count"
    tolerance_pct: Optional[float] = None


class Playbook(BaseModel):
    name: str
    version: int = 1
    language: Optional[str] = None
    detection: Detection
    extract: list[ExtractStep]
    emit: Emit
    verification: list[VerificationStep] = Field(default_factory=list)
    conflict_rules: list[dict] = Field(default_factory=list)
    known_pitfalls: list[str] = Field(default_factory=list)

    # Annotation-driven framework rules (formerly hardcoded in playbook_executor):
    #
    # verb_annotations:        annotation name -> HTTP verb (e.g. GetMapping -> GET)
    # path_only_annotations:   annotation that carries a path prefix only (no verb on its own)
    # verb_via_methods_arg:    annotation that carries the verb in a `method=`/`methods=` arg
    #                          (Spring @RequestMapping, Symfony #[Route])
    verb_annotations: dict[str, str] = Field(default_factory=dict)
    path_only_annotations: list[str] = Field(default_factory=list)
    verb_via_methods_arg: list[str] = Field(default_factory=list)

    # Hints to Phase 10 (LLM fallback): if this playbook detects but produces
    # zero endpoints, these globs are passed to the LLM as "look here first."
    evidence_globs: list[str] = Field(default_factory=list)


class StackPlaybook(BaseModel):
    """A stack composes multiple framework playbooks for repos that use several.
    Example: django+graphql for saleor, spring-boot+jax-rs for keycloak.
    """
    name: str
    version: int = 1
    detection: Detection
    compose: list[str] = Field(..., description="playbook names to include")
    emit: Optional[Emit] = None
    known_pitfalls: list[str] = Field(default_factory=list)


def validate_playbook(raw: dict) -> tuple[Optional[Playbook], list[str]]:
    """Validate a raw dict. Return (model, errors). errors=[] means success."""
    try:
        return Playbook(**raw), []
    except ValidationError as e:
        return None, [f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors()]


def validate_stack(raw: dict) -> tuple[Optional[StackPlaybook], list[str]]:
    try:
        return StackPlaybook(**raw), []
    except ValidationError as e:
        return None, [f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors()]
