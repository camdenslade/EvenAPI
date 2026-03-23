//********************************************************************
//
// Referral Entity Class
//
// Tracks referrals sent by users to prospective new members. Records
// the status of the referral lifecycle from pending through rewarded.
// Both the referrer and the referred user receive token rewards once
// the referred user has been active for 60 minutes.
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
// id                string              Primary key UUID
// referrerUserId    string              User ID of the referrer (FK to users.id)
// referredEmail     string              Email address of the referred person
// referredUserId    string|null         User ID set when the referred user creates account
// status            ReferralStatus      Current status of the referral
// referrerRewarded  boolean             Whether referrer received 1 free search token
// referredRewarded  boolean             Whether referred user received 1 free message_request token
// minutesActive     number              Minutes the referred user has been active in-app
// createdAt         Date                Referral creation timestamp
// updatedAt         Date                Referral last update timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export type ReferralStatus = "pending" | "signed_up" | "qualified" | "rewarded";

@Entity("referrals")
@Index(["referredEmail"], { unique: true })
@Index(["referrerUserId"])
@Index(["referredUserId"])
export class Referral {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar" })
  referrerUserId: string;

  @Column({ type: "varchar" })
  referredEmail: string;

  @Column({ type: "varchar", nullable: true })
  referredUserId: string | null;

  @Column({ type: "varchar", default: "pending" })
  status: ReferralStatus;

  @Column({ type: "boolean", default: false })
  referrerRewarded: boolean;

  @Column({ type: "boolean", default: false })
  referredRewarded: boolean;

  @Column({ type: "int", default: 0 })
  minutesActive: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
