//********************************************************************
//
// EmailVerification Entity Class
//
// Stores email verification codes for school email verification.
// Codes expire after 15 minutes and can only be used once.
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
// id          string    Primary key UUID
// userUid     string    Firebase UID of user
// email       string    Email address being verified (lowercase)
// code        string    Verification code (6-digit, stored lowercase)
// expiresAt   Date      Expiration timestamp
// used        boolean   Whether code has been used
// createdAt   Date      Creation timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("email_verifications")
@Index(["userUid", "email"]) // For quick lookup when invalidating old codes
export class EmailVerification {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  userUid: string;

  @Column()
  email: string;

  @Column()
  code: string; // Store as lowercase for case-insensitive comparison

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  expiresAt: Date;

  @Column({ type: "boolean", default: false })
  used: boolean; // Mark as used after successful verification

  @CreateDateColumn({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  createdAt: Date;
}
