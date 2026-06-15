
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
