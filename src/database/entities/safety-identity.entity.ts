//********************************************************************
//
// SafetyIdentity Entity Class
//
// Persistent record used to prevent ban evasion, emergency review abuse,
// and strike reset manipulation. Stored even after a user account is
// deleted. Contains historical moderation metadata tied to a phone number.
//
// CRITICAL POLICY: SafetyIdentity records are NEVER deleted automatically.
// They persist indefinitely for fraud prevention and safety enforcement.
// SafetyExclusion records depend on SafetyIdentity with ON DELETE RESTRICT
// to prevent accidental deletion. If a SafetyIdentity must be deleted
// (admin action only), all dependent SafetyExclusion records must be
// handled explicitly first.
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
// phoneHash           string      Hashed phone number (unique, indexed)
// emergencyUsed       boolean     Whether emergency review was used
// strikes             number      Number of review strikes
// lastReviewTimeout   Date|null   Last review timeout expiration
// lastSeenAt          Date|null   Last time this identity was seen
// deletedCount         number      Number of times account was deleted
// createdAt           Date        Record creation timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

const isTest = process.env.NODE_ENV === "test";

@Entity("safety_identities")
export class SafetyIdentity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", unique: true })
  @Index("IDX_safety_identities_phone_hash", { unique: true })
  phoneHash: string;

  @Column({ type: "boolean", default: false })
  emergencyUsed: boolean;

  @Column({ type: "int", default: 0 })
  strikes: number;

  @Column({
    type: isTest ? "datetime" : "timestamptz",
    nullable: true,
  })
  lastReviewTimeout?: Date | null;

  @Column({
    type: isTest ? "datetime" : "timestamptz",
    nullable: true,
  })
  lastSeenAt?: Date | null;

  @Column({ type: "int", default: 0 })
  deletedCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
