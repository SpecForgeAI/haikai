
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
