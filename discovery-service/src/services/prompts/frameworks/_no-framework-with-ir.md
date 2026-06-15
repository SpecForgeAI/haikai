# Tier B guidance - no framework pack, IR available

No framework-specific static analysis pack ran against this file.
You have been given a language-level intermediate representation
(IR) of the file: the list of classes, the methods declared on
each class, and the set of imports. Use the IR as the authoritative
source of structure; use the raw source only to disambiguate intent.

## How to use the IR

- **Classes + methods.** Treat each class in the IR as a possible
  architectural element. Name suffixes (`*Service`, `*Controller`,
  `*Repository`, `*Client`, `*Handler`, `*Listener`, `*Job`) are
  strong role hints when no framework markers are available.
- **Imports.** Imports reveal integration boundaries that the class
  surface alone may hide. Obvious examples:
  - HTTP client imports (RestTemplate, WebClient, axios, fetch
    wrappers, OkHttp, Feign) -> Integration candidate.
  - Message broker imports (Kafka, JMS, RabbitMQ, NATS, SQS,
    Pub/Sub) -> MessageProducer / MessageConsumer candidate.
  - Database driver imports with no ORM layer -> Repository
    candidate even on an otherwise plain class.
  - Scheduler imports (Quartz, Spring scheduling, agenda, node-cron)
    -> Scheduler candidate.
- **Method names.** Verbs like `publish*`, `consume*`, `handle*`,
  `poll*`, `schedule*`, `fetch*`, `post*` reinforce the role
  suggested by the class name and imports.

## Important - there is NO framework pack output here

Do not behave as if a pack ran. There is no pack-output JSON block
for this file, so every defensible candidate you see is potentially
novel. Still obey the base-layer schema and still avoid emitting
scaffolding / test / generated-code classes.

## Confidence calibration

- Class name + matching import + matching method names: 0.8-0.9.
- Class name alone (strong suffix, no import corroboration):
  0.65-0.8.
- Pure inference from method names inside an ambiguously named
  class: 0.5-0.65.
- Anything lower: omit.
