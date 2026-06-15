/**
 * Unit tests for the Spring bean XML parser.
 *
 * Spec 2026-04-25: classic-Spring + heavy XML wiring. The OpenMRS Core
 * `applicationContext-service.xml` (49 `<bean>` declarations on master)
 * was the driving regression — every bean was invisible to discovery.
 */

import {
  parseSpringBeansXml,
  isSpringBeansXml,
} from '../services/extensionPacks/languageExtractors/java/springBeansXmlParser';

describe('isSpringBeansXml', () => {
  test('returns true for a vanilla Spring beans root', () => {
    expect(
      isSpringBeansXml(`
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans">
  <bean id="x" class="com.foo.X"/>
</beans>
`),
    ).toBe(true);
  });

  test('returns true for prefixed-namespace beans root', () => {
    expect(
      isSpringBeansXml(`<beans:beans xmlns:beans="http://www.springframework.org/schema/beans"/>`),
    ).toBe(true);
  });

  test('returns false for non-Spring XML (HBM mapping)', () => {
    expect(
      isSpringBeansXml(`
<hibernate-mapping>
  <class name="org.example.Patient" table="patient"/>
</hibernate-mapping>
`),
    ).toBe(false);
  });

  test('returns false for arbitrary XML', () => {
    expect(isSpringBeansXml(`<root><child/></root>`)).toBe(false);
  });

  test('tolerates leading XML declaration + comments', () => {
    expect(
      isSpringBeansXml(`<?xml version="1.0"?>
<!-- license header -->
<beans/>`),
    ).toBe(true);
  });
});

describe('parseSpringBeansXml — bean extraction', () => {
  test('extracts <bean id class /> with simple name + dependencies', () => {
    const xml = `
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xmlns:context="http://www.springframework.org/schema/context"
       xmlns:tx="http://www.springframework.org/schema/tx">

  <bean id="dataSource" class="org.apache.commons.dbcp2.BasicDataSource">
    <property name="driverClassName" value="org.h2.Driver"/>
  </bean>

  <bean id="sessionFactory" class="org.springframework.orm.hibernate5.LocalSessionFactoryBean">
    <property name="dataSource" ref="dataSource"/>
    <property name="packagesToScan" value="org.example.model"/>
  </bean>

  <bean id="transactionManager"
        class="org.springframework.orm.hibernate5.HibernateTransactionManager">
    <property name="sessionFactory" ref="sessionFactory"/>
  </bean>

  <!-- Self-closing form -->
  <bean id="patientService" class="org.example.service.PatientServiceImpl"/>
</beans>
`;
    const result = parseSpringBeansXml(xml);

    expect(result.beans.map((b) => b.beanKey).sort()).toEqual([
      'dataSource',
      'patientService',
      'sessionFactory',
      'transactionManager',
    ]);

    const sf = result.beans.find((b) => b.beanKey === 'sessionFactory')!;
    expect(sf.fullyQualifiedClass).toBe(
      'org.springframework.orm.hibernate5.LocalSessionFactoryBean',
    );
    expect(sf.simpleClassName).toBe('LocalSessionFactoryBean');
    expect(sf.dependencyRefs).toEqual(['dataSource']);

    const tm = result.beans.find((b) => b.beanKey === 'transactionManager')!;
    expect(tm.dependencyRefs).toEqual(['sessionFactory']);

    expect(result.usedNamespaces.sort()).toEqual(['context', 'tx']);
  });

  test('handles `name="alias1, alias2"` as the canonical key when no id is set', () => {
    const xml = `
<beans xmlns="http://www.springframework.org/schema/beans">
  <bean name="primary, alt" class="com.foo.Bar"/>
</beans>`;
    const result = parseSpringBeansXml(xml);
    expect(result.beans).toHaveLength(1);
    expect(result.beans[0].beanKey).toBe('primary');
    expect(result.beans[0].aliases).toEqual(['primary', 'alt']);
    expect(result.beans[0].id).toBeNull();
  });

  test('skips anonymous nested beans (no id, no name)', () => {
    const xml = `
<beans xmlns="http://www.springframework.org/schema/beans">
  <bean id="outer" class="com.foo.Outer">
    <property name="inner">
      <bean class="com.foo.AnonInner"/>
    </property>
  </bean>
</beans>`;
    const result = parseSpringBeansXml(xml);
    expect(result.beans.map((b) => b.beanKey)).toEqual(['outer']);
  });
});

describe('parseSpringBeansXml — context wiring', () => {
  test('extracts <context:component-scan base-package> (single + comma-separated)', () => {
    const xml = `
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:context="http://www.springframework.org/schema/context">
  <context:component-scan base-package="org.example.service"/>
  <context:component-scan base-package="org.example.web, org.example.dao"/>
</beans>`;
    const result = parseSpringBeansXml(xml);
    expect(result.componentScans).toEqual([
      { basePackages: ['org.example.service'] },
      { basePackages: ['org.example.web', 'org.example.dao'] },
    ]);
  });

  test('extracts <import resource="…"/>', () => {
    const xml = `
<beans xmlns="http://www.springframework.org/schema/beans">
  <import resource="classpath:applicationContext-data.xml"/>
  <import resource="applicationContext-security.xml"/>
</beans>`;
    const result = parseSpringBeansXml(xml);
    expect(result.imports.map((i) => i.resource)).toEqual([
      'classpath:applicationContext-data.xml',
      'applicationContext-security.xml',
    ]);
  });

  test('extracts <context:property-placeholder location="…"/>', () => {
    const xml = `
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:context="http://www.springframework.org/schema/context">
  <context:property-placeholder location="classpath:application.properties"/>
</beans>`;
    const result = parseSpringBeansXml(xml);
    expect(result.propertyPlaceholders).toEqual([
      { locations: ['classpath:application.properties'] },
    ]);
  });
});

describe('parseSpringBeansXml — robustness', () => {
  test('returns empty bundle for non-Spring XML', () => {
    const xml = `<hibernate-mapping><class name="X"/></hibernate-mapping>`;
    const result = parseSpringBeansXml(xml);
    expect(result.beans).toEqual([]);
    expect(result.componentScans).toEqual([]);
    expect(result.imports).toEqual([]);
  });

  test('strips comments before scanning (commented-out beans are not picked up)', () => {
    const xml = `
<beans xmlns="http://www.springframework.org/schema/beans">
  <!-- <bean id="commented" class="com.foo.Hidden"/> -->
  <bean id="active" class="com.foo.Active"/>
</beans>`;
    const result = parseSpringBeansXml(xml);
    expect(result.beans.map((b) => b.beanKey)).toEqual(['active']);
  });
});
