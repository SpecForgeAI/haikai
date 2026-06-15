
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class CommentService {
  constructor(private http: HttpClient) {}

  getForArticle(slug: string) { return this.http.get(`/api/articles/${slug}/comments`); }
  createComment(slug: string, body: string) { return this.http.post(`/api/articles/${slug}/comments`, { body }); }
  deleteComment(slug: string, id: number) { return this.http.delete(`/api/articles/${slug}/comments/${id}`); }

  moderateComment(text: string): boolean { return text.length < 1000; }
}
