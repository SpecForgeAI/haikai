/**
 * Java Language Extractor
 *
 * Parses a Java source file into the universal SourceFileIR shape.
 * This is the new "language layer" of the refactored extension pack
 * architecture: it knows how to read Java syntax but has zero knowledge
 * of Spring, JPA, or any other framework.
 *
 * Delegates parsing to the tree-sitter-based parser (./javaParser) and AST
 * utility helpers (./astUtils) co-located in this directory. Both were
 * lifted from the legacy javaSpringBoot pack as part of the V3 V2-removal
 * (V3 Pack Migration Batch — Task Group 11).
 */
import { parseJavaFile, type Tree } from './javaParser';
import {
  extractClassDeclarations,
  extractAnnotationTypeDeclarations,
  extractImports,
  extractFieldDeclarations,
  extractMethodDeclarations,
  type ClassInfo,
  type MethodInfo,
  type FieldInfo,
  type AnnotationInfo,
  type AnnotationTypeInfo,
  type ParameterInfo,
  type CallInfo,
} from './astUtils';
import type {
  SourceFileIR,
  ClassIR,
  FieldIR,
  FunctionIR,
  ParameterIR,
  AnnotationIR,
  AnnotationTypeDeclIR,
  ImportIR,
  CallIR,
} from '../../languageIR';

function toAnnotationIR(a: AnnotationInfo): AnnotationIR {
  return { name: a.name, args: a.arguments, line: a.line };
}

function toAnnotationTypeDeclIR(a: AnnotationTypeInfo): AnnotationTypeDeclIR {
  return {
    name: a.name,
    annotations: a.annotations.map(toAnnotationIR),
    line: a.line,
  };
}

function toParameterIR(p: ParameterInfo): ParameterIR {
  return {
    name: p.name,
    type: p.type,
    annotations: p.annotations.map(toAnnotationIR),
  };
}

function toFieldIR(f: FieldInfo): FieldIR {
  return {
    name: f.name,
    type: f.type,
    annotations: f.annotations.map(toAnnotationIR),
    modifiers: f.modifiers,
    line: f.line,
  };
}

function toCallIR(c: CallInfo): CallIR {
  return {
    callee: c.callee,
    // Per-argument literal/placeholder text retained by the Java AST walk
    // (Outbound Integration Graph, Spec #5, Task Group 1; shared substrate
    // also consumed by Spec #6's SQL-text capture). `c.args.length === argCount`
    // and ORDER is preserved; populates the already-existing
    // `CallIR.args: string[]` IR field (no IR-type change).
    args: c.args,
    typeArgs: null,
    line: c.line,
    receiver: c.receiver,
    methodName: c.methodName,
  };
}

/**
 * Build the stable method identifier `FQN#name(ParamType1,ParamType2)` used
 * by the Endpoint->Data-Effect resolver and `business_logics` keying
 * (Task Group 3, 2026-05-29). The FQN is `package.ClassName` (package omitted
 * for the default package). Parameter types are stripped of generic args so
 * `save(List<Owner>)` keys as `save(List)` — stable across the source's
 * generic-erasure-equivalent overloads, which is all the resolver needs.
 */
function buildMethodId(fqn: string, m: MethodInfo): string {
  const paramTypes = m.parameters
    .map((p) => {
      const t = (p.type || '').trim();
      const lt = t.indexOf('<');
      const base = lt > 0 ? t.slice(0, lt) : t;
      // Keep only the simple type name (drop any package qualifier).
      const dot = base.lastIndexOf('.');
      return dot >= 0 ? base.slice(dot + 1) : base;
    })
    .join(',');
  return `${fqn}#${m.name}(${paramTypes})`;
}

function toFunctionIR(m: MethodInfo, fqn: string): FunctionIR {
  return {
    name: m.name,
    returnType: m.returnType,
    parameters: m.parameters.map(toParameterIR),
    annotations: m.annotations.map(toAnnotationIR),
    modifiers: m.modifiers,
    line: m.line,
    calls: m.calls.map(toCallIR),
    methodId: buildMethodId(fqn, m),
  };
}

function toClassIR(c: ClassInfo, packageName: string): ClassIR {
  // Fully-qualified class name: `package.ClassName` (package omitted for the
  // default package). Used to stamp every method's stable id.
  const fqn = packageName ? `${packageName}.${c.name}` : c.name;
  const fields = extractFieldDeclarations(c.node).map(toFieldIR);
  const methods = extractMethodDeclarations(c.node).map((m) => toFunctionIR(m, fqn));
  return {
    name: c.name,
    annotations: c.annotations.map(toAnnotationIR),
    extends: c.superclass,
    implements: c.interfaces,
    isInterface: c.isInterface,
    isAbstract: c.modifiers.includes('abstract'),
    modifiers: c.modifiers,
    fields,
    methods,
    line: c.line,
  };
}

function toImportIR(importPath: string): ImportIR {
  // Java imports are fully-qualified names. The "imported name" is the last
  // segment (e.g. "org.springframework.stereotype.Controller" → "Controller").
  const lastDot = importPath.lastIndexOf('.');
  const name = lastDot === -1 ? importPath : importPath.slice(lastDot + 1);
  return { path: importPath, names: name === '*' ? [] : [name] };
}

/**
 * Parses a Java source file and emits a SourceFileIR.
 * Returns null if the file cannot be parsed.
 */
export function extractJavaIR(
  filePath: string,
  sourceCode: string,
): SourceFileIR | null {
  const tree: Tree | null = parseJavaFile(sourceCode);
  if (!tree) return null;

  const classInfos = extractClassDeclarations(tree);
  const annotationDecls = extractAnnotationTypeDeclarations(tree);
  const imports = extractImports(tree).map(toImportIR);

  // Derive package name from first class (all classes in a file share the
  // package). Fall back to an annotation-type declaration's absence-of-package
  // (empty) when a file only declares an annotation type.
  const packageOrNamespace = classInfos[0] ? classInfos[0].packageName : '';

  const classes = classInfos.map((c) => toClassIR(c, packageOrNamespace));

  const ir: SourceFileIR = {
    filePath,
    language: 'java',
    packageOrNamespace,
    imports,
    classes,
    functions: [], // Java has no top-level functions
    // Attach the raw source so framework adapters can detect call-site
    // patterns the structural IR doesn't model (RestTemplate.getForObject,
    // WebClient builder chains, etc.). Mirrors the angularjs-classic /
    // typescript pattern that already uses `rawContent`.
    rawContent: sourceCode,
  };
  // Only attach when present so files without custom annotation types keep the
  // existing IR shape exactly (field stays undefined).
  if (annotationDecls.length > 0) {
    ir.annotationDeclarations = annotationDecls.map(toAnnotationTypeDeclIR);
  }
  return ir;
}
