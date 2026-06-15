# Python language guidance

## Idioms to recognize

- **Decorators are the primary role marker** in modern Python.
  Framework-level decorators sit immediately above a class or function
  definition and directly identify architectural roles:
  - Django: `@receiver`, `@admin.register`, `@register.filter`,
    `@login_required`, `@permission_required`, `@method_decorator`.
  - DRF (Django REST Framework): `@api_view`, `@permission_classes`,
    `@authentication_classes`, `@throttle_classes`, `@action`.
  - Flask: `@app.route`, `@app.get`, `@app.post`, `@bp.route`,
    `@login_required`, `@before_request`, `@after_request`,
    `@errorhandler`.
  - SQLAlchemy: `@event.listens_for`, `@hybrid_property`,
    `@validates`, `@declared_attr`.
  - Pydantic: `@validator`, `@root_validator`, `@model_validator`,
    `@field_validator`.
  - FastAPI: `@app.get`, `@app.post`, `@app.put`, `@app.delete`,
    `@router.get`, `@depends`, `@app.on_event`.
  - Celery / async: `@shared_task`, `@app.task`, `@periodic_task`.
  - Testing markers (skip): `@pytest.fixture`, `@pytest.mark.*`.
- **Dynamic attributes + base-class conventions.** Python's
  architectural vocabulary is expressed as class-body assignments on
  well-known base classes rather than as type annotations:
  - `models.Model` subclasses (Django) use `name = models.CharField(...)`
    to declare fields.
  - `db.Model` / `Base` subclasses (SQLAlchemy) use
    `id = db.Column(...)` / `mapped_column(...)`.
  - `Schema` subclasses (Marshmallow) use `name = fields.String()`.
  - `BaseModel` subclasses (Pydantic v1/v2) use
    `name: str = Field(...)` — type-annotated assignments.
  - `FlaskForm` / `Form` subclasses (WTForms / Django Forms) use
    `name = StringField(validators=[DataRequired()])`.
- **Dataclasses and Pydantic models as DTOs.** `@dataclass`,
  `@dataclass(frozen=True)`, `attrs.define`, and Pydantic
  `BaseModel` subclasses frequently stand in as DTOs / value objects
  / command payloads. They are logical entities, not persistent
  entities (unless the class also extends an ORM `Model`).
- **Module structure is a strong classifier.** Files named
  `models.py`, `views.py`, `urls.py`, `serializers.py`, `forms.py`,
  `admin.py`, `tasks.py`, `signals.py`, `managers.py`, `querysets.py`,
  `permissions.py`, `throttles.py`, `filters.py`, `apps.py`,
  `routes.py`, `schemas.py` each carry a well-known role.
  Directories named `services/`, `domain/`, `business/`, `use_cases/`,
  `api/`, `handlers/`, `blueprints/` reinforce those role hints.
- **Metaclasses and descriptors** (e.g. `class Meta`, `class Config`,
  `__init_subclass__`, custom descriptors) attach metadata that
  rarely appears in field declarations but carries real architectural
  intent. A nested `class Meta:` on a Django model, DRF Serializer,
  or ModelForm is semantic — `model = 'User'`, `fields = [...]`,
  `ordering = [...]`, `permissions = (...)`.
- **Dunder conventions.** `__init__`, `__call__`, `__enter__` /
  `__exit__`, `__aenter__` / `__aexit__` often mark lifecycle hooks
  or callable objects masquerading as services. A class with a
  `__call__` method is effectively a callable strategy / command.
- **Module-level routers and blueprint instances.** A module-level
  `bp = Blueprint('main', __name__)`, `router = APIRouter()`, or
  `urlpatterns = [...]` is a routing surface declaration — the URLs
  / endpoints the pack's adapter may or may not have associated
  back to their handler functions.

## Extraction nuances

- **Docstrings as business hints.** The first sentence of a module,
  class, or function docstring (`"""..."""`) is often a plain-English
  business description. Lift it into the candidate's `description`
  field, trimmed to one sentence.
- **`__all__` and `_prefix` visibility.** Python has no `export`
  keyword, but a module-level `__all__ = [...]` list and a leading
  underscore on a name (`_internal_helper`) are strong signals.
  Emitting `_foo` names is usually wrong.
- **Type hints (PEP 484 / 604).** Modern Python uses type annotations
  (`x: int`, `def foo() -> User:`) — these are the public contract
  even though Python doesn't enforce them at runtime. Capture return
  types and parameter types when you use them to infer shape.
- **F-strings and SQL literal detection.** Raw SQL strings inside
  `cursor.execute(f"...")`, `session.execute(text("..."))`, or
  `db.engine.execute(...)` are integration surface the IR extractor
  doesn't decode. Surface the table / schema references when visible.
- **Async / await.** `async def` functions are concurrent endpoints
  (FastAPI, Starlette, aiohttp handlers) or async tasks. Note the
  async modifier when emitting endpoints candidates.
- **Property-backed fields.** `@property` decorators on methods turn
  them into read-only attributes. Prefer emitting the underlying
  field or the `@property`-exposed attribute based on which is the
  true public contract, not both.
- **Conditional imports and feature flags.** `if settings.FEATURE_X:
  from foo import bar` patterns gate architecturally-relevant
  branches. Note these when they encode distinct deployment modes.
- **Generated migrations and `migrations/` directories.** Skip.
- **Test fixtures.** Files under `tests/` / `tests.py`, starting with
  `test_`, ending in `_test.py`, or matching `conftest.py` are test
  scaffolding — skip.
- **Stub files (`.pyi`).** Type-only stubs — skip.

## Confidence calibration for Python

- Class with an explicit `@` framework decorator AND whose base
  class names the role (`models.Model`, `APIView`, `db.Model`,
  `Schema`): 0.9+.
- Class whose module file name and base class align
  (`views.py` + `View`-ish subclass; `models.py` + `Model` subclass)
  but no decorator visible: 0.8-0.9.
- Module-level function with a business-named prefix
  (`calculate_*`, `validate_*`, `evaluate_*`, `handle_*`) in a
  `services.py` / under `services/`: 0.75-0.85.
- Inference from imports alone (e.g. `from celery import
  shared_task` in a file with no `@shared_task` decorator yet):
  0.55-0.7.
