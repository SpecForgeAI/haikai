# Symfony framework guidance

A `symfony` static analysis pack has already been run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see — not to restate
what it already captured.

## What the adapter already catches (do NOT re-emit these)

- **Controller classes** — classes extending `AbstractController` /
  `Controller` (name-suffix match), or carrying `#[AsController]`,
  emitted as `interfaces` candidates with the controller name and the
  class-level `#[Route]` base path.
- **Route endpoints** — method-level `#[Route('/path', methods:
  ['GET', ...])]` attributes combined with the class-level base path
  are emitted as `endpoints` candidates (`VERB /full/path`).
- **Doctrine entities** — classes carrying `#[ORM\Entity]` or
  `#[Entity]` attributes are emitted as `physical_data_entities` candidates
  with the `#[ORM\Table(name: '...')]` table-name inference.
- **Doctrine columns** — fields with `#[ORM\Column]` / `#[ORM\Id]`
  attributes are emitted as `physical_data_attributes` candidates, with
  `isPrimaryKey` set from the presence of `#[ORM\Id]`.
- **Doctrine relationships** — fields with `#[ORM\OneToMany]`,
  `#[ORM\ManyToOne]`, `#[ORM\OneToOne]`, or `#[ORM\ManyToMany]` are
  emitted as `logical_data_entity_relationships` candidates with cardinality
  inferred from the attribute name and a best-effort target class
  from `targetEntity: Foo::class`.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Symfony's architecture extends well beyond PHP 8 attributes on
controllers and entities. Typical blind spots:

- **PHPDoc `@Route` / `@ORM\Entity` annotations.** Symfony 3/4 era
  code uses `/** @Route("/path") */` comments on controller methods
  and `/** @ORM\Entity */` on entity classes instead of PHP 8
  attributes. The current adapter does NOT parse PHPDoc, so
  older codebases (and transitional Symfony 5 apps still on
  annotations) have the whole controller / entity surface invisible
  to the pack. Surface each `@Route` / `@ORM\Entity` / `@ORM\Column`
  / `@ORM\ManyToOne` as the corresponding endpoint / entity /
  attribute / relationship candidate.
- **DI container configuration files.** `config/services.yaml`,
  `config/services.xml`, and `config/packages/*.yaml` register
  services, set autowiring rules, tag services, and bind parameters.
  Each tagged service (`tags: ['kernel.event_listener']`,
  `tags: ['app.handler']`) is an architectural attachment point.
- **Event subscribers.** Classes implementing `EventSubscriberInterface`
  with a `getSubscribedEvents()` method wire listeners to Symfony
  events (`kernel.request`, `kernel.response`, `security.authentication`,
  Doctrine `prePersist`). Surface each
  `(event_name, handler_method)` pair as a cross-cutting / integration
  candidate.
- **Voters.** Classes extending `Voter` / implementing
  `VoterInterface` authorize specific actions (`supports($attribute,
  $subject)` + `voteOnAttribute($attribute, $subject, $token)`).
  Each voter encodes domain authorization rules; surface as
  business-rule candidates.
- **Form types.** Classes extending `AbstractType` with a
  `buildForm(FormBuilderInterface $builder, array $options)` method
  declare editable-data contracts. Each form type is a UI / input
  contract candidate; each `$builder->add('fieldName', FooType::class)`
  call identifies a form field.
- **Validators / constraints.** Classes extending `Constraint` +
  `ConstraintValidator` enforce domain validation rules. Surface
  each (constraint, validator) pair as a business-rule candidate.
- **Twig extensions.** Classes extending `AbstractExtension` expose
  filters and functions to templates via `getFilters()` /
  `getFunctions()`. Surface each template helper as a UI-layer
  integration.
- **Console commands.** Classes extending `Command` with
  `#[AsCommand(name: 'app:sync')]` (or the older
  `configure() { $this->setName('app:sync'); }`) expose CLI
  operations. Each command is an operational / admin-surface
  candidate.
- **Message handlers (Symfony Messenger).** Classes with `#[AsMessageHandler]`
  or implementing `MessageHandlerInterface` handle asynchronous
  messages (command/query buses, async queues). The
  `__invoke(MyMessage $message)` method processes the message. Surface
  each message class + handler pair as a business-logic /
  integration candidate.
- **Custom authenticators.** Classes extending
  `AbstractAuthenticator` or implementing `AuthenticatorInterface`
  hook into `security.yaml` firewalls. Each authenticator is an
  integration-point + security-logic candidate.
- **Security voters, firewalls, and access_control rules** in
  `config/packages/security.yaml`. Not a PHP class surface but a
  critical part of the app's authz model.
- **Dependency injection autoconfiguration.** Interfaces marked as
  auto-tagged via attribute annotations (`#[AsEventListener]`,
  `#[AsAlias]`, `#[AsTaggedItem]`) register services without explicit
  config. Surface the effect.
- **Routing annotations on class that ends in a name other than
  Controller.** If `class FooAction extends AbstractController` or
  a class implementing an `__invoke()` controller pattern carries
  `#[Route]`, the adapter's name-suffix match may miss it — depends
  on the `extends` chain.
- **Repositories (Doctrine).** Classes extending
  `ServiceEntityRepository` or `EntityRepository` encode reusable
  query logic. Each public repository method is a domain-query
  candidate distinct from the entity it operates on.
- **Event dispatchers / custom domain events.** Classes extending
  `Event` with paired dispatcher sites (`$dispatcher->dispatch($event,
  'my.event.name')`). Surface the event as a domain-event candidate.
- **Bundles.** Classes extending `Bundle` / implementing
  `BundleInterface` in `src/Bundle/*Bundle.php` register feature
  modules. Each bundle is a logical-component candidate.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
