//********************************************************************
//
// ProfilePhoto Entity Class
//
// Stores moderation status and metadata for each uploaded profile photo.
// Tracks photo moderation lifecycle: pending → approved/rejected/flagged.
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
// id          string              Primary key UUID
// userId      string              Firebase UID (foreign key to User)
// url         string              S3 key or photo URL
// status      PhotoStatus         Moderation status
// reason      string|null         Rejection/flag reason
// confidence  number|null        Moderation confidence score
// createdAt   Date                Photo upload timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export type PhotoStatus = "pending" | "approved" | "rejected" | "flagged";

@Entity("profile_photos")
@Index(["userId", "status"])
@Index(["status", "createdAt"])
export class ProfilePhoto {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  @Index()
  userId: string; // Firebase UID

  @Column({ type: "text" })
  url: string; // Derived (cropped) S3 key used in profile.photos

  // Original, uncropped upload S3 key
  @Column({ type: "text", nullable: true })
  originalKey: string | null;

  // Explicit derived key (matches url for legacy rows)
  @Column({ type: "text", nullable: true })
  derivedKey: string | null;

  // Stored crop metadata (origin/size on original image)
  // Use jsonb in Postgres; fall back to simple-json in SQLite tests
  @Column({
    type: process.env.NODE_ENV === "test" ? "simple-json" : "jsonb",
    nullable: true,
  })
  crop: Record<string, unknown> | null;

  @Column({
    type: "varchar",
    default: "pending",
  })
  status: PhotoStatus;

  @Column({ type: "text", nullable: true })
  reason: string | null;

  @Column({ type: "float", nullable: true })
  confidence: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
