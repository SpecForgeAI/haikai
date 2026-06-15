
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
