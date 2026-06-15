
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';

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
  comments: Comment[];
}

class UserEntity {}
class Comment {}
