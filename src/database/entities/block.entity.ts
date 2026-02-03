//********************************************************************
//
// Block Entity Class
//
// Represents a block relationship between users. A block prevents
// messaging, matching, swiping, and appearing in searches.
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
// id          string      Primary key UUID
// blockerUid  string      Firebase UID of user who blocked
// blockedUid  string      Firebase UID of user who was blocked
// createdAt   Date        Block creation timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("blocks")
export class Block {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  blockerUid: string;

  @Column()
  blockedUid: string;

  @CreateDateColumn()
  createdAt: Date;
}
