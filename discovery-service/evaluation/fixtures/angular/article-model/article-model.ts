
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
