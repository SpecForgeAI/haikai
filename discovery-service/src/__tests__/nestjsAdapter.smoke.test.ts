/**
 * Smoke tests for the V3 NestJS pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 3)
 *
 * Migrated from direct `extractTypeScriptIR` + `runNestjsAdapter` invocation
 * to the V3 pack shape: `typescriptLangPack.extract` +
 * `nestjsFrameworkPack.adapt`. All assertions are preserved verbatim — only
 * the invocation shape changes.
 *
 * Uses fixtures modelled on the canonical `nestjs-realworld-example-app` patterns:
 *   @Controller('path') + HTTP method decorators for interface/endpoint
 *   @Entity() + @Column/@PrimaryGeneratedColumn + relationship decorators
 *   @Injectable() service classes with business-logic methods
 *   DTO classes referenced by @Body() params
 */
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { nestjsFrameworkPack } from '../services/extensionPacks/frameworkPacks/nestjsFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const NESTJS_HINTS: TechHints = {
  '0': { language: 'TypeScript' },
  '1': { technology: 'NestJS' },
};

function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = typescriptLangPack.extract(files, NESTJS_HINTS);
  return nestjsFrameworkPack.adapt(irFiles, runId, NESTJS_HINTS);
}

const CONTROLLER_SRC = `
import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ArticleService } from './article.service';
import { CreateArticleDto } from './dto/create-article.dto';

@Controller('articles')
export class ArticleController {
  constructor(private readonly articleService: ArticleService) {}

  @Get()
  findAll(@Query() query: any): Promise<ArticleDto[]> {
    return this.articleService.findAll(query);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<ArticleDto> {
    return this.articleService.findOne(slug);
  }

  @Post()
  create(@Body('article') data: CreateArticleDto): Promise<ArticleDto> {
    return this.articleService.create(data);
  }

  @Put(':slug')
  update(@Param('slug') slug: string, @Body('article') data: CreateArticleDto): Promise<ArticleDto> {
    return this.articleService.update(slug, data);
  }

  @Delete(':slug')
  delete(@Param('slug') slug: string): Promise<void> {
    return this.articleService.delete(slug);
  }
}
`;

const ENTITY_SRC = `
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { UserEntity } from '../user/user.entity';
import { Comment } from './comment.entity';

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
  @JoinColumn()
  comments: Comment[];

  // Non-column field — should NOT be emitted as physical_attribute
  transientField: string;
}
`;

const SERVICE_SRC = `
import { Injectable } from '@nestjs/common';

@Injectable()
export class ArticleService {
  constructor() {}

  async findAll(query: any): Promise<any[]> { return []; }
  async findOne(slug: string): Promise<any> { return null; }
  async create(data: any): Promise<any> { return null; }
  async update(slug: string, data: any): Promise<any> { return null; }
  async delete(slug: string): Promise<void> { return; }

  // Genuine business logic
  async evaluateArticleScore(article: any): Promise<number> {
    return 0;
  }

  async normalizeArticleSlug(raw: string): Promise<string> {
    return raw.toLowerCase();
  }
}
`;

const DTO_SRC = `
import { IsString, IsOptional } from 'class-validator';

export class CreateArticleDto {
  @IsString()
  title: string;

  @IsString()
  body: string;

  @IsOptional()
  tagList?: string[];
}

export class ArticleDto {
  id: number;
  slug: string;
  title: string;
  body: string;
  author: string;
}
`;

describe('NestJS V3 pack pair smoke tests', () => {
  const files = new Map<string, string>([
    ['src/article/article.controller.ts', CONTROLLER_SRC],
    ['src/article/article.entity.ts', ENTITY_SRC],
    ['src/article/article.service.ts', SERVICE_SRC],
    ['src/article/dto/create-article.dto.ts', DTO_SRC],
  ]);

  it('emits 1 interface candidate for @Controller class', () => {
    const candidates = runV3Pipeline(files, 'nestjs-smoke');
    const interfaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(interfaces).toHaveLength(1);
    expect(interfaces[0].name).toBe('ArticleController');
    expect(interfaces[0].data.basePath).toBe('articles');
    expect(interfaces[0].data.controllerType).toBe('NestController');
  });

  it('emits endpoint candidates with HTTP method + fullPath', () => {
    const candidates = runV3Pipeline(files, 'nestjs-smoke');
    const endpoints = candidates.filter((c) => c.candidateType === 'endpoints');
    expect(endpoints).toHaveLength(5);
    const names = endpoints.map((e) => e.name).sort();
    expect(names).toEqual([
      'DELETE /articles/:slug',
      'GET /articles',
      'GET /articles/:slug',
      'POST /articles',
      'PUT /articles/:slug',
    ]);
  });

  it('endpoint metadata captures @Body type, @Param vars, and response type', () => {
    const candidates = runV3Pipeline(files, 'nestjs-smoke');
    const post = candidates.find((c) => c.candidateType === 'endpoints' && c.name === 'POST /articles')!;
    expect(post.data.httpMethod).toBe('POST');
    expect(post.data.requestBodyType).toBe('CreateArticleDto');
    expect(post.data.responseType).toBe('ArticleDto');

    const getOne = candidates.find((c) => c.name === 'GET /articles/:slug')!;
    const pathVars = getOne.data.pathVariables as Array<{ name: string; type: string }>;
    expect(pathVars).toHaveLength(1);
    expect(pathVars[0].name).toBe('slug');
  });

  it('emits physical_entity for @Entity class with tableName', () => {
    const candidates = runV3Pipeline(files, 'nestjs-smoke');
    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('ArticleEntity');
    expect(entities[0].data.tableName).toBe('article');
  });

  it('emits physical_attribute only for @Column / @PrimaryGeneratedColumn fields', () => {
    const candidates = runV3Pipeline(files, 'nestjs-smoke');
    const attrs = candidates.filter((c) => c.candidateType === 'physical_data_attributes');
    const names = attrs.map((a) => a.name).sort();
    // id (PrimaryGeneratedColumn), slug, title, body (@Column) — but NOT author/comments (relationships) or transientField (no decorator)
    expect(names).toEqual(['body', 'id', 'slug', 'title']);
    const id = attrs.find((a) => a.name === 'id')!;
    expect(id.data.isPrimaryKey).toBe(true);
  });

  it('emits entity_relationship from @ManyToOne / @OneToMany', () => {
    const candidates = runV3Pipeline(files, 'nestjs-smoke');
    const rels = candidates.filter((c) => c.candidateType === 'logical_data_entity_relationships');
    const names = rels.map((r) => r.name).sort();
    expect(names).toEqual(['ArticleEntity → Comment', 'ArticleEntity → UserEntity']);
    const manyOne = rels.find((r) => r.name === 'ArticleEntity → UserEntity')!;
    expect(manyOne.data.cardinality).toBe('MANY_TO_ONE');
  });

  it('emits business_logic only for non-CRUD methods on @Injectable services', () => {
    const candidates = runV3Pipeline(files, 'nestjs-smoke');
    const bl = candidates.filter((c) => c.candidateType === 'business_logics');
    const names = bl.map((b) => b.name).sort();
    // findAll, findOne, create, update, delete are CRUD-prefixed → excluded
    expect(names).toEqual(['evaluateArticleScore', 'normalizeArticleSlug']);
  });

  it('emits logical_entity + logical_data_attribute for DTOs referenced in controller params/returns', () => {
    const candidates = runV3Pipeline(files, 'nestjs-smoke');
    const logicals = candidates.filter((c) => c.candidateType === 'logical_data_entities');
    const names = logicals.map((l) => l.name).sort();
    expect(names).toEqual(['ArticleDto', 'CreateArticleDto']);

    const attrs = candidates.filter((c) => c.candidateType === 'logical_data_attributes');
    const attrNames = attrs.map((a) => a.name).sort();
    // CreateArticleDto(3) + ArticleDto(5) = 8
    expect(attrNames).toHaveLength(8);
  });
});
