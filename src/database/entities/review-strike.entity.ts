//********************************************************************
//
// ReviewStrike Entity Class
//
// Represents a moderation strike applied to a user for violating review
// guidelines (e.g., abusive language, keyword violations). Each strike
// has a reason, strike number (1–3), timeout duration and expiration.
// Cascades on user deletion.
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
// id                string      Primary key UUID
// user              User        User relation (indexed, cascades on delete)
// userId            string      User ID (foreign key)
// reason            string      Reason for the strike
// strikeNumber      number      Strike number (1-3)
// timeoutHours      number      Timeout duration in hours
// timeoutExpiresAt  Date        Timeout expiration timestamp
// createdAt         Date        Strike creation timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
  JoinColumn,
} from "typeorm";

import { User } from "./user.entity";

@Entity({ name: "review_strikes" })
export class ReviewStrike {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  @Index()
  user: User;

  @Column()
  userId: string;

  @Column({ type: "varchar", length: 255 })
  reason: string;

  @Column({ type: "int" })
  strikeNumber: number;

  @Column({ type: "int" })
  timeoutHours: number;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  timeoutExpiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
