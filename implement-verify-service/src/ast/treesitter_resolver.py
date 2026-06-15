"""Language-agnostic call resolution pipeline.

5-stage pipeline that resolves RawCallSite objects into CallInfo objects.
Each stage attempts to identify the callee. First confident match wins.
"""
import logging
from pathlib import Path
from typing import Optional

from src.ast.models import CallInfo
from src.ast.treesitter_models import RawCallSite, ResolutionContext

logger = logging.getLogger(__name__)


def _snake_to_pascal(name: str) -> str:
    """Convert snake_case to PascalCase."""
    return "".join(word.capitalize() for word in name.split("_"))


class CallResolver:
    """Multi-stage pipeline for resolving call targets."""

    def resolve(self, call: RawCallSite, context: ResolutionContext) -> CallInfo:
        """Resolve a raw call site to a CallInfo with confidence."""

        # Stage 0: Self-call (self.method() within a class)
        result = self._resolve_self_call(call, context)
        if result:
            return result

        # Stage 1: Assignment tracker
        result = self._resolve_via_assignment(call, context)
        if result:
            return result

        # Stage 2: Type annotations
        result = self._resolve_via_annotation(call, context)
        if result:
            return result

        # Stage 3: Import following
        result = self._resolve_via_import(call, context)
        if result:
            return result

        # Stage 4: Ctags cross-reference
        result = self._resolve_via_ctags(call, context)
        if result:
            return result

        # Stage 5: Convention heuristic
        result = self._resolve_via_convention(call, context)
        if result:
            return result

        # Unresolved — emit with low confidence
        callee_name = f"{call.receiver}.{call.method}" if call.receiver else call.method
        return CallInfo(
            caller_file=call.file_path,
            caller_name=call.caller_name,
            callee_file="-",
            callee_name=callee_name,
            line=call.line,
            confidence=0.20,
        )

    def _resolve_self_call(
        self, call: RawCallSite, ctx: ResolutionContext
    ) -> Optional[CallInfo]:
        """Resolve self.method() — callee is same class as caller."""
        if call.receiver != "self":
            return None

        caller_class = call.caller_name.split(".")[0] if "." in call.caller_name else None
        if not caller_class:
            return None

        callee_name = f"{caller_class}.{call.method}"
        callee_file = ctx.class_index.get(caller_class, call.file_path)
        return CallInfo(
            caller_file=call.file_path,
            caller_name=call.caller_name,
            callee_file=callee_file,
            callee_name=callee_name,
            line=call.line,
            confidence=0.95,
        )

    def _resolve_via_assignment(
        self, call: RawCallSite, ctx: ResolutionContext
    ) -> Optional[CallInfo]:
        """Resolve via self.x = ClassName() tracking."""
        if not call.receiver:
            return None

        caller_class = call.caller_name.split(".")[0] if "." in call.caller_name else None
        if not caller_class:
            return None

        receiver_parts = call.receiver.split(".")
        if len(receiver_parts) == 2 and receiver_parts[0] == "self":
            attr_name = receiver_parts[1]
            key = f"{caller_class}.{attr_name}"
            resolved_type = ctx.assignments.get(key)
            if resolved_type:
                callee_name = f"{resolved_type}.{call.method}"
                callee_file = ctx.class_index.get(resolved_type, "-")
                return CallInfo(
                    caller_file=call.file_path,
                    caller_name=call.caller_name,
                    callee_file=callee_file,
                    callee_name=callee_name,
                    line=call.line,
                    confidence=0.95,
                )

        return None

    def _resolve_via_annotation(
        self, call: RawCallSite, ctx: ResolutionContext
    ) -> Optional[CallInfo]:
        """Resolve via type annotations."""
        if not call.receiver:
            return None

        caller_class = call.caller_name.split(".")[0] if "." in call.caller_name else None
        if not caller_class:
            return None

        receiver_parts = call.receiver.split(".")
        if len(receiver_parts) == 2 and receiver_parts[0] == "self":
            attr_name = receiver_parts[1]
            key = f"{caller_class}.{attr_name}"
            resolved_type = ctx.annotations.get(key)
            if resolved_type:
                callee_name = f"{resolved_type}.{call.method}"
                callee_file = ctx.class_index.get(resolved_type, "-")
                return CallInfo(
                    caller_file=call.file_path,
                    caller_name=call.caller_name,
                    callee_file=callee_file,
                    callee_name=callee_name,
                    line=call.line,
                    confidence=0.90,
                )

        return None

    def _resolve_via_import(
        self, call: RawCallSite, ctx: ResolutionContext
    ) -> Optional[CallInfo]:
        """Resolve bare function/class calls via import data."""
        if call.receiver:
            return None

        import_info = ctx.imports.get(call.method)
        if import_info:
            module_path, original_name = import_info
            callee_file = ctx.class_index.get(call.method, module_path)
            callee_name = call.method
            is_external = not module_path.startswith("src")
            return CallInfo(
                caller_file=call.file_path,
                caller_name=call.caller_name,
                callee_file="-" if is_external else callee_file,
                callee_name=callee_name,
                line=call.line,
                confidence=0.85,
            )

        return None

    def _resolve_via_ctags(
        self, call: RawCallSite, ctx: ResolutionContext
    ) -> Optional[CallInfo]:
        """Resolve via ctags symbol index — search for method name."""
        matches = ctx.symbol_index.get(call.method, [])
        if not matches:
            return None

        caller_dir = str(Path(call.file_path).parent)

        if len(matches) == 1:
            class_name, file_path = matches[0]
            callee_name = f"{class_name}.{call.method}" if class_name else call.method
            confidence = 0.70
            if str(Path(file_path).parent) == caller_dir:
                confidence = min(0.95, confidence + 0.10)
            return CallInfo(
                caller_file=call.file_path,
                caller_name=call.caller_name,
                callee_file=file_path,
                callee_name=callee_name,
                line=call.line,
                confidence=confidence,
            )

        for class_name, file_path in matches:
            if str(Path(file_path).parent) == caller_dir:
                callee_name = f"{class_name}.{call.method}" if class_name else call.method
                return CallInfo(
                    caller_file=call.file_path,
                    caller_name=call.caller_name,
                    callee_file=file_path,
                    callee_name=callee_name,
                    line=call.line,
                    confidence=0.50,
                )

        class_name, file_path = matches[0]
        callee_name = f"{class_name}.{call.method}" if class_name else call.method
        return CallInfo(
            caller_file=call.file_path,
            caller_name=call.caller_name,
            callee_file=file_path,
            callee_name=callee_name,
            line=call.line,
            confidence=0.40,
        )

    def _resolve_via_convention(
        self, call: RawCallSite, ctx: ResolutionContext
    ) -> Optional[CallInfo]:
        """Last resort: name similarity heuristic."""
        if not call.receiver:
            return None

        receiver_parts = call.receiver.split(".")
        base_name = receiver_parts[-1]

        pascal = _snake_to_pascal(base_name)
        if pascal in ctx.class_index:
            callee_name = f"{pascal}.{call.method}"
            return CallInfo(
                caller_file=call.file_path,
                caller_name=call.caller_name,
                callee_file=ctx.class_index[pascal],
                callee_name=callee_name,
                line=call.line,
                confidence=0.30,
            )

        return None
