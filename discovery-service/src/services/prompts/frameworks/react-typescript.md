# React + TypeScript framework guidance

A `react-typescript` static analysis pack has already been run against
this file. Its output is injected into the prompt as a fenced JSON
array. You are here to surface what that pack CANNOT see - not to
restate what it already captured.

## What the adapter already catches (do NOT re-emit these)

- **UI components** — PascalCase function / class components that
  return JSX. The adapter distinguishes `ui_screens` (names ending
  `*Page` / `*Screen` / `*View`, or files under `src/pages/`) from
  plain `ui_components` (everything else).
- **Component type heuristics** via name suffix — `*Button` → button,
  `*Table` → table, `*Header` → layout, etc. These land in
  `data.component_type` on emitted `ui_components` candidates.
- **DTO logical entities** — `interface X { ... }`, `type X = { ... }`
  object-type aliases, plus their public fields as
  `logical_data_attributes` children.
- **Business-logic functions** — exported module-level functions that
  are NOT components, NOT hooks (`use*`), NOT CRUD-prefixed
  (`create*`, `update*`, `delete*`, `find*`, `fetch*`, `load*`,
  `list*`, `save*`), and NOT Redux-saga plumbing (`*Saga`).
- **Consumer-side endpoints** — `axios.get/post/put/delete/patch`
  call sites plus `fetch(url, { method })` call sites. URL, HTTP
  method, `apiLibrary`, `callingFunction`, and the generic type
  argument on axios (`axios.get<UserDto[]>`) land on the candidate.
- **Router-config names skipped** — `AppRoutes`, `Routes`,
  `MainRouter`, `*Router` do NOT land as `ui_components` / `ui_screens`.

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. Typical React + TypeScript
blind spots:

- **Context providers carrying business state.** `createContext<T>()`
  exports and their matching `*Provider` components usually encode a
  cross-cutting architectural concern (auth session, feature flags,
  theme, localization, cart contents, current-tenant selection). The
  adapter sees them as generic React components but does not mark
  them as stateful integration points — surface them as `integration`
  or `service` candidates depending on the payload.
- **Custom hook compositions.** A `use*` export that internally
  composes `useState`, `useEffect`, `useMemo`, `useReducer`, other
  custom hooks, a store selector, or an API call is almost always a
  discrete unit of business logic. The pack skips anything with a
  `use*` prefix — surface the genuine business hooks as
  `business_logics` candidates with a note explaining the hook's
  role.
- **Redux Toolkit slices + selectors.** `createSlice({ name, initialState,
  reducers })`, `createAsyncThunk`, `createSelector`, RTK Query
  `createApi` + `endpoints: builder.query / builder.mutation`. Each
  slice is a state-management boundary; each RTK Query endpoint is
  effectively an API call site. The structural adapter sees none of
  these.
- **Middleware + saga pipelines.** Redux middleware (`applyMiddleware`,
  `compose`), Redux-Saga effect calls (`call`, `put`, `take`,
  `takeLatest`, `fork`, `spawn`), Redux-Observable epics. These are
  pipeline stages the adapter does not capture beyond skipping
  `*Saga` names.
- **Server-Side Rendering + framework hooks.** Next.js `getServerSideProps`,
  `getStaticProps`, `getStaticPaths`, `generateMetadata`, route-level
  `loader` / `action` exports (Remix, React Router 6+), Astro
  `getStaticPaths`. Each is a server-execution surface the
  client-only adapter does not see.
- **Data-fetching library hooks** — React Query `useQuery` /
  `useMutation` / `useInfiniteQuery`, SWR `useSWR`, Apollo
  `useQuery` / `useMutation`, urql `useQuery`. The call sites are
  the integration boundary; the returned query keys or GraphQL
  operation names encode the backend contract. Emit an `endpoints`
  candidate per distinct query key / operation.
- **Form library integrations.** `react-hook-form` (`useForm`,
  `Controller`, `FormProvider`), Formik (`Formik`, `Field`), or
  plain controlled forms with validation schemas (Zod / Yup /
  Joi). Surface significant forms as `ui_components` candidates
  with `component_type: 'form'` and note the underlying schema.
- **Routing declarations.** `createBrowserRouter`, `<Routes>` /
  `<Route>` JSX trees, `RouteObject[]` configs, Tanstack Router
  `createFileRoute`. The adapter only skips the Router wrapper
  itself — surface the declared routes as navigational structure.
- **Testing-library seams.** `msw` (`setupServer`, `rest.get`,
  `graphql.query`) handlers describe the API contract the
  frontend is written against, even when no real backend is
  referenced. Treat significant MSW handlers as `endpoints`
  candidates tagged integration / mock.
- **Build / deploy metadata inside the tree.** `vite.config.ts`,
  `next.config.js`, `webpack.config.ts`, `turbo.json`,
  `package.json` scripts / engines / workspaces — frontend
  architecture details the source-file adapter ignores.
- **`.env*` files and `import.meta.env.*` reads.** Feature flags,
  API base URLs, third-party SDK keys referenced by the app
  encode real integrations (Stripe, Segment, Auth0, Sentry,
  LaunchDarkly, Datadog RUM). Each is a distinct integration
  candidate.
- **`i18n` resources.** `react-i18next`, `next-intl`, `formatjs`
  configuration + translation JSON bundles describe a
  localization boundary the adapter does not see.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
