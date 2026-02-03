//********************************************************************
//
// Thread Entity Class
//
// A thread is uniquely tied to a match. Only ONE thread may ever exist
// per match. The @Unique(['matchId']) constraint prevents race-condition
// duplication. Contains messages and tracks last message timestamp.
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
// matchId       string      Match ID (unique constraint)
// createdAt     Date        Thread creation timestamp
// updatedAt     Date        Thread last update timestamp
// lastMessageAt Date|null   Last message timestamp
// messages      Message[]   Messages in this thread
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Column,
  Unique,
} from "typeorm";

import { Message } from "./message.entity";

@Entity("threads")
@Unique(["matchId"])
export class Thread {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  matchId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  lastMessageAt: Date | null;

  @OneToMany(() => Message, (message) => message.thread, {
    cascade: true,
  })
  messages: Message[];
}
