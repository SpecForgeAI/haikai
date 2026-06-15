
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
  await axios.delete(`/api/articles/${slug}`);
}
