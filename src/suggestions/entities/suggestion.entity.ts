//********************************************************************
//
// Suggestion Entity
//
// Stores public product suggestions.
//
//********************************************************************

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("suggestions")
export class Suggestion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column()
  category: string;

  @Column()
  subject: string;

  @Column({ type: "text" })
  suggestion: string;

  @Column({ default: "new" })
  status: "new" | "reviewed" | "implemented" | "rejected";

  @CreateDateColumn()
  createdAt: Date;
}
