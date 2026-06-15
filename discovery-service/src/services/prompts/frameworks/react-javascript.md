# React + JavaScript framework guidance

A `react-javascript` static analysis pack has already been run against
this file. Its output is injected into the prompt as a fenced JSON
array. You are here to surface what that pack CANNOT see — not to
restate what it already captured.

The `react-javascript` pack shares its adapter logic with
`react-typescript` (same `runReactAxiosAdapter` underneath). The
difference is purely the input language: the JS pack consumes IR from
.js / .jsx files (parsed via the TypeScript grammar with type
annotations absent), the TS pack consumes IR from .ts / .tsx files.
The adapter heuristics behave identically. **The misses listed in
`prompts/frameworks/react-typescript.md` apply equally to this pack —
treat that file as the canonical reference for framework-level
blind spots.** This file documents the JavaScript-specific additions.

## What the adapter already catches (do NOT re-emit these)

Same surface as `react-typescript` — see `prompts/frameworks/react-
typescript.md` for the canonical list. Briefly:

- **UI components** — PascalCase function / class components in `.jsx`
  files, classified as `ui_screens` (`*Page` / `*Screen` / `*View` name
  suffix or immediate parent dir is `pages/` / `screens/` / `routes/`
  / `views/`) vs plain `ui_components`.
- **Class components** — classes extending `Component` / `React.
  Component` / `PureComponent`.
- **Business-logic functions** — exported module-level functions that
  are NOT components, NOT hooks, NOT CRUD-prefixed, NOT `*Saga`.
- **Consumer-side endpoints** — `axios.{get,post,put,delete,patch,
  request}` and `fetch(url, opts)` call sites with URL / method /
  apiLibrary / callingFunction extracted.
- **Logical entities** — TS interfaces / object-type aliases. Note:
  JS has no `interface` keyword, so this path emits NOTHING for JS
  files. DTO classes in JS are typically plain object literals or
  JSDoc-typed classes; the adapter does not detect either.
- **Router-config name skip** — `Routes`, `AppRoutes`, `*Router`
  function / class names are deliberately skipped (structural, not
  user-visible).

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## What the adapter MISSES (your target surface area)

Cross-reference `prompts/frameworks/react-typescript.md` for the full
list — Context providers with business state, custom hook
compositions, Redux Toolkit slices and selectors, RTK Query, Saga /
Thunk middleware, Next.js / Remix server hooks (`getServerSideProps`,
`loader`, `action`), data-fetching library hooks (React Query, SWR,
Apollo), form library integrations, routing declarations, MSW
handlers, build / deploy metadata, environment variables,
internationalisation. **All of those apply equally to React + JS
codebases — surface them in the same way as you would for React +
TS.**

JavaScript-specific additions on top of the cross-referenced list:

- **`React.createClass({ ... })` legacy class components.** Pre-React-
  16 codebases used `var Foo = React.createClass({ render: function()
  { return ...; }, getInitialState: function() { ... }, propTypes:
  { ... } });`. The adapter's class-component detector keys off
  ES6 `class Foo extends Component` syntax — it does NOT match
  `React.createClass(...)` call expressions. Each `React.createClass`
  call assigned to a PascalCase variable is a class component;
  surface the `propTypes` object as the component's prop contract
  (analogous to a TS interface for props).
- **`PropTypes` declarations as DTO surrogates.** `Foo.propTypes = {
  name: PropTypes.string.isRequired, age: PropTypes.number, items:
  PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string }))
  };` is the JS equivalent of a TS prop interface. The adapter does
  NOT detect propTypes assignments — surface each `Foo.propTypes`
  declaration as a `logical_data_entities` named after the component, with
  each property as a `logical_data_attributes`.
- **`defaultProps` static assignments.** `Foo.defaultProps = { age:
  18, items: [] };` declares default values for props. The adapter
  ignores these. The defaults are business-meaningful (they encode
  fallback behaviour) — surface them as part of the component's
  contract documentation.
- **HOCs (higher-order components) and composition idioms.**
  `connect(mapStateToProps, mapDispatchToProps)(MyComponent)`
  (Redux), `withRouter(MyComponent)` (React Router 5 and earlier),
  `compose(withRouter, connect(...))(MyComponent)`,
  `injectIntl(MyComponent)` (react-intl). Each HOC call wraps a
  component with cross-cutting behaviour. The adapter sees the
  inner component but NOT the HOC wrapping — surface the
  composition chain because it encodes which middleware /
  store / router / i18n surface the component depends on.
- **Render-props children pattern.** `<DataLoader>{({ data, loading
  }) => <UserList users={data} />}</DataLoader>` — the parent
  component receives a function as `children` and passes
  state to it. The adapter sees both components but not the
  data-flow contract between them. Render-props is the
  pre-hooks pattern for sharing stateful logic; surface the
  contract surface (parent's render-callback signature) as the
  component's API.
- **Compound components.** `<Tabs><Tab>...</Tab><Tab>...</Tab></Tabs>`
  where `Tabs` and `Tab` share state via React.Children + Context
  internally. The compound API is the public contract — emit each
  sub-component and the parent as a related set, not as
  independent components.
- **CommonJS module factories.** `module.exports = function(deps) {
  return { foo: function() { ... } }; };` — a module that exports
  a factory function rather than a value. Common in Node-style
  React + Express monorepos. The adapter detects neither the
  factory function nor the returned object's methods as
  business logic — surface the returned shape as the module's
  public surface.
- **UMD-wrapped libraries embedded in source.** Some teams vendor
  a library directly into `src/lib/myLib.js` rather than
  installing it as a dependency. The UMD wrapper hides the
  actual library surface inside an IIFE; the adapter sees one
  giant function expression and emits nothing meaningful.
  Recognise the UMD pattern and surface the exported library
  name as a vendored-dependency boundary.
- **Plain-JS hook compositions.** `function useArticleData(slug) {
  const [data, setData] = useState(null); useEffect(() => {
  fetchArticle(slug).then(setData); }, [slug]); return data; }`.
  The adapter skips `use*`-prefixed exports per the CRUD-filter
  list — this is the same blind spot as in React + TS, but
  because JS has no type annotations, the hook's return shape is
  even less visible to downstream tooling. Surface the genuine
  business hooks as `business_logics` candidates with a note
  describing the underlying data flow.
- **Redux Toolkit / Reduxjs slices in plain JS.** `createSlice({
  name: 'articles', initialState: { items: [] }, reducers: { ... }
  })` — same shape as TS, just no type annotations. Each slice is
  a state-management boundary; each slice action is a domain
  event; each reducer is business logic. The adapter sees none
  of this. (Cross-reference `react-typescript.md` — the
  surfacing strategy is identical.)
- **Connect HOC mapStateToProps / mapDispatchToProps.** `function
  mapStateToProps(state, ownProps) { return { article: state.
  articles.byId[ownProps.id] }; }` and `function mapDispatch
  ToProps(dispatch) { return { loadArticle: (id) => dispatch
  (loadArticle(id)) }; }` are the Redux ↔ component
  integration boundary. The adapter treats them as plain
  business-logic functions if they are exported (good) or
  ignores them if they are file-local (not surfaced). Surface
  the dispatch-mapping shape as the component's command-surface
  contract.
- **Event handlers attached via JSX.** `<button onClick={handleClick}
  />` — the `handleClick` reference in the JSX attribute is the
  event-binding contract. The adapter detects neither the event
  attachment nor the handler's role. Identify event handlers by
  the `handle*` / `on*` naming convention and surface them as
  the component's interactive surface.
- **Selector functions for stores.** `export const selectActiveUser
  = (state) => state.users.byId[state.session.userId];` —
  selector functions encode read-paths through a Redux / Recoil /
  Zustand store. The adapter treats them as business-logic if
  they pass the export-and-not-CRUD-prefixed filter; many
  selectors start `select*` (not in the exclude list) so they
  may pass through, but their architectural role as
  "store read contract" is not captured. Surface major
  selectors with a note about the underlying store key.
- **Side-effect imports.** `import './styles.css';`, `import
  './polyfills';`, `import 'react-toastify/dist/ReactToastify.
  css';` — imports with no binding name are pure side-effect
  loads. The adapter ignores these. Stylesheet imports define
  the visual contract; polyfill imports define the runtime
  compatibility floor. Surface significant side-effect imports
  as architectural metadata.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.

Note: this pack is known low-coverage on real-world repos
(`react-redux-realworld` baseline: 9 candidates across the entire
repo). The LLM gap-fill stage is doing the heavy lifting on this
stack — prioritise propTypes-as-DTO, HOC composition chains,
custom hook compositions, Redux Toolkit slices, and event handlers,
in that order. See `prompts/frameworks/react-typescript.md` for the
React-framework-level misses that apply equally here.

## Gap-fill targets (11th candidate type)

- **`interface_logical_entities`.** This framework's pack does NOT yet emit `interface_logical_entities` candidates. When an `interfaces` candidate (API controller, resolver, handler class) in this file references a `logical_data_entities` candidate (DTO, request/response body type) that is also defined somewhere in the project, emit an `interface_logical_entities` candidate named `InterfaceClass → LogicalDataEntityClass` (ASCII arrow, single spaces). Per-interface granularity — one entry per (interface, logical_data_entity) pair regardless of how many endpoints reference the DTO.
