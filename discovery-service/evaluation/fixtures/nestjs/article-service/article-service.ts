
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
