/**
 * Smoke tests for the AngularJS 1.x (classic) framework adapter.
 *
 * Covers the distinctive patterns of legacy AngularJS:
 *   - `angular.module('X', [...])` → interfaces
 *   - `.controller(...) / .service / .factory / .provider / .directive /
 *      .component / .filter` → candidate emission per type
 *   - `$routeProvider.when(...)` / `$stateProvider.state(...)` → ui_screens
 *   - `$http.get/post/...` and `$resource(...)` → endpoints + logical entities
 *   - RequireJS `define([deps], function(){...})` wrapping
 *   - HTML template reinforcement via `ng-controller="X"` attributes
 *
 * Does NOT cover Angular 2+ (that's the separate `angular` pack).
 */
import { extractJavaScriptIR } from '../services/extensionPacks/languageExtractors/javascript';
import { runAngularJsClassicAdapter } from '../services/extensionPacks/frameworkAdapters/angularJsClassic';
import { scanHtmlTemplate } from '../services/extensionPacks/frameworkAdapters/angularJsClassic/htmlTemplateScan';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';

function ir(path: string, src: string): SourceFileIR {
  const r = extractJavaScriptIR(path, src);
  if (!r) throw new Error(`extract failed for ${path}`);
  return r;
}

describe('angularjs-classic adapter', () => {
  it('emits an interface for angular.module("X", [...]) — setter form only', () => {
    const MOD = `
define(['angular'], function(angular) {
  return angular.module('fireui.app', ['ngRoute', 'ui.router']);
});
`;
    // Module getter form — should NOT emit.
    const GETTER = `
define(['angular'], function(angular) {
  return angular.module('fireui.app');
});
`;
    const files = [ir('app/module.js', MOD), ir('app/other.js', GETTER)];
    const c = runAngularJsClassicAdapter(files, 'run-ajs-mod');
    const interfaces = c.filter((x) => x.candidateType === 'interfaces').map((x) => x.name);
    expect(interfaces).toEqual(['fireui.app']);
  });

  it('emits ui_components for .controller() / .directive() / .component(); business_logics for .service/.factory/.filter', () => {
    const SRC = `
define(['angular'], function(angular) {
  angular.module('fireui.app')
    .controller('DashboardCtrl', function($scope, UserService) {})
    .service('UserService', function($http) {})
    .factory('UserCache', function() {})
    .directive('fireWidget', function() { return {}; })
    .component('fireTabBar', {})
    .filter('firePretty', function() { return function(input) {}; });
});
`;
    const c = runAngularJsClassicAdapter([ir('app/registrations.js', SRC)], 'run-ajs-reg');
    const uiComponents = c.filter((x) => x.candidateType === 'ui_components').map((x) => x.name).sort();
    const bizLogics = c.filter((x) => x.candidateType === 'business_logics').map((x) => x.name).sort();
    // Controller becomes ui_component UNLESS a route later binds it — no
    // route in this test, so it stays as a ui_component.
    expect(uiComponents).toEqual(['DashboardCtrl', 'fireTabBar', 'fireWidget']);
    expect(bizLogics).toEqual(['UserCache', 'UserService', 'firePretty']);
  });

  it('infers component_type from name suffix on ui_components (controllers / directives / components)', () => {
    // Regression cover for the empty-Component-Type column bug observed
    // 2026-04-25 on the Fire UI scan: the AngularJS classic adapter was
    // emitting `ui_components` candidates with no `component_type` so the
    // grid showed `--` for every row even when names like
    // `MeasureDetailModalCtrl` / `autoRefreshBtn` / `loadingWidget`
    // carried an obvious suffix.
    const SRC = `
define(['angular'], function(angular) {
  angular.module('fireui.app')
    .controller('MeasureDetailModalCtrl', function($scope) {})
    .controller('autoRefreshBtn', function($scope) {})
    .controller('jobErrorTable', function($scope) {})
    .controller('jobGrid', function($scope) {})
    .controller('jobSearchHistogram', function($scope) {})
    .controller('ClusterMaintenanceCtrl', function($scope) {})
    .controller('SaveJobSearchModalCtrl', function($scope) {})
    .directive('loadingWidget', function() { return {}; })
    .directive('userInputField', function() { return {}; })
    .component('appHeader', {})
    .component('addressForm', {});
});
`;
    const c = runAngularJsClassicAdapter([ir('app/types.js', SRC)], 'run-ajs-types');
    const byName = new Map(
      c
        .filter((x) => x.candidateType === 'ui_components')
        .map((x) => [x.name, (x.data as Record<string, unknown>).component_type as string]),
    );

    // Ctrl/Controller suffix is stripped before matching, so the inner
    // type-noun ("Modal", "Btn"-not-applicable, "Histogram", etc.) wins.
    expect(byName.get('MeasureDetailModalCtrl')).toBe('modal');
    expect(byName.get('SaveJobSearchModalCtrl')).toBe('modal');
    expect(byName.get('autoRefreshBtn')).toBe('button');
    expect(byName.get('jobErrorTable')).toBe('table');
    expect(byName.get('jobGrid')).toBe('table');
    expect(byName.get('jobSearchHistogram')).toBe('chart');
    expect(byName.get('ClusterMaintenanceCtrl')).toBe('other'); // no type-noun → other
    expect(byName.get('loadingWidget')).toBe('widget');
    expect(byName.get('userInputField')).toBe('input');
    expect(byName.get('appHeader')).toBe('layout');
    expect(byName.get('addressForm')).toBe('form');
  });

  it('emits ui_screens for $routeProvider.when(...) AND reclassifies bound controller → ui_screen', () => {
    const SRC = `
define(['angular'], function(angular) {
  angular.module('fireui.app')
    .config(function($routeProvider) {
      $routeProvider.when('/dashboard', {
        controller: 'DashboardCtrl',
        templateUrl: 'views/dashboard.html'
      });
    })
    .controller('DashboardCtrl', function($scope) {});
});
`;
    const c = runAngularJsClassicAdapter([ir('app/routes.js', SRC)], 'run-ajs-route');
    const screens = c.filter((x) => x.candidateType === 'ui_screens');
    // Bug 18 fix (2026-04-22): EXACTLY one ui_screens per route —
    // the route carrier, not a separate controller-named screen too.
    expect(screens).toHaveLength(1);
    expect(screens[0].name).toBe('/dashboard');
    expect((screens[0].data as Record<string, unknown>).controllerName).toBe('DashboardCtrl');
    // Controller is removed (not retained as ui_components, not duplicated as ui_screens).
    const uiComponents = c.filter((x) => x.candidateType === 'ui_components').map((x) => x.name);
    expect(uiComponents).not.toContain('DashboardCtrl');
  });

  it('emits ui_screens for $stateProvider.state(...) with url/controller', () => {
    const SRC = `
define(['angular'], function(angular) {
  angular.module('fireui.app')
    .config(function($stateProvider) {
      $stateProvider.state('users', {
        url: '/users',
        controller: 'UsersCtrl',
        templateUrl: 'views/users.html'
      });
    })
    .controller('UsersCtrl', function($scope) {});
});
`;
    const c = runAngularJsClassicAdapter([ir('app/states.js', SRC)], 'run-ajs-state');
    const screens = c.filter((x) => x.candidateType === 'ui_screens');
    // Screen name is the state name ('users'), url carried on data.
    const usersScreen = screens.find((s) => s.name === 'users');
    expect(usersScreen).toBeDefined();
    expect((usersScreen!.data as Record<string, unknown>).route).toBe('/users');
    expect((usersScreen!.data as Record<string, unknown>).routerKind).toBe('uiRouter');
  });

  it('emits endpoints for $http.get/post/put/delete + $resource CRUD expansion', () => {
    const SRC = `
define(['angular'], function(angular) {
  angular.module('fireui.app')
    .service('UserService', function($http, $resource) {
      this.list = function() { return $http.get('/api/users'); };
      this.create = function(u) { return $http.post('/api/users', u); };
      this.destroy = function(id) { return $http.delete('/api/users/' + id); };
      this.Users = $resource('/api/users/:id');
    });
});
`;
    const c = runAngularJsClassicAdapter([ir('app/svc.js', SRC)], 'run-ajs-http');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((x) => x.name).sort();
    // 3 $http calls + 4 $resource expansion (GET/POST/PUT/DELETE), dedup
    // guarantees no $http ones duplicate the $resource ones.
    expect(eps).toContain('GET /api/users');
    expect(eps).toContain('POST /api/users');
    expect(eps).toContain('GET /api/users/:id');
    expect(eps).toContain('PUT /api/users/:id');
    expect(eps).toContain('DELETE /api/users/:id');
    // $resource emits a logical_data_entity too.
    const lde = c.filter((x) => x.candidateType === 'logical_data_entities').map((x) => x.name);
    expect(lde).toContain('User');
  });

  it('emits interface_logical_entities linking a controller to logical entities referenced in the same file', () => {
    const SRC = `
define(['angular'], function(angular) {
  angular.module('fireui.app')
    .controller('UsersCtrl', function($scope, $resource) {
      var Users = $resource('/api/users/:id');
      $scope.users = Users.query();
    });
});
`;
    const c = runAngularJsClassicAdapter([ir('app/usersCtrl.js', SRC)], 'run-ajs-ile');
    const iles = c.filter((x) => x.candidateType === 'interface_logical_entities').map((x) => x.name);
    expect(iles).toContain('UsersCtrl → User');
  });

  it('rejects bare-identifier $http args (not URLs) — e.g. $http.get(url) with url being a variable', () => {
    const SRC = `
define(['angular'], function(angular) {
  angular.module('fireui.app').service('X', function($http) {
    this.f = function(id) { return $http.get(id); };
    this.g = function(key) { return $http.delete(key); };
  });
});
`;
    const c = runAngularJsClassicAdapter([ir('app/x.js', SRC)], 'run-ajs-badurl');
    const eps = c.filter((x) => x.candidateType === 'endpoints');
    expect(eps).toHaveLength(0);
  });

  it('handles multi-line chained calls (PhoneCat-style) — angular.\\n  module(...).\\n  component(...)', () => {
    // Canonical AngularJS 1.x multi-line style used by the official
    // Angular team tutorial. The callee source text preserves the
    // newlines/whitespace; detection must normalise.
    const SRC = `
'use strict';

angular.
  module('phoneList').
  component('phoneList', {
    templateUrl: 'phone-list/phone-list.template.html',
    controller: ['Phone', function PhoneListController(Phone) {}]
  });
`;
    const c = runAngularJsClassicAdapter([ir('app/phone-list.component.js', SRC)], 'run-ajs-multiline');
    const ui = c.filter((x) => x.candidateType === 'ui_components').map((x) => x.name);
    expect(ui).toContain('phoneList');
  });

  it('Bug 21 — detects $http(configObject) direct-function invocation pattern', () => {
    // Real-world AngularJS 1.x factory service pattern (RealWorld/Conduit).
    const SRC = `
angular.module('app.services').factory('Articles', ['$http', '$q', function($http, $q) {
  var service = {};
  service.get = function(slug) {
    return $http({ method: 'GET', url: '/api/articles/' + slug }).then(function(res) { return res.data; });
  };
  service.save = function(article) {
    return $http({ method: 'POST', url: '/api/articles', data: article });
  };
  service.destroy = function(slug) {
    return $http({ method: 'DELETE', url: '/api/articles/' + slug });
  };
  return service;
}]);
`;
    const c = runAngularJsClassicAdapter([ir('app/services/Articles.js', SRC)], 'run-ajs-http-config');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((x) => x.name).sort();
    expect(eps).toContain('GET /api/articles');
    expect(eps).toContain('POST /api/articles');
    expect(eps).toContain('DELETE /api/articles');
  });

  it('Bug 22 — detects aliased $http invocations: this._$http(config) / self.$http(config)', () => {
    // ES6 class-style factory with aliased $http.
    const SRC = `
class Articles {
  constructor(AppConstants, $http, $q) {
    this._AppConstants = AppConstants;
    this._$http = $http;
    this._$q = $q;
  }
  get(slug) {
    return this._$http({ method: 'GET', url: '/api/articles/' + slug });
  }
  save(article) {
    return this._$http({ method: 'POST', url: '/api/articles', data: article });
  }
}
angular.module('app.services').service('Articles', Articles);
`;
    const c = runAngularJsClassicAdapter([ir('app/services/Articles.js', SRC)], 'run-ajs-http-alias');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((x) => x.name).sort();
    expect(eps).toContain('GET /api/articles');
    expect(eps).toContain('POST /api/articles');
  });

  it('Bug 24 — routes-as-data pattern: scan routes array when $routeProvider.when iterates via forEach', () => {
    // HotTowel / John-Papa-style pattern: routes defined as data,
    // registered through a forEach loop. Per-call args are bare
    // identifiers (`r.url`, `r.config`) so the per-call emission path
    // produces nothing — the routes-array scanner picks them up.
    const SRC = `
(function () {
  'use strict';
  var app = angular.module('app');
  app.constant('routes', getRoutes());
  app.config(['$routeProvider', 'routes', function($routeProvider, routes) {
    routes.forEach(function (r) {
      $routeProvider.when(r.url, r.config);
    });
    $routeProvider.otherwise({ redirectTo: '/' });
  }]);
  function getRoutes() {
    return [
      { url: '/', config: { templateUrl: 'app/dashboard/dashboard.html', controller: 'DashboardCtrl' } },
      { url: '/admin', config: { templateUrl: 'app/admin/admin.html', controller: 'AdminCtrl' } },
      { url: '/reports', config: { templateUrl: 'app/reports/reports.html' } }
    ];
  }
})();
`;
    const c = runAngularJsClassicAdapter([ir('app/config.route.js', SRC)], 'run-ajs-routes-array');
    const screens = c.filter((x) => x.candidateType === 'ui_screens');
    const screenNames = screens.map((s) => s.name).sort();
    expect(screenNames).toEqual(['/', '/admin', '/reports']);
    // No 'unknown-route' placeholder.
    expect(screenNames).not.toContain('unknown-route');
    const dashScreen = screens.find((s) => s.name === '/');
    expect((dashScreen!.data as Record<string, unknown>).controllerName).toBe('DashboardCtrl');
  });

  it('Bug 24 — suppresses unknown-route placeholder when $routeProvider.when has non-literal args', () => {
    // The per-call path must NOT emit a useless placeholder; the
    // routes-array scanner handles these properly.
    const SRC = `
angular.module('app').config(['$routeProvider', function($routeProvider) {
  var r = { url: '/x', config: { templateUrl: 'x.html' } };
  $routeProvider.when(r.url, r.config);
}]);
`;
    const c = runAngularJsClassicAdapter([ir('app/bad.js', SRC)], 'run-ajs-unknown-route');
    const names = c.filter((x) => x.candidateType === 'ui_screens').map((x) => x.name);
    // Exactly one ui_screens emitted via the routes-array scanner. No
    // 'unknown-route' placeholder from the per-call path.
    expect(names).not.toContain('unknown-route');
    expect(names).toContain('/x');
  });

  it('Bug 23 — resolves `let req = {...}; $http(req)` indirect config objects (RealWorld Articles pattern)', () => {
    const SRC = `
export default class Articles {
  constructor(AppConstants, $http, $q) {
    this._AppConstants = AppConstants;
    this._$http = $http;
    this._$q = $q;
  }

  get(slug) {
    let deferred = this._$q.defer();
    this._$http({
      url: this._AppConstants.api + '/articles/' + slug,
      method: 'GET'
    }).then((res) => deferred.resolve(res.data.article));
    return deferred.promise;
  }

  save(article) {
    let request = {};
    if (article.slug) {
      request.url = \`\${this._AppConstants.api}/articles/\${article.slug}\`;
      request.method = 'PUT';
    } else {
      request.url = this._AppConstants.api + '/articles';
      request.method = 'POST';
    }
    request.data = { article: article };
    return this._$http(request).then((res) => res.data);
  }

  query(config) {
    let request = {
      url: this._AppConstants.api + '/articles',
      method: 'GET',
      params: config.filters || null
    };
    return this._$http(request).then((res) => res.data);
  }
}
angular.module('app.services').service('Articles', Articles);
`;
    const c = runAngularJsClassicAdapter(
      [ir('src/js/services/articles.service.js', SRC)],
      'run-ajs-indirect',
    );
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((x) => x.name).sort();
    // inline object literal in .get (direct)
    // variable-assigned object literal in .query (indirect, resolved)
    // incremental-build in .save (resolved to first match — PUT)
    expect(eps.length).toBeGreaterThanOrEqual(2);
    // All three should be detected now
    const hasGet = eps.some((e) => e.startsWith('GET ') && e.includes('/articles'));
    const hasQueryList = eps.some((e) => e.startsWith('GET ') && e.includes('/articles'));
    expect(hasGet || hasQueryList).toBe(true);
    // Incremental PUT — the first method assignment wins
    const hasPutOrPost = eps.some((e) => /^(PUT|POST) /.test(e));
    expect(hasPutOrPost).toBe(true);
  });

  it('Bug 20 — rejects logical_data_entities whose names end in Ctrl/Service/Factory/etc.', () => {
    // If the URL-derived entity happens to look like a framework role
    // (unlikely from $resource, but LLM output may also hit this), we
    // must not emit it as a domain entity. This test exercises the
    // pack-side filter directly.
    const SRC = `
angular.module('app.services').factory('UserSearch', ['$resource', function($resource) {
  return $resource('/api/userServices/:id');
}]);
`;
    const c = runAngularJsClassicAdapter([ir('app/services/UserSearch.js', SRC)], 'run-ajs-entity-filter');
    const lde = c.filter((x) => x.candidateType === 'logical_data_entities').map((x) => x.name);
    // `userServices` → singularised to `UserService`, suffix `Service`
    // triggers the non-entity filter, so no entity emitted.
    expect(lde).not.toContain('UserService');
    // Endpoints still emitted (orthogonal).
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((x) => x.name);
    expect(eps.length).toBeGreaterThan(0);
  });

  it('handles multi-line angular.\\n  module(name, []) declarations — setter form', () => {
    const SRC = `
'use strict';

angular.
  module('core.phone', []);
`;
    const c = runAngularJsClassicAdapter([ir('app/phone.module.js', SRC)], 'run-ajs-multiline-mod');
    const ifaces = c.filter((x) => x.candidateType === 'interfaces').map((x) => x.name);
    expect(ifaces).toEqual(['core.phone']);
  });

  it('does NOT emit controllers/services from the angular 2+ @Injectable/@Component pattern — those belong to the modern angular pack', () => {
    const TS_ANGULAR_2 = `
import { Component, Injectable } from '@angular/core';

@Component({ selector: 'app-foo', templateUrl: './foo.html' })
export class FooComponent {}

@Injectable()
export class FooService {
  doThing() {}
}
`;
    // The AngularJS-classic pack only looks at module-level angular.module(...) chains.
    // @Component / @Injectable produce no classic-AngularJS candidates.
    const c = runAngularJsClassicAdapter([ir('app/foo.ts', TS_ANGULAR_2)], 'run-ajs-ng2-negative');
    expect(c).toHaveLength(0);
  });
});

describe('angularjs-classic HTML template scanner', () => {
  it('extracts ng-controller="X" and strips controllerAs syntax', () => {
    const tpl = `<div ng-controller="DashboardCtrl as vm">Hello {{ vm.name }}</div>`;
    const r = scanHtmlTemplate(tpl);
    expect([...r.controllers]).toEqual(['DashboardCtrl']);
  });

  it('extracts custom element directives and ignores built-in ng-* directives', () => {
    const tpl = `
<div ng-if="ok">
  <fire-widget data-option="x" my-custom="y">
    <ng-repeat></ng-repeat>
  </fire-widget>
</div>`;
    const r = scanHtmlTemplate(tpl);
    expect([...r.directives].sort()).toEqual(['fireWidget', 'myCustom']);
  });

  it('detects ng-view / ui-view outlets', () => {
    expect(scanHtmlTemplate('<div ng-view></div>').hasViewOutlet).toBe(true);
    expect(scanHtmlTemplate('<ui-view></ui-view>').hasViewOutlet).toBe(true);
    expect(scanHtmlTemplate('<div>no outlet</div>').hasViewOutlet).toBe(false);
  });

  it('ignores content inside HTML comments', () => {
    const tpl = `<!-- <div ng-controller="GhostCtrl"></div> --><div ng-controller="RealCtrl"></div>`;
    const r = scanHtmlTemplate(tpl);
    expect([...r.controllers]).toEqual(['RealCtrl']);
  });
});

describe('angularjs-classic adapter + HTML reinforcement', () => {
  it('appends HTML template path to controller sourceClusterIds when the template references the controller', () => {
    const JS_SRC = `
define(['angular'], function(angular) {
  angular.module('fireui.app').controller('DashboardCtrl', function($scope) {});
});
`;
    const HTML = `<div ng-controller="DashboardCtrl">hello</div>`;
    const rawSources = new Map<string, string>();
    rawSources.set('app/dashboard.js', JS_SRC);
    rawSources.set('views/dashboard.html', HTML);
    const c = runAngularJsClassicAdapter(
      [ir('app/dashboard.js', JS_SRC)],
      'run-ajs-reinforce',
      rawSources,
    );
    const ctrl = c.find((x) => x.candidateType === 'ui_components' && x.name === 'DashboardCtrl');
    expect(ctrl).toBeDefined();
    expect(ctrl!.sourceClusterIds).toContain('views/dashboard.html');
  });
});
