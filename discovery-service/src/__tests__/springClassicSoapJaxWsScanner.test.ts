/**
 * Tests for `jaxWsScanner.ts` (Spec 2026-05-17 SOAP Discovery -- Spring
 * Classic Phase 1, Task Group 3).
 *
 * Test coverage (per tasks.md 3.1):
 *  1. inline Java source with `@WebService` class + two `@WebMethod` methods
 *     returns two raw signal entries
 *  2. `@WebService(name="X")` attribute is captured for the D-1 layered
 *     naming rule
 *  3. `@RequestWrapper(localName=...)` and `@ResponseWrapper(localName=...)`
 *     flow through to `requestRootElement` / `responseRootElement`
 *  4. `@WebMethod(operationName="...")` overrides the Java method name when
 *     present
 *  5. class with only `@WebService` and no `@WebMethod` returns an empty
 *     operations list (D-2 hint: bare class with no methods produces no
 *     candidates)
 *
 *  Bonus: files under `target/generated-sources/cxf/` are skipped per Q-10.
 *
 * Spec #4 (Inbound Surface Completeness), Task Group 5 additions:
 *  - interface-declared SEIs are detected (the JAX-WS contract form), not only
 *    `class` declarations.
 */

import { scanJaxWsSources } from '../services/findings/packFindingScanners/springClassicSoap/jaxWsScanner';

describe('jaxWsScanner -- @WebService + @WebMethod', () => {
  it('returns two operation entries when a @WebService class has two @WebMethod methods', () => {
    const source = `
package com.example;

import jakarta.jws.WebService;
import jakarta.jws.WebMethod;

@WebService
public class GreetingsImpl {
  @WebMethod
  public String greet(String name) { return null; }

  @WebMethod
  public String farewell(String name) { return null; }
}
`;
    const signals = scanJaxWsSources([
      { path: 'src/main/java/com/example/GreetingsImpl.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].operations).toHaveLength(2);
    expect(signals[0].operations.map((o) => o.methodName).sort()).toEqual(
      ['farewell', 'greet'].sort(),
    );
  });

  it('captures @WebService(name="X") attribute for the D-1 layered naming rule', () => {
    const source = `
package com.foo;

import jakarta.jws.WebService;
import jakarta.jws.WebMethod;

@WebService(name = "GreetingsService", targetNamespace = "http://uniba.de/dsg/soa/")
public class BarService {
  @WebMethod
  public String greet(String name) { return null; }
}
`;
    const signals = scanJaxWsSources([
      { path: 'src/main/java/com/foo/BarService.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].simpleClassName).toBe('BarService');
    expect(signals[0].packageName).toBe('com.foo');
    expect(signals[0].webServiceNameAttribute).toBe('GreetingsService');
    expect(signals[0].targetNamespace).toBe('http://uniba.de/dsg/soa/');
  });

  it('flows @RequestWrapper(localName=...) and @ResponseWrapper(localName=...) through to request/response root elements', () => {
    const source = `
package com.example;

import jakarta.jws.WebService;
import jakarta.jws.WebMethod;
import jakarta.xml.ws.RequestWrapper;
import jakarta.xml.ws.ResponseWrapper;

@WebService
public class GreetingsImpl {
  @WebMethod
  @RequestWrapper(localName = "greet", targetNamespace = "http://uniba.de/dsg/soa/", className = "com.example.Greet")
  @ResponseWrapper(localName = "greetResponse", targetNamespace = "http://uniba.de/dsg/soa/", className = "com.example.GreetResponse")
  public String greet(String name) { return null; }
}
`;
    const signals = scanJaxWsSources([
      { path: 'a.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].operations).toHaveLength(1);
    const op = signals[0].operations[0];
    expect(op.requestRootElement).toBe('greet');
    expect(op.responseRootElement).toBe('greetResponse');
  });

  it('honours @WebMethod(operationName="...") override over the Java method name', () => {
    const source = `
package com.example;

import jakarta.jws.WebService;
import jakarta.jws.WebMethod;

@WebService
public class GreetingsImpl {
  @WebMethod(operationName = "greetCustomer")
  public String doGreet(String name) { return null; }
}
`;
    const signals = scanJaxWsSources([
      { path: 'a.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    const op = signals[0].operations[0];
    expect(op.methodName).toBe('doGreet');
    expect(op.operationName).toBe('greetCustomer');
  });

  it('returns an empty operations list for a bare @WebService class with no @WebMethod methods', () => {
    const source = `
package com.example;

import jakarta.jws.WebService;

@WebService
public class BareEndpoint {
  public String helperMethod() { return null; }
}
`;
    const signals = scanJaxWsSources([
      { path: 'a.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].operations).toEqual([]);
  });

  it('skips files under target/generated-sources/cxf/ per Q-10', () => {
    const source = `
package com.example.generated;

import jakarta.jws.WebService;
import jakarta.jws.WebMethod;

@WebService
public class GeneratedStub {
  @WebMethod
  public Object op() { return null; }
}
`;
    const signals = scanJaxWsSources([
      {
        path: 'target/generated-sources/cxf/com/example/generated/GeneratedStub.java',
        content: source,
      },
    ]);
    expect(signals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Spec #4, Task Group 5 -- interface-declared SEIs.
//
// A JAX-WS Service Endpoint Interface is idiomatically declared as a Java
// `interface` (the @WebService contract), separate from the concrete bean
// (`class FooServiceImpl implements FooService`). Before TG5 the declaration
// regex matched `class` only, so an interface-form SEI's @WebMethod operations
// were missed entirely. These tests pin: (1) the interface form is detected;
// (2) the class form still works (no regression); (3) @WebMethod /
// @RequestWrapper / @ResponseWrapper / @WebMethod(operationName=...) extraction
// behaves on the interface body (abstract methods ending in `;`, incl. a
// zero-arg method).
// ---------------------------------------------------------------------------
describe('jaxWsScanner -- interface-declared SEIs (Spec #4 TG5)', () => {
  it('detects a @WebService interface-declared SEI and its @WebMethod operations', () => {
    const source = `
package com.example;

import jakarta.jws.WebService;
import jakarta.jws.WebMethod;

@WebService(name = "CountryService", targetNamespace = "http://example.com/ws")
public interface CountryService {
  @WebMethod
  Country getCountry(String name);

  @WebMethod
  List<Country> listCountries();
}
`;
    const signals = scanJaxWsSources([
      { path: 'src/main/java/com/example/CountryService.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].simpleClassName).toBe('CountryService');
    expect(signals[0].webServiceNameAttribute).toBe('CountryService');
    expect(signals[0].targetNamespace).toBe('http://example.com/ws');
    expect(signals[0].operations.map((o) => o.methodName).sort()).toEqual(
      ['getCountry', 'listCountries'].sort(),
    );
  });

  it('still detects a @WebService class-declared SEI (no regression)', () => {
    const source = `
package com.example;

import jakarta.jws.WebService;
import jakarta.jws.WebMethod;

@WebService
public class GreetingsImpl {
  @WebMethod
  public String greet(String name) { return null; }
}
`;
    const signals = scanJaxWsSources([
      { path: 'src/main/java/com/example/GreetingsImpl.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].simpleClassName).toBe('GreetingsImpl');
    expect(signals[0].operations).toHaveLength(1);
    expect(signals[0].operations[0].methodName).toBe('greet');
  });

  it('extracts @RequestWrapper / @ResponseWrapper / operationName on the interface form', () => {
    const source = `
package com.example;

import jakarta.jws.WebService;
import jakarta.jws.WebMethod;
import jakarta.xml.ws.RequestWrapper;
import jakarta.xml.ws.ResponseWrapper;

@WebService
public interface GreetingsPortType {
  @WebMethod(operationName = "greetCustomer")
  @RequestWrapper(localName = "greet")
  @ResponseWrapper(localName = "greetResponse")
  String doGreet(String name);
}
`;
    const signals = scanJaxWsSources([
      { path: 'src/main/java/com/example/GreetingsPortType.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].operations).toHaveLength(1);
    const op = signals[0].operations[0];
    expect(op.methodName).toBe('doGreet');
    expect(op.operationName).toBe('greetCustomer');
    expect(op.requestRootElement).toBe('greet');
    expect(op.responseRootElement).toBe('greetResponse');
  });

  it('detects an interface SEI and its class impl independently in one scan', () => {
    const sei = `
package com.example;
import jakarta.jws.WebService;
import jakarta.jws.WebMethod;
@WebService(name = "OrderService")
public interface OrderService {
  @WebMethod
  Order placeOrder(OrderRequest req);
}
`;
    const impl = `
package com.example;
import jakarta.jws.WebService;
import jakarta.jws.WebMethod;
@WebService(endpointInterface = "com.example.OrderService", serviceName = "OrderService")
public class OrderServiceImpl implements OrderService {
  @WebMethod
  public Order placeOrder(OrderRequest req) { return null; }
}
`;
    const signals = scanJaxWsSources([
      { path: 'src/main/java/com/example/OrderService.java', content: sei },
      { path: 'src/main/java/com/example/OrderServiceImpl.java', content: impl },
    ]);
    const byName = new Map(signals.map((s) => [s.simpleClassName, s]));
    expect(byName.has('OrderService')).toBe(true);
    expect(byName.has('OrderServiceImpl')).toBe(true);
    expect(byName.get('OrderService')!.operations.map((o) => o.methodName)).toEqual([
      'placeOrder',
    ]);
    expect(byName.get('OrderServiceImpl')!.operations.map((o) => o.methodName)).toEqual([
      'placeOrder',
    ]);
  });
});
