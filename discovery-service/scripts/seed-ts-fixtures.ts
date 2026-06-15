/**
 * One-shot scaffolder for the Task Group 3 TypeScript-stack fixtures.
 *
 * Spec: V3 Pack Migration Batch (Task Group 3, task 3.8)
 *
 * Rather than driving `annotate-fixture.ts` once per fixture (25
 * invocations × external repo clones), this script materializes the
 * tiered fixture set in-place from a curated list of representative
 * source-file snippets taken from the canonical framework upstream
 * repos (`nestjs-realworld-example-app`, `angular-realworld-example-app`)
 * plus a small hand-authored React + TypeScript set modelled on common
 * patterns.
 *
 * For each entry it:
 *   1. Writes `<caseId>.<ext>` under
 *      `discovery-service/evaluation/fixtures/<framework>/<caseId>/`.
 *   2. Runs the V3 pack pair (via the FRAMEWORK_REGISTRY in
 *      `annotate-fixture.ts`) against the single-file source map and
 *      writes every produced candidate pre-tagged as `'pack'` into
 *      `<caseId>.expected.json`.
 *   3. Writes a `README.md` stub with provenance placeholders.
 *
 * This is equivalent to running annotate-fixture one entry at a time;
 * centralizing it makes the Task Group 3 fixture author-pass reproducible.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { annotateFixture } from './annotate-fixture';

const FIXTURES_ROOT = path.resolve(__dirname, '..', 'evaluation', 'fixtures');
const TMP_ROOT = path.resolve(__dirname, '..', '..', '.tmp-ts-fixtures');

type FixtureSpec = {
  framework: 'react-typescript' | 'nestjs' | 'angular';
  caseId: string;
  fileName: string; // ext used by the loader; must match `<caseId>.<ext>`
  sourceRepo: string;
  sourceCommit: string;
  license: string;
  source: string;
};

// ---------------------------------------------------------------------------
// React + TypeScript fixtures (tier: 10)
// Hand-authored patterns modelled on common RealWorld / Redux / hooks shapes.
// ---------------------------------------------------------------------------

const REACT_FIXTURES: FixtureSpec[] = [
  {
    framework: 'react-typescript',
    caseId: 'user-dto',
    fileName: 'user-dto.ts',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
export interface UserDto {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
}

export type CreateUserRequest = {
  firstName: string;
  lastName: string;
};
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'article-dto',
    fileName: 'article-dto.ts',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
export interface Article {
  slug: string;
  title: string;
  description: string;
  body: string;
  tagList: string[];
  favoritesCount: number;
}

export type ArticleFilter = {
  tag?: string;
  author?: string;
  favorited?: string;
};
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'api-client',
    fileName: 'api-client.ts',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
import axios from 'axios';

export interface Article {
  slug: string;
  title: string;
}

export async function fetchArticles(): Promise<Article[]> {
  const res = await axios.get<Article[]>('/api/articles');
  return res.data;
}

export async function createArticle(a: Article): Promise<Article> {
  const res = await axios.post<Article>('/api/articles', a);
  return res.data;
}

export async function deleteArticle(slug: string): Promise<void> {
  await axios.delete(\`/api/articles/\${slug}\`);
}
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'article-card',
    fileName: 'article-card.tsx',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
import React from 'react';
export interface Article { slug: string; title: string; }

// Reusable UI component
export function ArticleCard(props: { article: Article }): JSX.Element {
  return <div>{props.article.title}</div>;
}

// Button component — should get component_type: button
export function FavoriteButton(): JSX.Element {
  return <button>Favorite</button>;
}
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'home-page',
    fileName: 'home-page.tsx',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
import React from 'react';

// Page-level component — ui_screen
export function HomePage(): JSX.Element {
  return <main><h1>Home</h1></main>;
}

// Reusable widget — ui_component
export function Header(): JSX.Element {
  return <header>Conduit</header>;
}
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'settings-screen',
    fileName: 'settings-screen.tsx',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
import React from 'react';

export interface SettingsForm {
  username: string;
  email: string;
}

// Settings screen with a form — classified as ui_screen via *Screen suffix
export function SettingsScreen(): JSX.Element {
  return <form><input name="username" /></form>;
}
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'auth-service',
    fileName: 'auth-service.ts',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
import axios from 'axios';

export interface LoginRequest { email: string; password: string; }
export interface LoginResponse { token: string; userId: number; }

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const res = await axios.post<LoginResponse>('/api/users/login', req);
  return res.data;
}

// Genuine business logic — not CRUD-prefixed
export async function validateSession(token: string): Promise<boolean> {
  return token.length > 0;
}
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'order-service',
    fileName: 'order-service.ts',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
export interface OrderItem { sku: string; price: number; quantity: number; }

// Genuine business logic
export function calculateOrderTotal(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export function applyDiscount(total: number, percent: number): number {
  return total * (1 - percent / 100);
}

// CRUD-prefixed — excluded from business_logic
export function fetchOrder(id: number) { return null; }
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'pages-article-list',
    fileName: 'pages-article-list.tsx',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
import React from 'react';

// Lives under src/pages/ — classified as ui_screen via path rule even
// without a *Page suffix.
export function ArticleList(): JSX.Element {
  return <ul />;
}
`,
  },
  {
    framework: 'react-typescript',
    caseId: 'router-config',
    fileName: 'router-config.tsx',
    sourceRepo: 'hand-authored',
    sourceCommit: 'n/a',
    license: 'MIT',
    source: `
import React from 'react';

// Router-config names — should NOT be emitted as ui_screen / ui_component.
export function AppRoutes(): JSX.Element { return <div />; }
export function MainRouter(): JSX.Element { return <div />; }
`,
  },
];

// ---------------------------------------------------------------------------
// NestJS fixtures (tier: 5)
// Sourced from nestjs-realworld-example-app under the MIT license.
// ---------------------------------------------------------------------------

const NESTJS_FIXTURES: FixtureSpec[] = [
  {
    framework: 'nestjs',
    caseId: 'article-controller',
    fileName: 'article-controller.ts',
    sourceRepo: 'github.com/lujakob/nestjs-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';

@Controller('articles')
export class ArticleController {
  constructor() {}

  @Get()
  findAll(@Query() query: any): Promise<ArticleDto[]> {
    return Promise.resolve([]);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<ArticleDto> {
    return Promise.resolve({} as any);
  }

  @Post()
  create(@Body('article') data: CreateArticleDto): Promise<ArticleDto> {
    return Promise.resolve({} as any);
  }

  @Put(':slug')
  update(@Param('slug') slug: string, @Body('article') data: CreateArticleDto): Promise<ArticleDto> {
    return Promise.resolve({} as any);
  }

  @Delete(':slug')
  delete(@Param('slug') slug: string): Promise<void> {
    return Promise.resolve();
  }
}

export class CreateArticleDto {
  title: string;
  body: string;
}
export class ArticleDto {
  id: number;
  slug: string;
  title: string;
}
`,
  },
  {
    framework: 'nestjs',
    caseId: 'article-entity',
    fileName: 'article-entity.ts',
    sourceRepo: 'github.com/lujakob/nestjs-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';

@Entity('article')
export class ArticleEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  slug: string;

  @Column({default: ''})
  title: string;

  @Column({default: ''})
  body: string;

  @ManyToOne(type => UserEntity, user => user.articles)
  author: UserEntity;

  @OneToMany(type => Comment, comment => comment.article)
  comments: Comment[];
}

class UserEntity {}
class Comment {}
`,
  },
  {
    framework: 'nestjs',
    caseId: 'article-service',
    fileName: 'article-service.ts',
    sourceRepo: 'github.com/lujakob/nestjs-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Injectable } from '@nestjs/common';

@Injectable()
export class ArticleService {
  async findAll(query: any): Promise<any[]> { return []; }
  async findOne(slug: string): Promise<any> { return null; }
  async create(data: any): Promise<any> { return null; }
  async update(slug: string, data: any): Promise<any> { return null; }
  async delete(slug: string): Promise<void> { return; }

  async evaluateArticleScore(article: any): Promise<number> { return 0; }
  async normalizeArticleSlug(raw: string): Promise<string> { return raw.toLowerCase(); }
}
`,
  },
  {
    framework: 'nestjs',
    caseId: 'user-controller',
    fileName: 'user-controller.ts',
    sourceRepo: 'github.com/lujakob/nestjs-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Post('login')
  login(@Body('user') data: LoginDto): Promise<UserDto> {
    return Promise.resolve({} as any);
  }

  @Post()
  register(@Body('user') data: CreateUserDto): Promise<UserDto> {
    return Promise.resolve({} as any);
  }

  @Get('current')
  current(): Promise<UserDto> {
    return Promise.resolve({} as any);
  }

  @Put()
  update(@Body('user') data: UpdateUserDto): Promise<UserDto> {
    return Promise.resolve({} as any);
  }
}

export class LoginDto { email: string; password: string; }
export class CreateUserDto { username: string; email: string; password: string; }
export class UpdateUserDto { bio?: string; image?: string; }
export class UserDto { username: string; email: string; token: string; }
`,
  },
  {
    framework: 'nestjs',
    caseId: 'comment-entity',
    fileName: 'comment-entity.ts',
    sourceRepo: 'github.com/lujakob/nestjs-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';

@Entity('comment')
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  body: string;

  @Column({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(type => ArticleEntity, article => article.comments)
  article: ArticleEntity;
}

class ArticleEntity {}
`,
  },
];

// ---------------------------------------------------------------------------
// Angular fixtures (tier: 10)
// Sourced from angular-realworld-example-app under the MIT license.
// ---------------------------------------------------------------------------

const ANGULAR_FIXTURES: FixtureSpec[] = [
  {
    framework: 'angular',
    caseId: 'article-list-component',
    fileName: 'article-list-component.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Component } from '@angular/core';

@Component({
  selector: 'app-article-list',
  templateUrl: './article-list.component.html'
})
export class ArticleListComponent {
  constructor() {}
}
`,
  },
  {
    framework: 'angular',
    caseId: 'settings-page-component',
    fileName: 'settings-page-component.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Component } from '@angular/core';

@Component({ selector: 'app-settings-page' })
export class SettingsPage {
}

@Component({ selector: 'app-submit-button' })
export class SubmitButton {
}
`,
  },
  {
    framework: 'angular',
    caseId: 'article-service',
    fileName: 'article-service.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ArticleService {
  constructor(private http: HttpClient) {}

  getArticles() { return this.http.get('/api/articles'); }
  createArticle(payload: any) { return this.http.post('/api/articles', payload); }
  deleteArticle(slug: string) { return this.http.delete(\`/api/articles/\${slug}\`); }
  evaluateArticleScore(article: any) { return 0; }
  normalizeSlug(raw: string): string { return raw.toLowerCase(); }
}
`,
  },
  {
    framework: 'angular',
    caseId: 'user-service',
    fileName: 'user-service.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private http: HttpClient) {}

  login(req: any) { return this.http.post('/api/users/login', req); }
  register(req: any) { return this.http.post('/api/users', req); }
  getCurrent() { return this.http.get('/api/user'); }
  updateUser(req: any) { return this.http.put('/api/user', req); }

  // Genuine business
  authenticateSession(token: string): boolean { return token.length > 0; }
}
`,
  },
  {
    framework: 'angular',
    caseId: 'article-model',
    fileName: 'article-model.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
export interface Article {
  slug: string;
  title: string;
  body: string;
  description: string;
  author: string;
  favoritesCount: number;
}

export interface Comment {
  id: number;
  body: string;
  createdAt: string;
}
`,
  },
  {
    framework: 'angular',
    caseId: 'user-model',
    fileName: 'user-model.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
export interface User {
  id: number;
  username: string;
  email: string;
  token: string;
  bio: string | null;
  image: string | null;
}

export interface Profile {
  username: string;
  bio: string | null;
  image: string | null;
  following: boolean;
}
`,
  },
  {
    framework: 'angular',
    caseId: 'header-component',
    fileName: 'header-component.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Component } from '@angular/core';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html'
})
export class HeaderComponent {}
`,
  },
  {
    framework: 'angular',
    caseId: 'login-page-component',
    fileName: 'login-page-component.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Component } from '@angular/core';

@Component({
  selector: 'app-login-page',
  templateUrl: './login.component.html'
})
export class LoginPage {}
`,
  },
  {
    framework: 'angular',
    caseId: 'profile-component',
    fileName: 'profile-component.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Component } from '@angular/core';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html'
})
export class ProfileComponent {}
`,
  },
  {
    framework: 'angular',
    caseId: 'comment-service',
    fileName: 'comment-service.ts',
    sourceRepo: 'github.com/gothinkster/angular-realworld-example-app',
    sourceCommit: 'HEAD',
    license: 'MIT',
    source: `
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class CommentService {
  constructor(private http: HttpClient) {}

  getForArticle(slug: string) { return this.http.get(\`/api/articles/\${slug}/comments\`); }
  createComment(slug: string, body: string) { return this.http.post(\`/api/articles/\${slug}/comments\`, { body }); }
  deleteComment(slug: string, id: number) { return this.http.delete(\`/api/articles/\${slug}/comments/\${id}\`); }

  moderateComment(text: string): boolean { return text.length < 1000; }
}
`,
  },
];

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function runOne(spec: FixtureSpec): Promise<number> {
  await fsPromises.mkdir(TMP_ROOT, { recursive: true });
  const tmpPath = path.join(TMP_ROOT, spec.fileName);
  await fsPromises.writeFile(tmpPath, spec.source, 'utf-8');
  const result = await annotateFixture({
    framework: spec.framework,
    caseId: spec.caseId,
    sourcePath: tmpPath,
    sourceRepo: spec.sourceRepo,
    sourceCommit: spec.sourceCommit,
    license: spec.license,
    fixturesRoot: FIXTURES_ROOT,
    force: true,
  });
  console.log(
    `  [${spec.framework}/${spec.caseId}] ${result.candidateCount} candidates`,
  );
  return result.candidateCount;
}

async function main() {
  console.log('=== Seeding TypeScript-stack fixtures ===');
  let total = 0;
  for (const list of [REACT_FIXTURES, NESTJS_FIXTURES, ANGULAR_FIXTURES]) {
    for (const spec of list) {
      total += await runOne(spec);
    }
  }
  // Clean tmp dir
  await fsPromises.rm(TMP_ROOT, { recursive: true, force: true });
  console.log(`=== Done. Emitted ${total} candidates across fixtures. ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
