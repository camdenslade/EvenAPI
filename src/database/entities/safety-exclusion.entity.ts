//********************************************************************
//
// SafetyExclusion Entity Class
//
// Persistent safety enforcement record that prevents users from interacting
// with each other even after account deletion and re-signup. Unlike Block
// records (which are social and user-visible), SafetyExclusion is internal
// and persists across account deletion by design. Used to enforce persistent
// safety policies based on SafetyIdentity (phone hash).
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
// id                      string      Primary key UUID
// sourceSafetyIdentityId  string      SafetyIdentity ID of user who created exclusion
// targetSafetyIdentityId string      SafetyIdentity ID of user who is excluded
// reason                  string      Reason for exclusion (e.g. 'user_block')
// createdAt               Date        Exclusion creation timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";

import { SafetyIdentity } from "./safety-identity.entity";

@Entity("safety_exclusions")
@Index(
  "IDX_safety_exclusions_unique",
  ["sourceSafetyIdentityId", "targetSafetyIdentityId"],
  {
    unique: true,
  },
)
export class SafetyExclusion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  sourceSafetyIdentityId: string;

  @Column()
  targetSafetyIdentityId: string;

  @Column({ type: "varchar" })
  reason: string;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => SafetyIdentity)
  @JoinColumn({ name: "sourceSafetyIdentityId" })
  sourceSafetyIdentity: SafetyIdentity;

  @ManyToOne(() => SafetyIdentity)
  @JoinColumn({ name: "targetSafetyIdentityId" })
  targetSafetyIdentity: SafetyIdentity;
}
