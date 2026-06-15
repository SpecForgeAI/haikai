# Flask framework guidance

A `flask` static analysis pack has already been run against this file.
Its output is injected into the prompt as a fenced JSON array. You are
here to surface what that pack CANNOT see - not to restate what it
already captured.

## What the adapter already catches (do NOT re-emit these)

- **Endpoints** declared via `@app.route('/path')`, `@app.get(...)`,
  `@app.post(...)`, `@app.put(...)`, `@app.delete(...)`, `@app.patch(...)`,
  plus blueprint-scoped decorators (`@bp.route`, `@bp.get`, `@bp.post`,
  etc.). The path and HTTP methods are captured; multi-method routes
  produce one endpoint per method.
- **SQLAlchemy persistent entities** — classes inheriting from
  `db.Model`, `Base`, `DeclarativeBase`, or descendants thereof.
  Fields declared via `db.Column(...)` / `sa.Column(...)` /
  `mapped_column(...)` are captured as physical attributes.
- **Entity relationships** — `db.relationship(...)`,
  `so.relationship(...)`, and `relationship(...)` declarations, along
  with their target model name and inferred cardinality where
  available.
- **Marshmallow schemas** — classes inheriting from `Schema` /
  `ModelSchema`, plus their declared `fields.*` entries as logical
  data attributes.
- **WTForms / Flask-WTF forms** — classes inheriting from `Form` /
  `FlaskForm`, plus their `*Field(...)` declarations.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. Typical Flask blind spots:

- **Application factory patterns.** Flask apps are often created via
  a `create_app(config)` factory function rather than a module-level
  `app = Flask(__name__)`. The factory wires in extensions
  (`db.init_app(app)`, `login.init_app(app)`, `babel.init_app(app)`,
  `mail.init_app(app)`), registers blueprints
  (`app.register_blueprint(bp)`), and installs error handlers — all
  architectural wiring the adapter does not see. Emit the factory as
  a configuration candidate plus each extension as an integration.
- **Blueprints.** Module-level `bp = Blueprint('auth', __name__,
  url_prefix='/auth')` / `bp = Blueprint('main', __name__)`
  declarations partition routes into logical modules. The adapter
  picks up the `@bp.route`-decorated functions but does not surface
  the blueprint itself as an architectural boundary. Emit each
  blueprint as a module / `interfaces` candidate, capturing its
  `url_prefix` and its set of routes.
- **Before / after-request hooks.** `@app.before_request`,
  `@app.before_first_request` (legacy), `@app.after_request`,
  `@app.teardown_request`, `@app.teardown_appcontext`, plus the
  blueprint-scoped equivalents. These are cross-cutting concerns
  (request logging, auth injection, DB session lifecycle, metrics)
  that the route-focused adapter ignores.
- **Error handlers.** `@app.errorhandler(404)` /
  `@app.errorhandler(Exception)` / `@bp.errorhandler(...)` functions
  form the error-response surface. Surface each handler as a
  distinct candidate, noting the status code or exception it catches.
- **Authentication decorators and extensions.** `@login_required`
  (Flask-Login), `@jwt_required()` (Flask-JWT-Extended),
  `@oauth.require_oauth()` (Flask-OAuthlib), and the underlying
  extension setup (`LoginManager`, `JWTManager`). Surface the login
  manager / JWT manager configuration as integration candidates and
  note which routes require authentication.
- **Flask-RESTful / Flask-RESTX / Flask-Smorest Resource classes.**
  Classes extending `Resource` (and their `get` / `post` / `put` /
  `delete` methods) are a second, parallel way to declare endpoints
  that the route-decorator-focused adapter misses entirely. Emit each
  `Resource` subclass as an `interfaces` candidate with its HTTP
  methods as `endpoints`.
- **Flask-SocketIO / WebSocket handlers.** `@socketio.on('event')`
  handlers declare a separate WebSocket surface alongside HTTP routes.
  Surface each handler and the underlying `SocketIO` initialization.
- **Flask-Admin registrations.** `admin.add_view(ModelView(User, db.
  session))` calls register a CRUD admin interface for each model —
  an operational surface the adapter does not touch.
- **Flask-Babel / i18n setup.** `@babel.localeselector`,
  `@babel.timezoneselector`, plus `babel.init_app(app)` configure
  localization — note as a cross-cutting concern.
- **Custom CLI commands.** `@app.cli.command('fill-db')` /
  `@click.command()` functions registered as Flask CLI subcommands
  are operator-facing batch-job surfaces distinct from HTTP routes.
- **Flask-Mail / email-sending integrations.** `mail.send(msg)` call
  sites and `Mail` extension setup encode an outbound integration.
- **Celery integrations.** `celery = Celery(app.name, broker=...)`
  initialization plus `@celery.task` decorated functions form an
  async-task runtime distinct from Flask's request-response cycle.
- **Flask-Migrate / Alembic setup.** Encodes schema-change intent —
  the `migrations/` directory and `alembic.ini` carry persistent
  data-model history the pack does not read.
- **Full-text / search integrations.** Elasticsearch client setup
  (`app.elasticsearch = Elasticsearch(...)`), Whoosh / Meilisearch
  indexers — each is an outbound integration the adapter ignores.
- **Redis / RQ / cache integrations.** `app.redis = Redis.from_url(...)`,
  `Queue(...)`, `Cache(app)` — each setup call is an integration
  candidate; each `enqueue(...)` call site is a cross-process call.
- **Route URL converters.** `app.url_map.converters['listid'] = ListIDConverter`
  customizes URL parsing — niche but meaningful on some codebases.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
