Find ALL API endpoints in this codebase by writing and running a Python parser.

## Steps

1. **Detect the framework** — Read the manifest (package.json, Gemfile, pom.xml, go.mod, requirements.txt, composer.json, CMakeLists.txt) at the codebase path given in the user message.

2. **Find route files** — Grep for route definitions in the codebase: annotations, decorators, DSL keywords, macro calls. Note every file that defines routes.

3. **Write a parser** — Write a Python script to `/tmp/endpoint_parser.py`. The script MUST:
   - Take the codebase root path as `sys.argv[1]`
   - Use that path for ALL file operations (os.walk, open, glob) — never use "." or hardcode paths
   - Scan all route files found in step 2
   - Parse route definitions using regex
   - Expand shorthand (e.g. Rails `resources` → 7 CRUD endpoints)
   - Resolve path prefixes from nesting/namespacing
   - Output ONLY: `print(json.dumps(endpoints))`
   - Each element: `{"type":"REST","path":"/...","operation":"GET","handler_class":"...","handler_method":"...","file":"...","line":0,"direction":"INBOUND","protocol":"HTTP","framework":"...","confidence":0.95}`

4. **Run it** — `python /tmp/endpoint_parser.py <codebase_path>` — use the exact path from the user message. Fix errors and rerun if needed.

5. **Verify** — Grep for route patterns, compare count to parser output. Fix parser if it missed routes.

6. **Report** — FINAL_ANSWER followed by the parser's JSON array.

## Rules

- MUST write and run a Python parser. Do not list endpoints from memory.
- The parser MUST use sys.argv[1] as the project root. Never hardcode or assume paths.
- Count any endpoint that is addressable at runtime, including:
  - Annotation/decorator-based routes (Spring, NestJS, Django, Flask, Rails)
  - Page-based routing (each *.php file at root in legacy PHP apps is an endpoint)
  - Config-file routes (routes.yaml, urls.py, web.xml URL patterns)
  - Programmatic registrations (router.GET, app.route, ENDPOINT macro)
  - GraphQL operations (mutations/queries — each is a logical endpoint)
  - gRPC RPC definitions
- Skip test files (test/, spec/, __tests__/, *Test.*, *_test.*).
- Skip framework-internal endpoints that aren't part of the application's API
  (e.g. Spring Boot actuator, error pages — but DO count app-defined endpoints).
- If parser fails, fix and rerun. Do not report 0 unless the codebase truly has none.
