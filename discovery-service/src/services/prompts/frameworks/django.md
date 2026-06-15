# Django framework guidance

A `django` static analysis pack has already been run against this file.
Its output is injected into the prompt as a fenced JSON array. You are
here to surface what that pack CANNOT see - not to restate what it
already captured.

## What the adapter already catches (do NOT re-emit these)

- **Persistent entities** — classes inheriting (directly or via an
  intermediate base) from `models.Model`, including descendants like
  `ModelWithMetadata`, `TimestampedModel`, custom project base
  classes. The inheritance chain is walked, so grandchildren of
  `models.Model` are caught.
- **Model fields** — class-body assignments to `models.*Field()`
  (CharField, IntegerField, BooleanField, DateTimeField, DecimalField,
  SlugField, etc.). The field type from the factory call name is
  captured on the candidate's `data.fieldType`.
- **Entity relationships** — `ForeignKey` (MANY_TO_ONE),
  `OneToOneField` (ONE_TO_ONE), `ManyToManyField` (MANY_TO_MANY).
- **Class-based views** — classes inheriting from `View`, `APIView`,
  `GenericAPIView`, `ViewSet`, `ModelViewSet`, `ReadOnlyModelViewSet`,
  `ListView`, `DetailView`, `CreateView`, `UpdateView`, `DeleteView`,
  `TemplateView`, `RedirectView`, `FormView`.
- **URL routes** — `path()`, `url()`, and `re_path()` declarations
  in `urls.py` modules (including `include()` compositions).
- **DRF serializers** — classes inheriting `Serializer`,
  `ModelSerializer`, or `HyperlinkedModelSerializer`, plus their
  declared fields as logical data attributes.
- **Django forms** — classes inheriting `Form` or `ModelForm`, plus
  their declared fields as logical data attributes.
- **Business-logic functions** — module-level non-CRUD functions in
  `services.py`, `utils.py`, or under `services/`, `domain/`,
  `business/`, `logic/`, `helpers/` directories. CRUD prefixes
  (`get_`, `set_`, `create_`, `update_`, `delete_`, etc.) are
  filtered out, as are names starting with underscore.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. Typical Django blind spots:

- **Custom model managers and querysets.** Classes extending
  `models.Manager` / `models.QuerySet` (`class PublishedManager(
  models.Manager):` / `class OrderQuerySet(models.QuerySet):`),
  often attached to models via `objects = PublishedManager()`. These
  carry domain logic — filtering, annotation, chained query composition
  — that the stereotype-focused pack does not surface. Emit the manager
  / queryset as a business-logic or domain candidate in its own right.
- **Middleware classes.** Classes implementing `__call__(request)`,
  `process_request`, `process_response`, `process_view`, or
  `process_exception`, plus anything registered in the `MIDDLEWARE`
  settings list. Middleware is a cross-cutting concern (auth, logging,
  tenancy, CORS, rate-limiting) that the pack ignores — surface each
  middleware class as an architectural element.
- **Permission and authentication classes.** Classes extending
  `BasePermission` / `BaseAuthentication` / `SessionAuthentication` /
  `TokenAuthentication` / `JSONWebTokenAuthentication`, and their
  `has_permission` / `has_object_permission` / `authenticate` hook
  methods. These encode the real authz/authn surface and are not
  `@decorator`-annotated classes — the pack misses them.
- **Custom throttling and filter classes.** `BaseThrottle` /
  `UserRateThrottle` subclasses; `FilterSet` / `BaseFilterBackend`
  subclasses — rate-limiting and query-filtering that the
  stereotype-focused pack does not mark.
- **Django signals and `@receiver` handlers.** `signals.py` modules
  with `@receiver(post_save, sender=User)` / `@receiver(pre_delete)`
  / `signal.connect(handler)` calls wire up event-driven behaviour
  that the pack surfaces as a plain module-level function at best.
  Emit each receiver as a distinct event handler candidate, capturing
  the `(sender, signal)` pair.
- **Celery tasks.** `@shared_task` / `@app.task` / `@periodic_task`
  decorated functions live in `tasks.py` modules. They are async
  runtime candidates — background jobs — distinct from synchronous
  services. Emit each task as its own candidate.
- **Admin customizations.** Classes extending `admin.ModelAdmin` /
  `admin.TabularInline` / `admin.StackedInline`, plus `@admin.register`
  decorators. The admin surface is an operational / internal UI that
  the pack does not touch.
- **Django app configuration.** `apps.py` modules defining
  `class FooConfig(AppConfig):` and their `ready()` method — which
  often performs signal wiring, startup registration, and import-time
  side effects. Note the app config and what its `ready()` wires up.
- **Settings-driven integrations.** `settings.py` references to
  `DATABASES`, `CACHES`, `CHANNEL_LAYERS`, `EMAIL_BACKEND`,
  `AUTHENTICATION_BACKENDS`, `SESSION_ENGINE`, `STORAGES`,
  `CELERY_BROKER_URL`, `ELASTICSEARCH_DSL` — each encodes an external
  integration the code never names directly. Emit an integration
  candidate per distinct external system referenced.
- **Template tags and filters.** `@register.tag` /
  `@register.filter` / `@register.simple_tag` / `@register.inclusion_tag`
  in `templatetags/*.py` modules are custom template extensions. Emit
  them as library candidates when they encode business formatting logic.
- **Management commands.** Classes extending `BaseCommand` in
  `<app>/management/commands/*.py` are operator-facing CLI surfaces
  (data migrations, imports, cron-equivalent batch jobs). Emit each
  command as its own operational candidate.
- **Migrations with data logic.** `migrations/*.py` files containing
  `RunPython(forwards, backwards)` carry one-off data migrations —
  business rules frozen at a point in time. Surface them when they
  clearly encode domain logic.
- **Custom field subclasses.** `class EncryptedCharField(models.
  CharField):` / `class MoneyField(models.DecimalField):` override
  storage or validation behaviour. Emit as data-attribute candidates
  only when the override is architecturally meaningful (encryption,
  custom serialization, foreign-service lookup).
- **GraphQL / Graphene schemas.** `graphene.ObjectType` /
  `graphene.Mutation` / `graphene.InputObjectType` classes sit alongside
  DRF on newer Django codebases. The pack does not detect them.
- **Channels consumers.** `AsyncConsumer` / `WebsocketConsumer`
  subclasses handle WebSocket / channel-layer traffic — a separate
  inbound surface alongside HTTP.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
