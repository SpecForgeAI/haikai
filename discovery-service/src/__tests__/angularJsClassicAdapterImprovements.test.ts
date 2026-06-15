/**
 * Tests for the angularJs-classic adapter improvements landed on
 * 2026-04-29 in response to Kiro/Opus 4.6's analysis:
 *
 *   #1 — emitServiceMethods walks service / factory / controller function
 *        bodies and emits one business_logics candidate per public
 *        method, attributed to its parent service or controller.
 *   #2(b) — wrapper-service endpoint detection: any
 *        `<caller>.<verb>(<URL_LITERAL>, …)` shape where verb is a real
 *        HTTP method and the URL literal looks like a URL.
 *   #3 — interfaces metadata field-name fix: emit `className` /
 *        `serviceInterfaceKind` (rubric-required) alongside the legacy
 *        `interfaceClassName` / `interfaceKind`.
 */
import { javascriptLangPack } from '../services/extensionPacks/languagePacks/javascriptLangPack';
import { angularJsClassicFrameworkPack } from '../services/extensionPacks/frameworkPacks/angularJsClassicFrameworkPack';
import type { TechHints } from '../services/extensionPacks';
import type { DiscoveryCandidate } from '../types/candidate';

const HINTS: TechHints = {
  '0': { language: 'JavaScript' },
  '1': { technology: 'AngularJS' },
};

function run(files: Map<string, string>, runId: string): DiscoveryCandidate[] {
  const ir = javascriptLangPack.extract(files, HINTS);
  return angularJsClassicFrameworkPack.adapt(ir, runId, HINTS);
}

// =============================================================================
// #3 — interfaces metadata field-name fix
// =============================================================================

describe('angularjs-classic #3 — interfaces metadata field naming', () => {
  it('emits className + serviceInterfaceKind on angular.module() interfaces (rubric-required)', () => {
    const src = `angular.module('app', ['ngRoute']);`;
    const cs = run(new Map([['app.js', src]]), 'r');
    const m = cs.find((c) => c.candidateType === 'interfaces' && c.name === 'app');
    expect(m).toBeDefined();
    expect(m!.data.className).toBe('app');
    expect(m!.data.serviceInterfaceKind).toBe('angularjs-module');
    // Legacy fields preserved for back-compat.
    expect(m!.data.interfaceClassName).toBe('app');
    expect(m!.data.interfaceKind).toBe('angularjs-module');
  });
});

// =============================================================================
// #1 — service / factory / controller body method extraction
// =============================================================================

describe('angularjs-classic #1 — service / factory / controller method extraction', () => {
  it('emits one business_logics per `this.<method> = function` in a .service() body', () => {
    const src = `
angular.module('app').service('TradeService', function ($http) {
  this.getTrades = function() { return $http.get('/api/trades'); };
  this.saveTrade = function(t) { return $http.post('/api/trades', t); };
});`;
    const cs = run(new Map([['tradeService.js', src]]), 'r');
    const methods = cs
      .filter((c) => c.candidateType === 'business_logics' && c.data.className === 'TradeService')
      .map((c) => c.name)
      .sort();
    expect(methods).toEqual(expect.arrayContaining(['getTrades', 'saveTrade']));
    const sample = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'getTrades');
    expect(sample!.data.extractionPattern).toBe('this');
    expect(sample!.data.registrationMethod).toBe('service-method');
  });

  it('emits one business_logics per return-object method in a .factory() body', () => {
    const src = `
angular.module('app').factory('TradeApi', function ($http) {
  return {
    getTrades: function () { return $http.get('/api/trades'); },
    saveTrade: function (t) { return $http.post('/api/trades', t); }
  };
});`;
    const cs = run(new Map([['tradeApi.js', src]]), 'r');
    const methods = cs
      .filter((c) => c.candidateType === 'business_logics' && c.data.className === 'TradeApi')
      .map((c) => c.name)
      .sort();
    expect(methods).toEqual(expect.arrayContaining(['getTrades', 'saveTrade']));
  });

  it('emits one business_logics per `$scope.<method> = function` in a controller body', () => {
    const src = `
angular.module('app').controller('TradeCtrl', function ($scope) {
  $scope.refresh = function() {};
  $scope.save = function() {};
});`;
    const cs = run(new Map([['tradeCtrl.js', src]]), 'r');
    const methods = cs
      .filter((c) => c.candidateType === 'business_logics' && c.data.className === 'TradeCtrl')
      .map((c) => c.name)
      .sort();
    expect(methods).toEqual(['refresh', 'save']);
    expect(cs.find((c) => c.name === 'refresh')!.data.extractionPattern).toBe('scope');
  });

  it('emits one business_logics per `vm.<method> = function` (controllerAs alias)', () => {
    const src = `
angular.module('app').controller('TradeCtrl', function () {
  var vm = this;
  vm.load = function () {};
  vm.save = function () {};
});`;
    const cs = run(new Map([['tradeCtrlAs.js', src]]), 'r');
    const methods = cs
      .filter((c) => c.candidateType === 'business_logics' && c.data.className === 'TradeCtrl')
      .map((c) => c.name)
      .sort();
    expect(methods).toEqual(expect.arrayContaining(['load', 'save']));
  });

  it('emits one business_logics per `<Class>.prototype.<method> = function`, attributed to the class name when registered', () => {
    const src = `
angular.module('app').service('TradeService', TradeService);

function TradeService() {}
TradeService.prototype.getById = function (id) {};
TradeService.prototype.list = function () {};`;
    const cs = run(new Map([['tradePrototype.js', src]]), 'r');
    const methods = cs
      .filter((c) => c.candidateType === 'business_logics' && c.data.className === 'TradeService')
      .map((c) => c.name)
      .sort();
    expect(methods).toEqual(expect.arrayContaining(['getById', 'list']));
    expect(cs.find((c) => c.name === 'getById')!.data.extractionPattern).toBe('prototype');
  });

  it('dedupes (className, methodName) — overload / shadowed definitions only emit once', () => {
    const src = `
angular.module('app').service('TradeService', function () {
  this.refresh = function() {};
  this.refresh = function() {}; // shadowed re-assignment
});`;
    const cs = run(new Map([['shadowed.js', src]]), 'r');
    const refreshCount = cs.filter(
      (c) => c.candidateType === 'business_logics' &&
             c.data.className === 'TradeService' &&
             c.name === 'refresh',
    ).length;
    expect(refreshCount).toBe(1);
  });

  it('does NOT emit business_logics for `name: function` in a non-factory file (return-object gate)', () => {
    // A controller body might construct an object literal that happens to
    // use `name: function`. Without the gate to factory-only, we'd emit
    // those as business_logics — noise.
    const src = `
angular.module('app').controller('TradeCtrl', function ($scope) {
  $scope.handlers = {
    onSave: function () {},
    onCancel: function () {}
  };
});`;
    const cs = run(new Map([['ctrlHandlers.js', src]]), 'r');
    // `onSave`/`onCancel` would only be emitted if the gate accidentally
    // fires for non-factory contexts. They should NOT appear.
    const saved = cs.find(
      (c) => c.candidateType === 'business_logics' && c.name === 'onSave',
    );
    expect(saved).toBeUndefined();
  });

  it('attributes methods to the nearest preceding registration (multi-service file)', () => {
    const src = `
angular.module('app').service('FirstService', function () {
  this.aaa = function () {};
});

angular.module('app').service('SecondService', function () {
  this.bbb = function () {};
});`;
    const cs = run(new Map([['multi.js', src]]), 'r');
    const aaaOwner = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'aaa');
    const bbbOwner = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'bbb');
    expect(aaaOwner!.data.className).toBe('FirstService');
    expect(bbbOwner!.data.className).toBe('SecondService');
  });

  it('skips object meta-method names like constructor / toString', () => {
    const src = `
angular.module('app').service('TradeService', function () {
  this.constructor = function () {};
  this.toString = function () { return ''; };
  this.realMethod = function () {};
});`;
    const cs = run(new Map([['meta.js', src]]), 'r');
    const names = cs
      .filter((c) => c.candidateType === 'business_logics' && c.data.className === 'TradeService')
      .map((c) => c.name);
    expect(names).toContain('realMethod');
    expect(names).not.toContain('constructor');
    expect(names).not.toContain('toString');
  });
});

// =============================================================================
// #2(b) — wrapper-service endpoint detection
// =============================================================================

describe('angularjs-classic #2(b) — wrapper-service endpoint detection', () => {
  it('emits an endpoint for `apiService.get("/api/...")`', () => {
    const src = `
angular.module('app').controller('TradeCtrl', function (apiService) {
  apiService.get('/api/trades');
});`;
    const cs = run(new Map([['ctrl.js', src]]), 'r');
    const ep = cs.find(
      (c) =>
        c.candidateType === 'endpoints' &&
        c.data.canonicalUrl === '/api/trades' &&
        c.data.httpMethod === 'GET',
    );
    expect(ep).toBeDefined();
    expect(ep!.data.apiLibrary).toBe('http-wrapper');
    expect(ep!.data.callingService).toBe('apiService');
  });

  it('emits endpoints for all HTTP verbs through a wrapper', () => {
    const src = `
angular.module('app').controller('Ctrl', function (api) {
  api.get('/api/x');
  api.post('/api/x', body);
  api.put('/api/x/1', body);
  api.delete('/api/x/1');
  api.patch('/api/x/1', body);
});`;
    const cs = run(new Map([['verbs.js', src]]), 'r');
    const verbs = cs
      .filter((c) => c.candidateType === 'endpoints' && c.data.apiLibrary === 'http-wrapper')
      .map((c) => c.data.httpMethod)
      .sort();
    expect(verbs).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
  });

  it('does NOT emit for `localStorage.get("user-id")` (URL gate rejects non-URL strings)', () => {
    const src = `
function readUser () {
  return localStorage.get('user-id');
}`;
    const cs = run(new Map([['storage.js', src]]), 'r');
    const eps = cs.filter((c) => c.candidateType === 'endpoints');
    expect(eps.length).toBe(0);
  });

  it('does NOT emit for `_.get(obj, "path.to.value")` (URL gate rejects)', () => {
    const src = `
function pluck () {
  return _.get(thing, 'a.b.c');
}`;
    const cs = run(new Map([['lodash.js', src]]), 'r');
    const eps = cs.filter((c) => c.candidateType === 'endpoints');
    expect(eps.length).toBe(0);
  });

  it('does NOT double-emit when $http and a wrapper both target the same URL', () => {
    const src = `
angular.module('app').service('TradeService', function ($http, api) {
  this.viaHttp = function () { $http.get('/api/trades'); };
  this.viaWrapper = function () { api.get('/api/trades'); };
});`;
    const cs = run(new Map([['dup.js', src]]), 'r');
    const eps = cs.filter(
      (c) =>
        c.candidateType === 'endpoints' &&
        c.data.canonicalUrl === '/api/trades' &&
        c.data.httpMethod === 'GET',
    );
    expect(eps.length).toBe(1);
  });

  it('does NOT emit when the wrapper call has no caller (`get("/x")` standalone)', () => {
    const src = `
function go () {
  get('/api/anything');
}`;
    const cs = run(new Map([['bareget.js', src]]), 'r');
    const eps = cs.filter((c) => c.candidateType === 'endpoints' && c.data.apiLibrary === 'http-wrapper');
    expect(eps.length).toBe(0);
  });
});

// =============================================================================
// #4(a) — model-factory detection (PascalCase non-service factory + ≥2
// constructor-pattern fields → logical_data_entities + logical_data_attributes,
// suppress the business_logics row that emitRegistrations would otherwise emit)
// =============================================================================

describe('angularjs-classic #4a — model-factory detection', () => {
  it('emits logical_data_entities + logical_data_attributes for a PascalCase factory with constructor-pattern body', () => {
    const src = `
angular.module('app').factory('Trade', function () {
  function Trade(data) {
    this.id = data.id;
    this.name = data.name;
    this.status = data.status;
  }
  return Trade;
});`;
    const cs = run(new Map([['trade.js', src]]), 'r');
    const entity = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'Trade');
    expect(entity).toBeDefined();
    expect(entity!.data.source).toBe('model-factory');
    const attrs = cs
      .filter((c) => c.candidateType === 'logical_data_attributes' && c.data.logicalEntityName === 'Trade')
      .map((c) => c.name)
      .sort();
    expect(attrs).toEqual(['id', 'name', 'status']);
  });

  it('suppresses the business_logics row that emitRegistrations would otherwise emit for a model factory', () => {
    const src = `
angular.module('app').factory('Trade', function () {
  function Trade(data) {
    this.id = data.id;
    this.name = data.name;
  }
  return Trade;
});`;
    const cs = run(new Map([['trade.js', src]]), 'r');
    const tradeBusinessLogic = cs.find(
      (c) => c.candidateType === 'business_logics' && c.name === 'Trade',
    );
    expect(tradeBusinessLogic).toBeUndefined();
  });

  it('does NOT emit a model-factory entity for a service-suffix name (TradeService)', () => {
    const src = `
angular.module('app').factory('TradeService', function () {
  function TradeService() {
    this.cache = {};
    this.lastUpdated = null;
  }
  return TradeService;
});`;
    const cs = run(new Map([['service.js', src]]), 'r');
    const entity = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'TradeService');
    expect(entity).toBeUndefined();
    // The business_logics row from emitRegistrations IS still expected.
    const blogic = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'TradeService');
    expect(blogic).toBeDefined();
  });

  it('does NOT emit a model-factory entity for a factory body with only ONE field (single-signal too weak)', () => {
    const src = `
angular.module('app').factory('Cache', function () {
  function Cache() {
    this.store = {};
  }
  return Cache;
});`;
    const cs = run(new Map([['cache.js', src]]), 'r');
    const entity = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'Cache');
    expect(entity).toBeUndefined();
    // Falls back to the regular business_logics path.
    const blogic = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'Cache');
    expect(blogic).toBeDefined();
  });

  it('does NOT misclassify a factory whose only this.x= assignments are functions (those are methods)', () => {
    const src = `
angular.module('app').factory('TradeApi', function ($http) {
  function TradeApi() {
    this.getTrades = function () { return $http.get('/api/trades'); };
    this.saveTrade = function (t) { return $http.post('/api/trades', t); };
  }
  return TradeApi;
});`;
    const cs = run(new Map([['api.js', src]]), 'r');
    // Despite PascalCase non-service name, the body has only function
    // assignments — not data fields. Should NOT be a model entity.
    const entity = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'TradeApi');
    expect(entity).toBeUndefined();
    // Methods should still be picked up as business_logics by emitServiceMethods.
    const methods = cs
      .filter((c) => c.candidateType === 'business_logics' && c.data.className === 'TradeApi')
      .map((c) => c.name)
      .sort();
    expect(methods).toEqual(expect.arrayContaining(['getTrades', 'saveTrade']));
  });

  it('coexists with method extraction — a model class with both fields and methods emits both row types', () => {
    const src = `
angular.module('app').factory('Trade', function () {
  function Trade(data) {
    this.id = data.id;
    this.amount = data.amount;
    this.status = data.status;
    this.formatLabel = function () { return this.id + ': ' + this.status; };
  }
  return Trade;
});`;
    const cs = run(new Map([['trade.js', src]]), 'r');
    // Entity + 3 attributes (NOT formatLabel — that's a function).
    const entity = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'Trade');
    expect(entity).toBeDefined();
    const attrs = cs
      .filter((c) => c.candidateType === 'logical_data_attributes' && c.data.logicalEntityName === 'Trade')
      .map((c) => c.name)
      .sort();
    expect(attrs).toEqual(['amount', 'id', 'status']);
    // formatLabel should appear as business_logics, not as an attribute.
    expect(attrs).not.toContain('formatLabel');
    const method = cs.find(
      (c) => c.candidateType === 'business_logics' && c.name === 'formatLabel' && c.data.className === 'Trade',
    );
    expect(method).toBeDefined();
  });

  it('does NOT double-emit when the same name was also added via $resource', () => {
    // emitLogicalEntities skips names already emitted by an earlier pass,
    // so this should still produce exactly one logical_data_entities row.
    const src = `
angular.module('app').factory('User', function ($resource) {
  function User(data) {
    this.id = data.id;
    this.name = data.name;
  }
  // Hypothetical: also expose a $resource-style helper that would push
  // 'User' into logicalEntityNames the legacy way.
  $resource('/users/:id');
  return User;
});`;
    const cs = run(new Map([['user.js', src]]), 'r');
    const entities = cs.filter((c) => c.candidateType === 'logical_data_entities' && c.name === 'User');
    expect(entities.length).toBe(1);
    // The single entity should be the model-factory one (it ran first).
    expect(entities[0].data.source).toBe('model-factory');
  });
});

// =============================================================================
// #2 — registration-level business_logics carries className
// =============================================================================

describe('angularjs-classic #2 — registration-level business_logics metadata', () => {
  it('emits className + beanKind + parameterCount on the .service() registration row', () => {
    const src = `angular.module('app').service('TradeService', function () {});`;
    const cs = run(new Map([['svc.js', src]]), 'r');
    const reg = cs.find(
      (c) =>
        c.candidateType === 'business_logics' &&
        c.name === 'TradeService' &&
        c.data.registrationMethod === 'service',
    );
    expect(reg).toBeDefined();
    expect(reg!.data.className).toBe('TradeService');
    expect(reg!.data.beanKind).toBe('service');
    expect(reg!.data.parameterCount).toBe(0);
  });

  it('emits className on .factory() / .provider() / .filter() registrations too', () => {
    const src = `
angular.module('app').factory('TradeFactory', function () { return {} });
angular.module('app').provider('TradeProvider', function () {});
angular.module('app').filter('tradeFmt', function () { return function (x) { return x; }; });`;
    const cs = run(new Map([['regs.js', src]]), 'r');
    for (const name of ['TradeFactory', 'TradeProvider', 'tradeFmt']) {
      const reg = cs.find((c) => c.candidateType === 'business_logics' && c.name === name);
      expect(reg).toBeDefined();
      expect(reg!.data.className).toBe(name);
    }
  });
});

// =============================================================================
// #1(c) — .constant('NAME', { KEY: '/url', … }) URL bundle detection
// =============================================================================

describe('angularjs-classic #1(c) — .constant() URL bundle detection', () => {
  it('emits one endpoint per URL-valued key in a .constant(name, {...}) registration', () => {
    const src = `
angular.module('app').constant('API', {
  TRADES: '/api/v1/trades',
  POSITIONS: '/api/v1/positions',
  USERS: '/api/v1/users'
});`;
    const cs = run(new Map([['constants.js', src]]), 'r');
    const eps = cs
      .filter((c) => c.candidateType === 'endpoints' && c.data.endpoint_subtype === 'api-constant')
      .map((c) => c.data.canonicalUrl)
      .sort();
    expect(eps).toEqual(['/api/v1/positions', '/api/v1/trades', '/api/v1/users']);
  });

  it('records definedIn + constantKey for traceability', () => {
    const src = `angular.module('app').constant('API', { TRADES: '/api/v1/trades' });`;
    const cs = run(new Map([['c.js', src]]), 'r');
    const ep = cs.find((c) => c.candidateType === 'endpoints' && c.data.canonicalUrl === '/api/v1/trades');
    expect(ep).toBeDefined();
    expect(ep!.data.definedIn).toBe('API');
    expect(ep!.data.constantKey).toBe('TRADES');
    expect(ep!.data.httpMethod).toBe('GET'); // default — verb unknown from constant alone
    expect(ep!.confidence).toBe(0.75);
  });

  it('skips non-URL values like VERSION strings', () => {
    const src = `
angular.module('app').constant('CFG', {
  VERSION: '1.0',
  TRADES: '/api/v1/trades',
  TIMEOUT: '30000'
});`;
    const cs = run(new Map([['cfg.js', src]]), 'r');
    const eps = cs
      .filter((c) => c.candidateType === 'endpoints' && c.data.endpoint_subtype === 'api-constant')
      .map((c) => c.data.constantKey);
    expect(eps).toEqual(['TRADES']);
  });
});

// =============================================================================
// #1(a) — concatenation-prefix URL extraction in wrapper-service detector
// =============================================================================

describe('angularjs-classic #1(a) — concatenation-prefix URL extraction', () => {
  it('extracts the literal URL when both halves of a + concatenation are literals', () => {
    const src = `
angular.module('app').controller('Ctrl', function (api) {
  api.get('/api/v1' + '/trades');
});`;
    const cs = run(new Map([['concat-both.js', src]]), 'r');
    const ep = cs.find(
      (c) => c.candidateType === 'endpoints' && c.data.apiLibrary === 'http-wrapper',
    );
    expect(ep).toBeDefined();
    expect(ep!.data.canonicalUrl).toBe('/api/v1/trades');
    expect(ep!.data.urlIsPartial).toBeUndefined(); // both halves literal — fully resolved
  });

  it('returns the literal-prefix as a partial URL when the right side is a variable', () => {
    const src = `
angular.module('app').controller('Ctrl', function (api) {
  api.get('/api/v1' + tradeId);
});`;
    const cs = run(new Map([['concat-var.js', src]]), 'r');
    const ep = cs.find(
      (c) => c.candidateType === 'endpoints' && c.data.apiLibrary === 'http-wrapper',
    );
    expect(ep).toBeDefined();
    expect(ep!.data.canonicalUrl).toBe('/api/v1');
    expect(ep!.data.urlIsPartial).toBe(true);
    expect(ep!.confidence).toBe(0.75);
  });

  it('finds the first URL-shaped literal when the LEFT side is a variable (BASE + "/trades")', () => {
    const src = `
var BASE = '/api/v1';
angular.module('app').controller('Ctrl', function (api) {
  api.get(BASE + '/trades');
});`;
    const cs = run(new Map([['concat-leftvar.js', src]]), 'r');
    const ep = cs.find(
      (c) => c.candidateType === 'endpoints' && c.data.apiLibrary === 'http-wrapper',
    );
    expect(ep).toBeDefined();
    expect(ep!.data.canonicalUrl).toBe('/trades');
    expect(ep!.data.urlIsPartial).toBe(true);
  });

  it('does NOT emit when no URL literal is anywhere in the expression', () => {
    const src = `
angular.module('app').controller('Ctrl', function (api) {
  api.get(BASE + tradeId);
});`;
    const cs = run(new Map([['novar.js', src]]), 'r');
    const eps = cs.filter((c) => c.candidateType === 'endpoints');
    expect(eps.length).toBe(0);
  });
});

// =============================================================================
// #1(b) — wrapper-service config-object trigger broadening
// =============================================================================

describe('angularjs-classic #1(b) — wrapper-service config-object scan', () => {
  it('emits an endpoint for `Service.request({url, method})` in a non-$http file', () => {
    const src = `
angular.module('app').controller('Ctrl', function (DataService) {
  DataService.request({ url: '/api/trades', method: 'GET' });
});`;
    const cs = run(new Map([['cfg.js', src]]), 'r');
    const ep = cs.find(
      (c) =>
        c.candidateType === 'endpoints' &&
        c.data.apiLibrary === 'http-wrapper' &&
        c.data.canonicalUrl === '/api/trades',
    );
    expect(ep).toBeDefined();
    expect(ep!.data.httpMethod).toBe('GET');
  });

  it('handles `service.execute({path, type})` (alternate field names — type counts as HTTP-shape)', () => {
    const src = `
angular.module('app').controller('Ctrl', function (httpService) {
  httpService.execute({ url: '/api/save', type: 'POST', data: payload });
});`;
    const cs = run(new Map([['exec.js', src]]), 'r');
    const ep = cs.find(
      (c) =>
        c.candidateType === 'endpoints' &&
        c.data.apiLibrary === 'http-wrapper' &&
        c.data.canonicalUrl === '/api/save',
    );
    expect(ep).toBeDefined();
  });

  it('does NOT misclassify a $stateProvider route config (no method/data/body — fails strict gate)', () => {
    const src = `
angular.module('app').config(function ($stateProvider) {
  $stateProvider.state('profile', {
    url: '/profile',
    controller: 'ProfileCtrl',
    templateUrl: '/views/profile.html'
  });
});`;
    const cs = run(new Map([['routes.js', src]]), 'r');
    // The strict gate should reject this — no method/data/body/headers
    // signal in the config object. (`templateUrl` is intentionally NOT
    // an HTTP-shape signal — it's a route concept.)
    const fakeEps = cs.filter(
      (c) => c.candidateType === 'endpoints' && c.data.canonicalUrl === '/profile',
    );
    expect(fakeEps.length).toBe(0);
  });

  it('still fires the legacy non-strict path when $http is in the file', () => {
    // Sanity: the existing $http-aliased trigger must keep firing
    // unchanged. A method-less config is still emitted as GET because
    // the legacy path uses non-strict mode (back-compat).
    const src = `
angular.module('app').service('TradeSvc', function ($http) {
  this.find = function () {
    var req = { url: '/api/trades' };
    return this.$http(req);
  };
});`;
    const cs = run(new Map([['legacy.js', src]]), 'r');
    const ep = cs.find(
      (c) =>
        c.candidateType === 'endpoints' &&
        c.data.canonicalUrl === '/api/trades' &&
        c.data.apiLibrary === '$http',
    );
    expect(ep).toBeDefined();
  });
});
