# Rails framework guidance

A `rails` static analysis pack has already been run against this file.
Its output is injected into the prompt as a fenced JSON array. You are
here to surface what that pack CANNOT see — not to restate what it
already captured.

## What the adapter already catches (do NOT re-emit these)

- **Controllers** — classes inheriting (directly or via intermediate
  base) from `ApplicationController`, `ActionController::Base`, or
  `ActionController::API`. Emitted as `interfaces` candidates with the
  controller name and inferred resource.
- **Conventional REST endpoints** — action methods on those
  controllers: `index`, `show`, `new`, `edit`, `create`, `update`,
  `destroy`. The adapter emits an `endpoints` candidate per action
  with the HTTP verb (GET / POST / PUT / DELETE) and an inferred path
  shape (`/<resource>`, `/<resource>/:id`, `/<resource>/new`,
  `/<resource>/:id/edit`).
- **ActiveRecord models** — classes inheriting from `ApplicationRecord`
  or `ActiveRecord::Base`. Emitted as `physical_data_entities` candidates with
  a naive pluralised table-name inference.
- **ActiveRecord associations** — `has_many`, `has_one`, `belongs_to`,
  `has_and_belongs_to_many` macros at the top of the model body. The
  adapter emits `logical_data_entity_relationships` candidates with cardinality
  (`ONE_TO_MANY`, `ONE_TO_ONE`, `MANY_TO_ONE`, `MANY_TO_MANY`).
- **ActiveModel::Serializer classes** — plus their `attributes :a, :b`
  and `attribute :foo` macros, emitted as `logical_data_entities` +
  `logical_data_attributes` candidates.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. Typical Rails blind spots:

- **Filters (`before_action` / `after_action` / `around_action` /
  `skip_before_action`).** These macros wire up cross-cutting concerns
  (authentication, authorization, audit logging, caching, rate
  limiting) to controller actions. `before_action :authenticate_user!`,
  `before_action :ensure_logged_in, only: [:create, :update]`, and
  `rescue_from ActiveRecord::RecordNotFound, with: :handle_not_found`
  are architectural — surface the filter method and the actions it
  protects as a distinct cross-cutting concern candidate.
- **Validations (`validates`, `validates_presence_of`,
  `validates_uniqueness_of`, `validate :custom_method`).** Business
  rules on the model. Emit each validation as a business-rule candidate
  distinct from the attribute it references, especially custom
  `validate :method_name` which encodes real domain logic.
- **Scopes (`scope :name, -> { ... }`).** Named queries that express
  business-meaningful filters — `scope :active, -> { where(active:
  true) }`, `scope :recent, -> { where('created_at > ?', 1.week.ago) }`.
  Emit each scope as a domain query candidate distinct from the model
  entity.
- **Callbacks (`before_save`, `after_create`, `before_destroy`,
  `around_update`, `after_commit`).** Lifecycle hooks that wire in
  domain logic at persistence-time — sending notifications, recalculating
  derived fields, cascading changes. Emit each callback as its own
  business-logic candidate, naming the (lifecycle, handler) pair.
- **Service objects** under `app/services/`. Rails codebases
  conventionally extract complex domain operations into plain-Ruby
  classes with a single public method (`call`, `execute`, `perform`).
  `class PurchaseService; def call(order); ...; end; end` — the pack
  does not see these because they don't extend a framework base.
  Emit each service as a business-logic candidate.
- **Background jobs** under `app/jobs/` — classes extending
  `ApplicationJob`, `ActiveJob::Base`, or `Jobs::Base` (Sidekiq-style)
  with a `perform(args)` or `execute(args)` method. Emit as
  business-logic / integration candidates distinct from synchronous
  controller-driven operations. `sidekiq_options queue: "critical"` is
  a deployment signal worth capturing.
- **Mailers** under `app/mailers/` — classes extending
  `ApplicationMailer` / `ActionMailer::Base` with public methods that
  correspond to email templates (`def welcome_email(user); ...; end`).
  Each mailer method is an integration point (email external system).
- **Concerns** under `app/controllers/concerns/`, `app/models/concerns/`,
  `app/serializers/concerns/`, `app/jobs/concerns/` — modules included
  via `extend ActiveSupport::Concern`. They carry shared behaviour
  (mixins). Emit each concern as a library / cross-cutting candidate.
  Modules using `class_methods do` or `included do` blocks are the
  classic Rails concern pattern.
- **Routes** (`config/routes.rb`). The Rails routes DSL (`resources
  :users`, `resource :profile`, `namespace :api`, `scope '/v1'`,
  `get '/health', to: 'health#show'`, `post '/webhooks/:provider',
  to: 'webhooks#receive'`) expands to many endpoints the pack's
  controller-convention heuristic does NOT generate (custom member /
  collection routes, non-conventional action names, namespaced
  resources). Surface each custom route as a distinct `endpoints`
  candidate.
- **View helpers** under `app/helpers/` — modules auto-included into
  view context (`module UsersHelper; def format_join_date(user);
  ...; end; end`). These carry presentation logic, sometimes real
  business formatting. Emit as library candidates when the helper
  encodes domain formatting.
- **Custom model managers / query objects** (plain-Ruby classes under
  `app/queries/`, `app/finders/`, `app/repositories/`). Not Rails-
  framework-formal but a common pattern for complex queries extracted
  out of the model.
- **Initializers** under `config/initializers/*.rb` — configure
  gems, register callbacks, set up global state (`Devise.setup`,
  `Rails.application.config.session_store`, `Redis.current =
  Redis.new(...)`). Each initializer that wires up an external
  integration is an integration-point candidate.
- **I18n usage.** `I18n.t('users.created_successfully')` /
  `t('.title')` — internationalization keys embedded in controllers,
  mailers, views. The message strings live in `config/locales/*.yml`.
  Flag notable domain-visible strings referenced but not defined.
- **ActiveStorage attachments** — `has_one_attached :avatar` /
  `has_many_attached :documents` on models. These are persistence
  relationships with an external blob store (S3, GCS, disk) that the
  pack does not capture as logical_data_entity_relationships — emit as an
  integration-backed physical attribute.
- **ActiveRecord enums** — `enum status: [:draft, :published,
  :archived]` declares a state machine surface on the column. Emit
  each enum as a state / option set candidate.
- **Custom rescue_from / error handlers** — global error-handling
  macros in `ApplicationController` or specific controllers. Encodes
  the HTTP error-response contract.
- **Concerns that wire in behaviour at runtime.** `included do` /
  `class_methods do` blocks inside a concern module may declare
  associations, callbacks, or scopes that are logically attached to
  the including class. These contribute to the surface area of the
  including model but come from the concern module.
- **Custom validations as separate classes** — `class
  EmailValidator < ActiveModel::EachValidator; def validate_each(
  record, attribute, value); ...; end; end` in `app/validators/`.
- **Channels / ActionCable consumers** under `app/channels/` — classes
  extending `ApplicationCable::Channel` with `subscribed` / `unsubscribed`
  / `receive` methods handle WebSocket traffic.
- **Rake tasks** under `lib/tasks/*.rake` — operator-facing CLI
  surfaces. Each `task :name do ... end` is an operational entry point.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
