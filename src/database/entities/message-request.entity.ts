//********************************************************************
//
// MessageRequest Entity Class
//
// Represents a message request sent from one user to another before
// they are matched. Status can be pending, accepted, or rejected.
// Contains the initial message content and optional image. Tracks
// acceptance and rejection timestamps.
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
// id            string              Primary key UUID
// senderUid     string              Firebase UID of sender
// recipientUid  string              Firebase UID of recipient
// content       string              Message content text
// imageUrl      string|null         Optional image URL
// createdAt     Date                Request creation timestamp
// status        MessageRequestStatus Request status (pending, accepted, rejected)
// acceptedAt    Date|null           Acceptance timestamp
// rejectedAt    Date|null           Rejection timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("message_requests")
export class MessageRequest {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  senderUid: string;

  @Column()
  recipientUid: string;

  @Column({ type: "text" })
  content: string;

  @Column({ type: "text", nullable: true })
  imageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({
    type: "varchar",
    enum: ["pending", "accepted", "rejected"],
    default: "pending",
  })
  status: "pending" | "accepted" | "rejected";

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  acceptedAt: Date | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  rejectedAt: Date | null;
}
