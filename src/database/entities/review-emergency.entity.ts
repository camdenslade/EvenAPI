//********************************************************************
//
// ReviewEmergency Entity Class
//
// Tracks "emergency reviews" — a special one-time review a user can leave
// without meeting normal chat/message requirements. Fields include reviewer
// and target relations, used flag and timestamp, and phoneNumberSnapshot
// for audit and safety. Cascades on user deletion.
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
// id                  string      Primary key UUID
// reviewer            User        Reviewer user relation (indexed, cascades on delete)
// reviewerId          string      Reviewer user ID (foreign key)
// target              User        Target user relation (indexed, cascades on delete)
// targetId            string      Target user ID (foreign key)
// used                boolean     Whether emergency review has been used
// usedAt              Date|null   Timestamp when emergency review was used
// phoneNumberSnapshot string|null Phone number snapshot for audit
// createdAt           Date        Record creation timestamp
// updatedAt           Date        Record last update timestamp
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

@Entity({ name: "review_emergency" })
export class ReviewEmergency {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "reviewerId" })
  @Index()
  reviewer: User;

  @Column()
  reviewerId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "targetId" })
  @Index()
  target: User;

  @Column()
  targetId: string;

  @Column({ type: "boolean", default: false })
  used: boolean;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  usedAt: Date | null;

  @Column({ type: "varchar", nullable: true })
  phoneNumberSnapshot: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
