//********************************************************************
//
// VerifiedSchoolEmail Entity Class
//
// Stores school emails that have been verified at least once. This
// persists across account deletion to prevent re-granting one-time
// incentives.
//
// Return Value
// ------------
// None (TypeORM entity class)
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

@Entity("verified_school_emails")
export class VerifiedSchoolEmail {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @CreateDateColumn({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  firstVerifiedAt: Date;

  @UpdateDateColumn({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  lastVerifiedAt: Date;

  @Column({ type: "varchar", nullable: true })
  lastVerifiedByUid: string | null;
}
