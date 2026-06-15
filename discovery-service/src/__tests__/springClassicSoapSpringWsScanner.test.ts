/**
 * Tests for `springWsScanner.ts` (Spec 2026-05-17 SOAP Discovery -- Spring
 * Classic Phase 1, Task Group 2).
 *
 * Test coverage (per tasks.md 2.1):
 *  1. inline Java source with `@Endpoint` class + two `@PayloadRoot(namespace=...,
 *     localPart=...)` methods returns two raw signal entries
 *  2. `@PayloadRoot` namespace + localPart values flow through to the result
 *     struct verbatim
 *  3. class with no SOAP-relevant annotations returns an empty list
 *     (back-compat: REST controllers must not be misclassified)
 *  4. emitter raw inputs exposed (per D-1) -- class simple name, package,
 *     `@WebService(name=...)` if also present, and any namespace seen -- so
 *     the emitter can apply layered naming centrally
 *  5. `@PayloadRoots({...})` multi-mapping variant produces one signal per
 *     inner `@PayloadRoot`
 */

import { scanSpringWsSources } from '../services/findings/packFindingScanners/springClassicSoap/springWsScanner';

describe('springWsScanner -- @Endpoint + @PayloadRoot', () => {
  it('returns two operation entries when an @Endpoint class has two @PayloadRoot methods', () => {
    const source = `
package com.example.svc;

import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;
import com.example.dto.GetCountryRequest;
import com.example.dto.GetCountryResponse;
import com.example.dto.ListCountriesRequest;
import com.example.dto.ListCountriesResponse;

@Endpoint
public class CountryEndpoint {
  private static final String NS = "https://spring.io/guides/gs-producing-web-service";

  @PayloadRoot(namespace = NS, localPart = "getCountryRequest")
  public GetCountryResponse getCountry(GetCountryRequest req) {
    return null;
  }

  @PayloadRoot(namespace = "https://spring.io/guides/gs-producing-web-service", localPart = "listCountriesRequest")
  public ListCountriesResponse listCountries(ListCountriesRequest req) {
    return null;
  }
}
`;
    const signals = scanSpringWsSources([
      { path: 'src/main/java/com/example/svc/CountryEndpoint.java', content: source },
    ]);

    expect(signals).toHaveLength(1);
    expect(signals[0].simpleClassName).toBe('CountryEndpoint');
    expect(signals[0].operations).toHaveLength(2);
    expect(signals[0].operations.map((o) => o.localPart).sort()).toEqual(
      ['getCountryRequest', 'listCountriesRequest'].sort(),
    );
  });

  it('flows @PayloadRoot namespace + localPart values through verbatim', () => {
    const source = `
package com.example;
import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;

@Endpoint
public class GreetingEndpoint {
  @PayloadRoot(namespace = "http://uniba.de/dsg/soa/", localPart = "greet")
  public Object handle(Object in) { return null; }
}
`;
    const signals = scanSpringWsSources([
      { path: 'a.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].operations).toHaveLength(1);
    expect(signals[0].operations[0].namespace).toBe('http://uniba.de/dsg/soa/');
    expect(signals[0].operations[0].localPart).toBe('greet');
  });

  it('returns an empty list for a plain REST controller (no SOAP signals)', () => {
    const source = `
package com.example;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
@RequestMapping("/api/v1/widgets")
public class WidgetController {
  @GetMapping("/{id}")
  public Object get(String id) { return null; }
}
`;
    const signals = scanSpringWsSources([
      { path: 'src/main/java/com/example/WidgetController.java', content: source },
    ]);
    expect(signals).toEqual([]);
  });

  it('exposes raw inputs for the emitter (class name, package, @WebService(name=...), namespace)', () => {
    const source = `
package com.foo;

import jakarta.jws.WebService;
import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;

@WebService(name = "GreetingsService", targetNamespace = "http://uniba.de/dsg/soa/")
@Endpoint
public class BarService {

  @PayloadRoot(namespace = "http://uniba.de/dsg/soa/", localPart = "greet")
  public Object greet(Object req) { return null; }
}
`;
    const signals = scanSpringWsSources([
      { path: 'src/main/java/com/foo/BarService.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    const sig = signals[0];
    expect(sig.simpleClassName).toBe('BarService');
    expect(sig.packageName).toBe('com.foo');
    expect(sig.webServiceNameAttribute).toBe('GreetingsService');
    expect(sig.operations[0].namespace).toBe('http://uniba.de/dsg/soa/');
    expect(sig.operations[0].localPart).toBe('greet');
  });

  it('handles @PayloadRoots({...}) multi-mapping (one signal per inner @PayloadRoot)', () => {
    const source = `
package com.example;
import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;
import org.springframework.ws.server.endpoint.annotation.PayloadRoots;

@Endpoint
public class MultiRootEndpoint {
  @PayloadRoots({
    @PayloadRoot(namespace = "http://a", localPart = "rootA"),
    @PayloadRoot(namespace = "http://b", localPart = "rootB")
  })
  public Object handle(Object in) { return null; }
}
`;
    const signals = scanSpringWsSources([
      { path: 'a.java', content: source },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].operations).toHaveLength(2);
    const sorted = [...signals[0].operations].sort((a, b) => a.localPart.localeCompare(b.localPart));
    expect(sorted[0].namespace).toBe('http://a');
    expect(sorted[0].localPart).toBe('rootA');
    expect(sorted[1].namespace).toBe('http://b');
    expect(sorted[1].localPart).toBe('rootB');
  });
});
