from dataclasses import dataclass, field
from typing import Optional


class SymbolKind:
    """Canonical symbol kinds — OUR contract, not any tool's vocabulary.

    All providers (ctags, LSP, future) must map their output to these kinds.
    Tests assert against these. If a provider changes its labels, only
    the provider's mapping layer updates — not tests, not consumers.
    """
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    VARIABLE = "variable"
    CONSTANT = "constant"
    INTERFACE = "interface"
    DECORATOR = "decorator"
    MODULE = "module"
    PROPERTY = "property"
    UNKNOWN = "unknown"

    ALL = {CLASS, FUNCTION, METHOD, VARIABLE, CONSTANT, INTERFACE,
           DECORATOR, MODULE, PROPERTY, UNKNOWN}


@dataclass
class SymbolInfo:
    name: str
    kind: str  # Must be a SymbolKind value — our canonical kinds
    scope: Optional[str] = None
    line_start: int = 0
    line_end: int = 0
    signature: Optional[str] = None
    is_async: bool = False
    is_abstract: bool = False
    decorators: list[str] = field(default_factory=list)
    visibility: str = "public"  # public, private, protected
    inherits: Optional[str] = None

    def __post_init__(self):
        if self.kind not in SymbolKind.ALL:
            self.kind = SymbolKind.UNKNOWN


@dataclass
class InheritanceInfo:
    class_name: str
    bases: list[str] = field(default_factory=list)
    interfaces: list[str] = field(default_factory=list)
    is_abstract: bool = False


@dataclass
class ImportInfo:
    module: str
    names: list[str] = field(default_factory=list)
    is_relative: bool = False
    line_number: int = 0


@dataclass
class CallInfo:
    """A call relationship between two symbols."""
    caller_file: str
    caller_name: str          # qualified name e.g. "ClassName.method_name"
    callee_file: str          # "-" for stdlib/external calls
    callee_name: str          # qualified name e.g. "Database.execute"
    line: int = 0             # line number in caller_file where call occurs
    confidence: float = 1.0   # 0.0-0.95, how certain we are about the resolution


@dataclass
class EndpointInfo:
    """A detected API endpoint (REST, WebSocket, MQ, gRPC, scheduled)."""
    type: str              # REST, WEBSOCKET, MQ_CONSUMER, MQ_PRODUCER, GRPC, SCHEDULED
    path: str              # URL path, topic name, queue name, cron expression
    operation: str          # GET, POST, PUT, DELETE, PATCH, SUBSCRIBE, PUBLISH, RPC, CRON
    handler_class: str      # class containing the handler
    handler_method: str     # method name
    file: str               # source file path
    line: int = 0           # line number
    direction: str = "INBOUND"   # INBOUND, OUTBOUND, INTERNAL
    protocol: str = "HTTP"       # HTTP, WS, KAFKA, AMQP, GRPC, CRON
    framework: str = ""          # spring, fastapi, express, etc.
    confidence: float = 0.80


@dataclass
class InteractionInfo:
    """A detected data movement (outbound HTTP, DB access, MQ publish, file I/O, cache)."""
    source_class: str       # caller class
    source_method: str      # caller method
    target: str             # URL, table/repo name, topic, file path
    target_type: str        # HTTP_SERVICE, DATABASE, MESSAGE_QUEUE, FILE_SYSTEM, CACHE, EXTERNAL_API
    direction: str          # READ, WRITE, PUBLISH, SUBSCRIBE, REQUEST_RESPONSE
    mechanism: str          # library/framework used (RestTemplate, JPA, fetch, etc.)
    data_hint: str = ""     # entity/DTO type if detectable
    file: str = ""          # source file path
    line: int = 0           # line number
    confidence: float = 0.75


@dataclass
class StructuralAnalysis:
    file_path: str
    language: str
    symbols: list[SymbolInfo] = field(default_factory=list)
    inheritance: list[InheritanceInfo] = field(default_factory=list)
    imports: list[ImportInfo] = field(default_factory=list)
    calls: list[CallInfo] = field(default_factory=list)
    endpoints: list[EndpointInfo] = field(default_factory=list)
    interactions: list[InteractionInfo] = field(default_factory=list)
    provider_used: str = "unknown"
    analysis_depth: str = "basic"  # basic (ctags) or rich (LSP)
    language_version: Optional[str] = None
