//********************************************************************
//
// ReviewWeekWindow Entity Class
//
// Tracks a user's weekly review quota window. Includes windowStart and
// windowEnd for 7-day rolling period, reviewsUsed for remaining quota
// (max 3 per week), and ties directly to User. Cascades on user deletion.
//
// Return Value
// ------------
// None (TypeORM entity class)
//
// Value Parameters
// ----------------
// None
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// id            string      Primary key UUID
// user          User        User relation (indexed, cascades on delete)
// userId        string      User ID (foreign key)
// windowStart   Date        Window start timestamp
// windowEnd     Date        Window end timestamp
// reviewsUsed   number      Number of reviews used this week (0-3)
// createdAt     Date        Window creation timestamp
// updatedAt     Date        Window last update timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  JoinColumn,
} from "typeorm";

import { User } from "./user.entity";

@Entity({ name: "review_week_windows" })
export class ReviewWeekWindow {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  @Index()
  user: User;

  @Column()
  userId: string;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  windowStart: Date;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  windowEnd: Date;

  @Column({ type: "int", default: 0 })
  reviewsUsed: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
