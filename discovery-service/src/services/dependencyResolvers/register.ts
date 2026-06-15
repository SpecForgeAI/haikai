/**
 * Dependency Resolver Startup Registration
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 2.
 *
 * Imports and registers all available {@link DependencyResolver}s
 * with the {@link dependencyResolverRegistry} at module load time
 * (side-effect import). Mirrors the `extensionPacks/register.ts`
 * pattern.
 *
 * V1 ecosystems: Maven (pom.xml), npm (package.json).
 * Phase 2 (Gradle, .NET, Go, Python) is out of scope per spec.
 */

import { registerDependencyResolver } from '../dependencyResolverRegistry';
import { mavenDependencyResolver } from './maven/MavenDependencyResolver';
import { npmDependencyResolver } from './npm/NpmDependencyResolver';

registerDependencyResolver(mavenDependencyResolver);
registerDependencyResolver(npmDependencyResolver);
