//********************************************************************
//
// Match Entity Class
//
// Represents a match between two users. Matches do NOT auto-create
// threads. Matches expire after 14 days if no messages were sent.
// Expired matches CAN be recreated on future mutual-like events.
// Status values: active (usable, visible in UI), expired (expired but
// preserved for analytics), archived (user-removed from UI, optional
// future), restored (manually restored, treated as active).
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
// id              string              Primary key UUID
// userAUid        string              Firebase UID of first user
// userBUid        string              Firebase UID of second user
// createdAt       Date                Match creation timestamp
// firstMessageAt  Date|null           First real chat message time (null until someone sends one)
// restoredAt      Date|null           Premium restore timestamp
// lastActivityAt  Date                Updates whenever a message is sent OR match is created
// status          MatchStatus         Match status (active, expired, archived, restored)
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("matches")
export class Match {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  userAUid!: string;

  @Column()
  userBUid!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  firstMessageAt!: Date | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  restoredAt!: Date | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  lastActivityAt!: Date;

  @Column({
    type: "varchar",
    enum: ["active", "expired", "archived", "restored"],
    default: "active",
  })
  status!: "active" | "expired" | "archived" | "restored";
}
