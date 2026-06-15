
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ArticleService {
  constructor(private http: HttpClient) {}

  getArticles() { return this.http.get('/api/articles'); }
  createArticle(payload: any) { return this.http.post('/api/articles', payload); }
  deleteArticle(slug: string) { return this.http.delete(`/api/articles/${slug}`); }
  evaluateArticleScore(article: any) { return 0; }
  normalizeSlug(raw: string): string { return raw.toLowerCase(); }
}
