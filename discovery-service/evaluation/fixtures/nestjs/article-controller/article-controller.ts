
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
