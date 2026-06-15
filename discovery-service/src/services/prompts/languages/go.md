# Go language guidance

## Idioms to recognize

- **Embedding instead of inheritance.** Go has no classical inheritance.
  A struct embeds another type by declaring it as a field without a
  name: `type UserRepo struct { *baseRepo; db *sql.DB }`. The embedded
  type's methods and fields are promoted to the outer type's method
  set. Recognising embedding is how you find "this type is a specialised
  `baseRepo`" — the static analogue of `class UserRepo extends BaseRepo`.
- **Interfaces are implicitly satisfied.** A type implements an
  interface by declaring every method in the interface's method set —
  no `implements` keyword, no explicit declaration. The idiomatic way
  to assert the implementation is a compile-time blank assignment:
  `var _ biz.UserRepo = (*userRepo)(nil)`. That blank line is the
  strongest static signal that `*userRepo` is the concrete
  implementation of `biz.UserRepo`. Grep for `var _ .* = (\*.*)\(nil\)`
  to find every type-to-interface binding in a Kratos-style codebase.
- **Context propagation as the first argument.** Every RPC-style method
  takes `ctx context.Context` as its first parameter:
  `func (s *UserService) GetUser(ctx context.Context, req *GetUserReq)
  (*GetUserReply, error)`. The presence of `ctx context.Context` as
  arg 0 plus `(result, error)` as the return shape is a strong signal
  the method is part of an RPC service contract (not a local helper).
- **Error handling via multi-value return, not exceptions.** Every
  fallible operation returns `(result, error)`; the caller inspects
  `err != nil` and either handles or propagates. Recognising
  `if err != nil { return nil, err }` as the canonical pass-through
  pattern distinguishes the happy path from branching domain logic.
  Custom error types are typically declared at package level:
  `var ErrUserNotFound = errors.New("user not found")`.
- **Reflection via `any` / `interface{}`.** The empty interface
  (`interface{}` in Go 1.17 and earlier, `any` in Go 1.18+) is the
  escape hatch for reflection-based code (JSON marshalling, ORM, DI
  containers). Functions parameterised on `any` are usually reflection-
  driven — the concrete runtime type is inspected at call time. Treat
  them like Java's `Object`-typed APIs: signal of a cross-cutting /
  infrastructure layer.
- **Struct tags encode framework metadata.** Backtick-delimited tags
  following a struct field carry framework-interpreted metadata:
  `ID int \`gorm:"primaryKey;column:id" json:"id" validate:"required"\``.
  The tag space is free-form but namespaced by the first key
  (`gorm`, `json`, `validate`, `yaml`, `xml`, `binding`, `form`). A
  field with a `gorm:` tag is DB-backed; a field with only `json:` is
  a transport DTO; `validate:` expresses business rules. Ent ORM uses
  a different convention (schema struct with `edge.To(...)` calls),
  not tags.
- **`init()` functions run at package load.** Every file in a package
  may declare a `func init()` that runs before `main()`. Used to
  register drivers (`sql.Register`), wire plugins, seed global state.
  An `init()` in a non-main package is a side-effect import —
  `import _ "github.com/go-sql-driver/mysql"` exists specifically to
  trigger the import target's `init()`. This is Go's answer to Spring's
  classpath scanning: the registration is implicit via import order.
- **Package as namespace + visibility boundary.** Capital-case names
  (`User`, `CreateUser`) are exported; lower-case (`userRepo`,
  `createUser`) are package-private. Idiomatic Go keeps a package small
  and focused (`biz`, `data`, `service`, `server` in Kratos) with the
  package name matching the directory. `package` declarations at file
  top are the authoritative namespace marker — not the file path,
  though convention aligns them.
- **Functional options pattern.** Constructors commonly take
  `...Option` variadic args, each `Option` a `func(*T)`: e.g.
  `grpc.NewServer(grpc.Middleware(...), grpc.Address(...))`. Recognise
  each option call (`grpc.Middleware`, `grpc.Network`, `grpc.Address`)
  as a distinct configuration surface even though syntactically they
  all look like function calls inside a slice literal.
- **Generics (Go 1.18+).** `func Map[T, U any](xs []T, f func(T) U)
  []U` — type parameters in square brackets. Relatively uncommon in
  application code but appears in libraries / utility packages.
- **Channels and goroutines as structural concurrency.** `go func() {
  ... }()` spawns a goroutine; `ch := make(chan T)` creates a channel.
  Channel sends / receives and `select` blocks are architectural —
  they denote asynchronous boundaries (worker pools, fan-in/fan-out,
  pub-sub).
- **Defer for cleanup.** `defer resp.Body.Close()` schedules a call at
  function return. Canonical for file / connection / lock cleanup.
  Defer presence signals a resource-owning function.
- **Protobuf-generated `.pb.go` files.** File names ending `.pb.go`
  or `_grpc.pb.go` under `api/` / `gen/` / `pb/` are machine-generated
  from `.proto` definitions. They contain request / reply message
  structs, service-interface types (`type UserServiceServer interface
  { ... }`), and client stubs. The `.proto` IDL is the true contract
  — the generated Go is a faithful but incomplete projection.

## Extraction nuances

- **Tree-sitter-go struct fields.** Each field declaration is a
  `field_declaration` node with a type and optional tag. Anonymous
  fields (embedded types) lack a name node — treat the type name as
  the field name for the purposes of inheritance walking.
- **Interface method sets.** `type X interface { Method(args) returns
  }` lists the method signatures. The extractor emits these as
  interface methods on a `ClassIR` with `isInterface=true`. Interface
  composition (`type X interface { Y; Method() }`) embeds another
  interface — the extractor may flatten or not depending on
  implementation.
- **Method receivers.** `func (r *userRepo) FindByUsername(...)` binds
  `FindByUsername` as a method on `*userRepo`. The receiver determines
  which class the function belongs to. Value receivers (`func (r
  userRepo)`) and pointer receivers (`func (r *userRepo)`) are both
  valid; pick up both.
- **Factory constructors.** Idiomatic Go names constructors `NewX`
  (top-level package function returning `*X` or `X`). These are NOT
  methods of X but are conventionally paired with it. `NewUserUseCase(
  repo UserRepo, logger log.Logger) *UserUseCase` is a DI entry point
  (wired by Wire / plain-code).
- **Generated files to skip.** `*.pb.go`, `*_grpc.pb.go`,
  `wire_gen.go`, `zz_generated_*.go`, `bindata.go`, `mock_*.go` — all
  machine-generated. Some carry genuine interface definitions worth
  keeping (the `_grpc.pb.go` service server interface is the gRPC
  service contract); others are pure plumbing. The adapter's
  `Server/Client/Service` name heuristic filters interface-naming-wise
  but does not exclude by filename.
- **Vendor directories.** `/vendor/` is Go's frozen-dependency
  directory (pre-modules convention). Skip. `go.mod` / `go.sum` are
  dependency metadata, not source.
- **Test files.** `_test.go` suffix by convention. Contain `func
  TestX(t *testing.T)` / `func BenchmarkX(b *testing.B)` /
  example functions. Skip — the harness filters these out.
- **Build tags.** `//go:build windows` / `// +build linux` at the top
  of a file conditionalise compilation. These files may be dead code
  on the current platform but are still part of the logical surface.

## Confidence calibration for Go

- Struct with any `gorm:` tag: very high confidence it's a physical
  entity (0.9+).
- Struct with only `json:` tags and clear request/reply naming
  (`*Request`, `*Reply`, `*Req`, `*Resp`): 0.85-0.9 as a DTO /
  logical entity.
- Interface type ending `Server` / `Service` / `Client`: 0.85 as an
  RPC service contract — proto-generated or hand-defined.
- Interface type ending `Repo` / `Repository`: 0.85 as a repository
  contract — the biz/data layering convention in Kratos and most Go
  microservice frameworks.
- Type with methods taking `ctx context.Context` and returning
  `(result, error)`: 0.8+ as service-layer / RPC-style surface.
- Struct with no tags, no exported methods, private package: 0.55-0.7
  as internal helper — might be real domain logic or might be
  plumbing; context-dependent.
- `init()` function contents: treat the registrations inside as
  cross-cutting integration points (driver register, observer
  register, plugin register) at 0.75+.
