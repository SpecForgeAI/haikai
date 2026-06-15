# Ruby language guidance

## Idioms to recognize

- **Macro calls in class bodies are the primary role marker** in
  idiomatic Ruby. Where Java uses annotations and Python uses decorators,
  Ruby uses bare method calls evaluated at class-load time:
  - Rails ActiveRecord: `has_many :posts`, `belongs_to :author`,
    `has_one :profile`, `has_and_belongs_to_many :tags`,
    `validates :email, presence: true`, `scope :active, -> { ... }`,
    `enum status: [:draft, :published]`.
  - Rails controllers: `before_action :authenticate!`, `after_action`,
    `around_action`, `skip_before_action`, `rescue_from ErrorClass`,
    `layout :mobile_or_desktop`.
  - ActionMailer / ActiveJob / ActionCable: `queue_as :default`,
    `default from:`, `helper :name`, `rescue_from`, `retry_on`,
    `discard_on`.
  - Serializers / forms: `attributes :id, :name`, `attribute :computed`,
    `belongs_to :author` (ActiveModel::Serializer), `validates_format_of`.
  - DSL-style gems: `resource :posts`, `namespace :api`, `root 'home#index'`
    (routes.rb); `get '/api/users', to: 'users#index'`.
  - Class-level macros for mixins: `include SomeModule`, `extend
    OtherModule`, `prepend Concern` — `include` is how Ruby's mixin
    inheritance gets wired in.
- **Modules as mixins (concerns).** A `module Foo` that is intended to
  be `include`d carries the same role as a traited cross-cutting
  concern. Rails formalises the pattern via `ActiveSupport::Concern`
  with a `class_methods do` / `included do` pair. `app/models/concerns/`
  and `app/controllers/concerns/` directories are the conventional home.
- **method_missing and dynamic method definition.** Ruby heavily uses
  metaprogramming: `define_method`, `class_eval`, `method_missing`,
  `respond_to_missing?`. A method you are looking for may be defined at
  runtime by a macro call — don't assume a class with no visible
  `def foo` method is missing that behaviour. ActiveRecord attributes,
  for example, are all defined via `method_missing` / `attribute_methods`.
- **Blocks, procs, and lambdas.** `do...end` / `{ ... }` blocks attached
  to macro calls frequently carry domain logic inside what looks like
  configuration. `scope :recent, -> { where('created_at > ?', 1.week.ago) }`
  is a named query. `around_action { |ctrl, blk| ... }` is a filter.
  The block body is where the real logic lives.
- **Symbols as configuration values.** `:draft`, `:published`,
  `:authorized_by_token` — symbols denote enumerated options, state
  names, permission keys. They appear as arguments to macros, hash keys,
  and `case` labels. Treat them as string-enum-equivalent.
- **Duck typing over explicit interfaces.** Ruby classes rarely declare
  the interfaces they implement; protocol membership is inferred from
  the methods defined. If a class responds to `#call` it is effectively
  a callable (strategy / command). If it responds to `#to_json` it is
  serialisable. Document this via comments (`# Implements MessageBus
  contract`) or absence.
- **Predicate and bang methods.** `user.admin?` (predicate, returns
  boolean) and `user.save!` (bang, raises on failure) are Ruby
  conventions. Recognising them distinguishes read-only queries from
  potentially-mutating side-effectful operations.
- **Class-level evaluation and constants.** Ruby evaluates class bodies
  top-to-bottom — `BasicUser = 1`, `MODEL_VERSION = "v2"`, and macro
  calls all fire at load time. Constants defined at class level are
  effectively enum values / magic numbers that ship with the model.
- **Keyword arguments and hash-arg conventions.** Modern Ruby uses
  `def foo(name:, age: nil)` but legacy code frequently uses
  `def foo(opts = {})` then destructures. Keyword arg presence is a
  strong signal the method is a public contract; implicit hash args
  are often internal.

## Extraction nuances

- **Tree-sitter-ruby class bodies.** Macros at class scope show up as
  `call` nodes with an implicit receiver. `has_many :posts, through:
  :memberships` is a single call with a keyword arg. Multiple chained
  macros on one line (`attr_reader :a, :b, :c`) produce one call with
  a multi-arg arguments node — split them when relevant.
- **File naming is conventional, not enforced.** Rails conventions:
  `users_controller.rb` → `UsersController`, `user.rb` → `User`,
  `user_badge_serializer.rb` → `UserBadgeSerializer`,
  `admin/settings_controller.rb` → `Admin::SettingsController`. The
  file path encodes the namespace via `/`.
- **Modules namespace classes.** `module Api; module V1; class
  UsersController; ...; end; end; end` defines `Api::V1::UsersController`.
  The extractor may see these as three nested class/module nodes;
  reconstruct the full name when emitting candidates.
- **Plural vs singular.** Rails conventionally pluralises table names
  (`users`) and singularises model class names (`User`). When inferring
  the target of `has_many :posts`, the target entity is `Post`
  (singular, capitalised). `has_and_belongs_to_many :tags` → `Tag`.
- **`attr_accessor` / `attr_reader` / `attr_writer`.** Generates getter
  / setter methods for each symbol argument. These are effectively
  field declarations even though no `def` is present.
- **`self.method_name` defines class methods.** `def self.find_by_email`
  is a class-level (singleton) method; without `self.`, `def find_by_email`
  is an instance method. For serialisers and query helpers this is
  meaningful.
- **`private` / `protected` / `public` section markers.** Ruby's
  visibility is declared as a bare call that changes the visibility
  of everything defined after it within the class body. A method
  defined after `private` is not part of the public contract.
- **Generated and vendored code.** Skip files under `/vendor/`, the
  project's own `vendor/bundle/`, `tmp/`, `log/`, `coverage/`,
  generated migrations (`db/migrate/*.rb` are one-off data migrations
  — often NOT domain logic).
- **Test files.** `spec/` / `test/` directories, `*_spec.rb` /
  `*_test.rb` file suffixes, `rails_helper.rb` / `spec_helper.rb` /
  `test_helper.rb` — all test scaffolding, skip.
- **Documentation comments.** Ruby uses `#` line comments. Leading
  `##` or `# frozen_string_literal: true` pragmas are metadata, not
  business description. Actual documentation tends to live in YARD
  tags (`@param`, `@return`) or plain comments above `def`s.

## Confidence calibration for Ruby

- Class extending a known framework base (`< ApplicationController`,
  `< ApplicationRecord`, `< ActiveModel::Serializer`) with conventional
  action / association macros: 0.9+.
- Class in a conventionally named file path (`app/controllers/`,
  `app/models/`, `app/mailers/`, `app/jobs/`) following the
  `<name>_controller.rb` / `<name>.rb` / `<name>_job.rb` pattern even
  without an explicit base class: 0.8-0.9.
- Module intended as a mixin (`module SomeConcern; extend
  ActiveSupport::Concern; ...`) with class-method blocks: 0.8.
- Module-level function in a `lib/`-style plain-Ruby file with no
  framework context: 0.6-0.75.
- Class with `method_missing` or dynamic definitions — treat with
  caution, confidence drops because the class's real surface is
  opaque to static extraction: 0.55-0.7.
