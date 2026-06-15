# Structural Analysis Standards

## Overview

- **Files analyzed:** 100
- **Total symbols:** 2482 (1881 function, 349 variable, 141 class, 93 property, 18 method)
- **Total call edges:** 7542
- **Total imports:** 0
- **Inheritance chains:** 0

## Languages

- JavaScript: 98 files
- javascript: 2 files

## Frameworks & Libraries

- No frameworks detected

## Dependency Graph (Top 15 Imports)

| Module | Files |
|--------|------:|

## Call Graph Hotspots (Top 15)

| Target | Calls |
|--------|------:|
| it | 709 |
| request | 603 |
| describe | 327 |
| express | 307 |
| require | 287 |
| request(app).get | 260 |
| next | 198 |
| app.use | 197 |
| app.get | 171 |
| createApp | 159 |
| test.set | 145 |
| res.send | 136 |
| done | 121 |
| request(this.app).post | 117 |
| test.write | 107 |

## Inheritance


## Triage Summary

- **Trivial files (SKIP):** 29
- **Complex files (ANALYZE):** 71

Complex files:
- `/tmp/test-js-express/examples/auth/index.js` (complexity: 0.47)
- `/tmp/test-js-express/examples/content-negotiation/index.js` (complexity: 0.33)
- `/tmp/test-js-express/examples/cookies/index.js` (complexity: 0.3)
- `/tmp/test-js-express/examples/error-pages/index.js` (complexity: 0.35)
- `/tmp/test-js-express/examples/error/index.js` (complexity: 0.31)
- `/tmp/test-js-express/examples/markdown/index.js` (complexity: 0.33)
- `/tmp/test-js-express/examples/mvc/index.js` (complexity: 0.33)
- `/tmp/test-js-express/examples/online/index.js` (complexity: 0.33)
- `/tmp/test-js-express/examples/params/index.js` (complexity: 0.33)
- `/tmp/test-js-express/examples/resource/index.js` (complexity: 0.41)
- `/tmp/test-js-express/examples/route-map/index.js` (complexity: 0.39)
- `/tmp/test-js-express/examples/route-middleware/index.js` (complexity: 0.34)
- `/tmp/test-js-express/examples/search/index.js` (complexity: 0.31)
- `/tmp/test-js-express/examples/vhost/index.js` (complexity: 0.32)
- `/tmp/test-js-express/examples/view-constructor/github-view.js` (complexity: 0.31)
- `/tmp/test-js-express/examples/view-constructor/index.js` (complexity: 0.31)
- `/tmp/test-js-express/examples/view-locals/index.js` (complexity: 0.39)
- `/tmp/test-js-express/examples/view-locals/user.js` (complexity: 0.31)
- `/tmp/test-js-express/examples/web-service/index.js` (complexity: 0.4)
- `/tmp/test-js-express/lib/application.js` (complexity: 0.5)
- `/tmp/test-js-express/lib/express.js` (complexity: 0.3)
- `/tmp/test-js-express/lib/request.js` (complexity: 0.4)
- `/tmp/test-js-express/lib/response.js` (complexity: 0.5)
- `/tmp/test-js-express/lib/utils.js` (complexity: 0.43)
- `/tmp/test-js-express/lib/view.js` (complexity: 0.4)
- `/tmp/test-js-express/test/Route.js` (complexity: 0.5)
- `/tmp/test-js-express/test/Router.js` (complexity: 0.5)
- `/tmp/test-js-express/test/acceptance/auth.js` (complexity: 0.4)
- `/tmp/test-js-express/test/acceptance/content-negotiation.js` (complexity: 0.33)
- `/tmp/test-js-express/test/acceptance/cookie-sessions.js` (complexity: 0.32)
- `/tmp/test-js-express/test/acceptance/cookies.js` (complexity: 0.36)
- `/tmp/test-js-express/test/acceptance/downloads.js` (complexity: 0.35)
- `/tmp/test-js-express/test/acceptance/error-pages.js` (complexity: 0.4)
- `/tmp/test-js-express/test/acceptance/error.js` (complexity: 0.32)
- `/tmp/test-js-express/test/acceptance/multi-router.js` (complexity: 0.35)
- `/tmp/test-js-express/test/acceptance/mvc.js` (complexity: 0.4)
- `/tmp/test-js-express/test/acceptance/params.js` (complexity: 0.35)
- `/tmp/test-js-express/test/acceptance/resource.js` (complexity: 0.39)
- `/tmp/test-js-express/test/acceptance/route-map.js` (complexity: 0.35)
- `/tmp/test-js-express/test/acceptance/route-separation.js` (complexity: 0.4)
- `/tmp/test-js-express/test/acceptance/vhost.js` (complexity: 0.35)
- `/tmp/test-js-express/test/acceptance/web-service.js` (complexity: 0.4)
- `/tmp/test-js-express/test/app.all.js` (complexity: 0.31)
- `/tmp/test-js-express/test/app.engine.js` (complexity: 0.5)
- `/tmp/test-js-express/test/app.head.js` (complexity: 0.35)
- `/tmp/test-js-express/test/app.js` (complexity: 0.5)
- `/tmp/test-js-express/test/app.listen.js` (complexity: 0.34)
- `/tmp/test-js-express/test/app.locals.js` (complexity: 0.3)
- `/tmp/test-js-express/test/app.options.js` (complexity: 0.4)
- `/tmp/test-js-express/test/app.param.js` (complexity: 0.4)
- `/tmp/test-js-express/test/app.render.js` (complexity: 0.5)
- `/tmp/test-js-express/test/app.request.js` (complexity: 0.4)
- `/tmp/test-js-express/test/app.response.js` (complexity: 0.5)
- `/tmp/test-js-express/test/app.route.js` (complexity: 0.4)
- `/tmp/test-js-express/test/app.router.js` (complexity: 0.43)
- `/tmp/test-js-express/test/app.routes.error.js` (complexity: 0.36)
- `/tmp/test-js-express/test/app.use.js` (complexity: 0.4)
- `/tmp/test-js-express/test/config.js` (complexity: 0.4)
- `/tmp/test-js-express/test/exports.js` (complexity: 0.43)
- `/tmp/test-js-express/test/express.json.js` (complexity: 0.5)
- `/tmp/test-js-express/test/express.raw.js` (complexity: 0.5)
- `/tmp/test-js-express/test/express.static.js` (complexity: 0.5)
- `/tmp/test-js-express/test/express.text.js` (complexity: 0.5)
- `/tmp/test-js-express/test/express.urlencoded.js` (complexity: 0.5)
- `/tmp/test-js-express/test/middleware.basic.js` (complexity: 0.34)
- `/tmp/test-js-express/test/req.accepts.js` (complexity: 0.4)
- `/tmp/test-js-express/test/req.acceptsCharsets.js` (complexity: 0.35)
- `/tmp/test-js-express/test/req.acceptsEncodings.js` (complexity: 0.31)
- `/tmp/test-js-express/test/req.acceptsLanguages.js` (complexity: 0.33)
- `/tmp/test-js-express/test/req.baseUrl.js` (complexity: 0.37)
- `/tmp/test-js-express/test/req.fresh.js` (complexity: 0.34)

## Structural Practices

- Object-oriented design (class-based)
- High inter-module coupling (many call edges)
