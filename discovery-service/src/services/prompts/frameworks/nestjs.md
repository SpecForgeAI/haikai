# NestJS framework guidance

A `nestjs` static analysis pack has already been run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see - not to restate
what it already captured.

## What the adapter already catches (do NOT re-emit these)

- **Controllers** annotated with `@Controller('path')` — emitted as
  `interfaces` candidates with `controllerType: 'NestController'` and
  `basePath` metadata.
- **HTTP endpoints** annotated with `@Get`, `@Post`, `@Put`,
  `@Delete`, `@Patch`, including composed `fullPath`, `@Param`
  variables, `@Body`-typed request body, `@Query` parameters, and
  the response type inferred from the method signature
  (`Promise<ArticleDto>` → `responseType: 'ArticleDto'`).
- **Services** annotated with `@Injectable()` and their non-CRUD
  business-logic methods. CRUD-prefixed methods (`find*`, `create*`,
  `update*`, `delete*`, `save*`, `get*`, `list*`) are filtered out;
  only genuine domain methods (e.g. `evaluateArticleScore`,
  `normalizeArticleSlug`) surface as `business_logics`.
- **TypeORM entities** annotated with `@Entity('table')` — emitted
  as `physical_data_entities` with `tableName`. Their `@Column` / 
  `@PrimaryGeneratedColumn` fields surface as `physical_data_attributes`
  (with `isPrimaryKey`), and `@ManyToOne` / `@OneToMany` /
  `@OneToOne` / `@ManyToMany` as `logical_data_entity_relationships` with
  `cardinality`.
- **DTO logical entities** — classes referenced by `@Body`
  parameters or method return types, plus their public fields as
  `logical_data_attributes` children.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. Typical NestJS blind
spots:

- **Guards, interceptors, pipes, filters.** `@UseGuards(AuthGuard)`,
  `@UseInterceptors(LoggingInterceptor)`, `@UsePipes(ValidationPipe)`,
  `@UseFilters(HttpExceptionFilter)` — class-level or method-level
  applications of each. Custom `CanActivate`, `NestInterceptor`,
  `PipeTransform`, `ExceptionFilter` implementations are the real
  authz / cross-cutting boundary. Surface each as a distinct
  architectural candidate.
- **Custom decorators.** `@Roles('admin')`, `@CurrentUser()`,
  `@Public()`, any `createParamDecorator` / `SetMetadata` export —
  these encode per-endpoint policy that the adapter sees only as
  opaque decorators. Surface the policy (authn / authz /
  rate-limiting / audit) as integration or cross-cutting concern.
- **Module graph.** `@Module({ imports, controllers, providers,
  exports })` declarations describe the dependency injection graph.
  `DynamicModule` patterns (`forRoot`, `forRootAsync`,
  `forFeature`) encode configurable integrations (`TypeOrmModule.forRoot`,
  `MongooseModule.forFeature`, `BullModule.registerQueue`,
  `HttpModule.register`). Each dynamic-module registration is a
  distinct external dependency worth surfacing.
- **Config subsystem.** `@nestjs/config` (`ConfigModule.forRoot`,
  `ConfigService.get<T>`), `@nestjs/jwt`, `@nestjs/throttler`,
  `@nestjs/terminus`, `@nestjs/swagger` — cross-cutting modules
  that often wire to external infrastructure the code-level
  adapter does not see.
- **Microservices layer.** `@MessagePattern('events.created')`,
  `@EventPattern('user.signed_up')`, `@GrpcMethod`,
  `@GrpcStreamMethod`, `@Payload()`, `@Ctx()`. These are inbound
  transport-layer endpoints ALONGSIDE the HTTP surface, not
  instead of it. Surface each message pattern as a separate
  `endpoints` candidate (subtype: `message_consumer`).
- **WebSocket gateways.** `@WebSocketGateway()`,
  `@SubscribeMessage('event')`, `@WebSocketServer()` — the
  real-time surface the HTTP-focused adapter ignores.
- **GraphQL resolvers.** `@Resolver(() => Article)`, `@Query`,
  `@Mutation`, `@Subscription`, `@ResolveField` — a parallel
  API surface that the REST-focused adapter does not see. Emit
  each resolver class as an `interfaces` candidate and each
  top-level `@Query` / `@Mutation` / `@Subscription` as an
  `endpoints` candidate.
- **Task scheduling + queues.** `@Cron('0 * * * *')`,
  `@Interval(5000)`, `@Timeout(3000)` (`@nestjs/schedule`),
  `@Processor('jobs')` + `@Process('job-name')` (`@nestjs/bull`).
  Each scheduled job or queue processor is a distinct runtime
  candidate.
- **Validation rules.** `class-validator` decorators on DTOs
  (`@IsString`, `@IsEmail`, `@MinLength`, `@IsIn`, `@IsUUID`,
  `@ValidateNested`, `@Type` from `class-transformer`,
  `@Expose` / `@Exclude`). The adapter sees the DTO but not the
  constraints — lift the validation rules into the
  `logical_data_attributes` descriptions.
- **OpenAPI / Swagger metadata.** `@ApiTags`, `@ApiOperation`,
  `@ApiResponse`, `@ApiProperty` — these decorate the intended
  public contract and often carry the only human-readable
  description of an endpoint or DTO field.
- **Health-check indicators.** `@nestjs/terminus` health
  controllers + custom `HealthIndicator` classes expose a
  separate operational HTTP surface alongside the business
  endpoints.
- **Caching + throttling.** `@CacheKey`, `@CacheTTL`,
  `@UseInterceptors(CacheInterceptor)`, `@Throttle(10, 60)` —
  per-endpoint policy the code-level adapter does not surface.
- **Shared providers.** `{ provide: 'TOKEN', useValue }`,
  `useFactory`, `useClass`, injection tokens (`@Inject('TOKEN')`).
  When the value is an external client (Kafka producer, S3 SDK,
  payment gateway) it's an integration candidate.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
