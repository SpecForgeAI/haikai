/**
 * Tests for the NEW Java-DTO field parser (`javaDtoFieldParser.ts`).
 *
 * Spec: 2026-05-30 SOAP/WSDL Message-Field Depth (Spec 4), Task Group 3 (3.1).
 *
 * Offline, pure-parse, NO LLM (like Spec 3). Covers ONLY the critical Group 3
 * behaviours:
 *  1. Field name + type extraction from an annotated `@XmlType` DTO class.
 *  2. Extraction also works for a `@RequestWrapper`/`@ResponseWrapper`-named
 *     JAXB wrapper bean (the member `@XmlElement` marker path).
 *  3. Collection-ness inferred (`List<T>` / `T[]` -> is_collection).
 *  4. Nullability inferred: boxed (`Integer`) nullable, primitive (`int`) not;
 *     `@XmlElement(nillable=true)` / `required=false` honoured.
 *  5. A class with NO parsable fields degrades gracefully (no throw, fields []).
 *  6. Output shape matches the SHARED `MessageField` model (so Group 4 can
 *     reconcile WSDL-view vs Java-view field-for-field).
 */

import {
  parseJavaDtoFields,
  extractWrapperClassNames,
} from '../services/findings/packFindingScanners/springClassicSoap/javaDtoFieldParser';
import type {
  MessageType,
  MessageField,
} from '../services/findings/packFindingScanners/springClassicSoap/messageFieldModel';

function typeByName(types: MessageType[], name: string): MessageType | undefined {
  return types.find((t) => t.name === name);
}
function fieldByName(t: MessageType | undefined, name: string): MessageField | undefined {
  return t?.fields.find((f) => f.name === name);
}

// ----------------------------------------------------------------------------
// 1) + 3) + 4) @XmlType value class: name/type, collection, nullability
// ----------------------------------------------------------------------------

describe('javaDtoFieldParser -- @XmlType value class', () => {
  const src = {
    path: 'src/main/java/com/example/dto/Customer.java',
    content: `package com.example.dto;

import javax.xml.bind.annotation.XmlType;
import javax.xml.bind.annotation.XmlElement;
import java.util.List;
import java.math.BigDecimal;

@XmlType(name = "Customer")
public class Customer {
    private String firstName;
    private int age;
    private Integer loyaltyPoints;
    private List<Address> addresses;
    private String[] aliases;
    @XmlElement(nillable = true)
    private BigDecimal balance;
    @XmlElement(required = false)
    private String nickname;

    // Should be ignored -- a constant, and methods.
    private static final long serialVersionUID = 1L;
    public String getFirstName() { return firstName; }
    public void setAge(int age) { this.age = age; }
}`,
  };

  it('extracts field name + Java type captured AS-IS', () => {
    const types = parseJavaDtoFields([src]);
    const customer = typeByName(types, 'Customer');
    expect(customer).toBeDefined();
    expect(customer?.source).toBe('java');
    expect(customer?.provenanceClass).toBe('com.example.dto.Customer');

    const firstName = fieldByName(customer, 'firstName');
    expect(firstName?.type).toBe('String'); // AS-IS, not normalized
    expect(firstName?.source).toBe('java');

    // static final constants + methods are NOT fields.
    const names = customer?.fields.map((f) => f.name).sort();
    expect(names).toEqual([
      'addresses',
      'age',
      'aliases',
      'balance',
      'firstName',
      'loyaltyPoints',
      'nickname',
    ]);
    expect(names).not.toContain('serialVersionUID');
  });

  it('infers collection-ness from List<T> and T[]', () => {
    const types = parseJavaDtoFields([src]);
    const customer = typeByName(types, 'Customer');

    const addresses = fieldByName(customer, 'addresses');
    expect(addresses?.cardinality.is_collection).toBe(true);
    expect(addresses?.cardinality.max_occurs).toBe('unbounded');
    // The element type of the collection is a nested DTO reference.
    expect(addresses?.complexTypeRef).toBe('Address');

    const aliases = fieldByName(customer, 'aliases');
    expect(aliases?.cardinality.is_collection).toBe(true);
    // String[] -> builtin element type -> NOT a nested DTO reference.
    expect(aliases?.complexTypeRef).toBeNull();
  });

  it('infers nullability: boxed nullable, primitive not; @XmlElement honoured', () => {
    const types = parseJavaDtoFields([src]);
    const customer = typeByName(types, 'Customer');

    // primitive int -> NOT nullable.
    expect(fieldByName(customer, 'age')?.isNullable).toBe(false);
    // boxed Integer -> nullable.
    expect(fieldByName(customer, 'loyaltyPoints')?.isNullable).toBe(true);
    // boxed String -> nullable.
    expect(fieldByName(customer, 'firstName')?.isNullable).toBe(true);
    // @XmlElement(nillable=true) -> nullable.
    expect(fieldByName(customer, 'balance')?.isNullable).toBe(true);
    // @XmlElement(required=false) -> optional (min_occurs 0).
    expect(fieldByName(customer, 'nickname')?.cardinality.min_occurs).toBe(0);
  });

});

// ----------------------------------------------------------------------------
// 2) @RequestWrapper / @ResponseWrapper-named wrapper bean (member marker path)
// ----------------------------------------------------------------------------

describe('javaDtoFieldParser -- JAXB wrapper bean via member @XmlElement', () => {
  it('parses a wrapper bean whose only marker is member-level @XmlElement', () => {
    const src = {
      path: 'src/main/java/com/example/ws/GetCountryRequest.java',
      content: `package com.example.ws;

import javax.xml.bind.annotation.XmlAccessorType;
import javax.xml.bind.annotation.XmlAccessType;
import javax.xml.bind.annotation.XmlElement;

@XmlAccessorType(XmlAccessType.FIELD)
public class GetCountryRequest {
    @XmlElement(required = true)
    private String name;
}`,
    };
    const types = parseJavaDtoFields([src]);
    const req = typeByName(types, 'GetCountryRequest');
    expect(req).toBeDefined();
    const name = fieldByName(req, 'name');
    expect(name?.type).toBe('String');
    expect(name?.cardinality.min_occurs).toBe(1); // required=true
  });

  it('extractWrapperClassNames pulls the className= FQNs from @RequestWrapper/@ResponseWrapper', () => {
    const content = `
      @WebMethod
      @RequestWrapper(localName = "greet", className = "com.example.ws.Greet")
      @ResponseWrapper(localName = "greetResponse", className = "com.example.ws.GreetResponse")
      public GreetResponse greet(Greet body) { return null; }
    `;
    expect(extractWrapperClassNames(content)).toEqual([
      'com.example.ws.Greet',
      'com.example.ws.GreetResponse',
    ]);
  });
});

// ----------------------------------------------------------------------------
// 5) Graceful degradation
// ----------------------------------------------------------------------------

describe('javaDtoFieldParser -- graceful degradation', () => {
  it('a marked class with no parsable fields yields fields:[] and does NOT throw', () => {
    const src = {
      path: 'src/main/java/com/example/dto/Empty.java',
      content: `package com.example.dto;
import javax.xml.bind.annotation.XmlType;

@XmlType(name = "Empty")
public class Empty {
}`,
    };
    let types: MessageType[] = [];
    expect(() => {
      types = parseJavaDtoFields([src]);
    }).not.toThrow();
    const empty = typeByName(types, 'Empty');
    expect(empty).toBeDefined();
    expect(empty?.fields).toEqual([]);

    // Unmarked classes are skipped; empty input + empty string never throw.
    const plain = {
      path: 'src/main/java/com/example/Plain.java',
      content: 'package com.example;\npublic class Plain { private String x; }',
    };
    expect(parseJavaDtoFields([plain])).toEqual([]);
    expect(parseJavaDtoFields([])).toEqual([]);
    expect(extractWrapperClassNames('')).toEqual([]);
  });


});

// ----------------------------------------------------------------------------
// 6) Shape parity with the shared MessageField model (Group 4 reconciliation)
// ----------------------------------------------------------------------------

describe('javaDtoFieldParser -- shared field-shape parity', () => {
  it('emits the exact MessageField shape the WSDL walker produces', () => {
    const src = {
      path: 'src/main/java/com/example/dto/Order.java',
      content: `package com.example.dto;
import javax.xml.bind.annotation.XmlType;
import java.util.List;

@XmlType(name = "Order")
public class Order {
    private String id;
    private List<LineItem> lineItems;
}`,
    };
    const types = parseJavaDtoFields([src]);
    const order = typeByName(types, 'Order');
    const id = fieldByName(order, 'id');
    // Field carries every shared-model key with the Group-1 JSONB cardinality
    // sub-keys -- byte-for-byte the same shape the XSD walker emits.
    expect(id).toEqual({
      name: 'id',
      type: 'String',
      isNullable: true,
      cardinality: { min_occurs: 1, max_occurs: 1, is_collection: false },
      complexTypeRef: null,
      source: 'java',
    });
    const lineItems = fieldByName(order, 'lineItems');
    expect(lineItems?.cardinality).toEqual({
      min_occurs: 1,
      max_occurs: 'unbounded',
      is_collection: true,
    });
    expect(lineItems?.complexTypeRef).toBe('LineItem');
  });
});
