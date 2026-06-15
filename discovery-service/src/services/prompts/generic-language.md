# Generic language guidance (Tier C fallback)

The file's language could not be confidently recognized, so no
language-specific idioms are available. Fall back to universally
applicable cues:

## Structural cues that usually survive any language

- **Module / class / function declarations** with PascalCase or
  CamelCase identifiers often denote architectural elements
  (services, controllers, handlers).
- **Suffixes and prefixes** such as `Service`, `Controller`, `Handler`,
  `Repository`, `Client`, `Manager`, `Gateway`, `Listener`, `Worker`,
  `Job`, `Scheduler`, `Publisher`, `Consumer` are strong role hints in
  virtually every ecosystem.
- **Import / require / include statements** often reveal integration
  boundaries - HTTP clients, message brokers, database drivers,
  scheduler libraries, etc.

## Extraction nuances when the language is unknown

- Treat block-comment content near the top of the file as likely
  business-intent documentation. A docblock that mentions a business
  concept ("Manages patient registrations", "Posts orders to the
  fulfilment queue") justifies emitting a candidate even without a
  clean structural anchor.
- Be wary of configuration / data files (JSON, YAML, TOML, XML).
  Unless the content obviously describes runtime wiring (bean
  definitions, route tables), do not treat them as code.
- When in doubt, lower confidence. Unrecognized languages justify
  lower default confidence than first-class language support.

## Safety rails

- Still obey the base schema strictly.
- Still never restate pack output (you probably have none here, but the
  rule applies even so).
- Still emit an empty array if nothing defensible is present.
