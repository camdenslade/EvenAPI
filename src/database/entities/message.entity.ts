//********************************************************************
//
// Message Entity Class
//
// Represents a single chat message inside a Thread. Supports both text
// and optional image messages. Cascades: deleting a Thread deletes its
// Messages, deleting a Profile deletes their sent Messages.
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
// threadId          string      Thread ID (foreign key)
// thread            Thread      Thread relation
// senderProfileId   string      Profile ID (foreign key to Profile)
// senderProfile     Profile     Profile relation (eager loaded)
// text              string      Message text content
// imageUrl          string|null Optional image URL
// createdAt         Date        Message creation timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from "typeorm";

import { Thread } from "./thread.entity";
import { Profile } from "./profile.entity";

@Entity("messages")
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  threadId: string;

  @ManyToOne(() => Thread, (thread) => thread.messages, {
    onDelete: "CASCADE",
  })
  thread: Thread;

  @Column()
  senderProfileId: string;

  @ManyToOne(() => Profile, {
    eager: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "senderProfileId" })
  senderProfile: Profile;

  @Column({ type: "text" })
  text: string;

  @Column({ type: "text", nullable: true })
  imageUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
