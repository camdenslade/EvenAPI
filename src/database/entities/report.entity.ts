//********************************************************************
//
// Report Entity Class
//
// Represents a user report or content report. Used for moderation and
// safety enforcement. Reports are persisted indefinitely and are not
// deleted when users are deleted. No foreign keys to user tables
// (users may be deleted, but reports must persist).
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
// id              string      Primary key UUID
// reporterUid     string      Firebase UID of user who made the report (indexed)
// targetUid       string|null Firebase UID of reported user (nullable, indexed)
// contentId       string|null Content identifier for content reports (nullable)
// contentType     string      Type of content ('message' | 'photo' | 'profile' | 'other')
// reason          string|null Optional reason text provided by reporter
// status          string      Report status ('pending' | 'reviewed' | 'resolved')
// createdAt       Date        Report creation timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export type ReportContentType = "message" | "photo" | "profile" | "other";
export type ReportStatus = "pending" | "reviewed" | "resolved";

@Entity("reports")
@Index("IDX_reports_reporter", ["reporterUid"])
@Index("IDX_reports_target", ["targetUid"])
@Index("IDX_reports_content", ["contentType", "contentId"])
@Index("IDX_reports_status", ["status"])
export class Report {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  reporterUid: string;

  @Column({ type: "varchar", nullable: true })
  targetUid: string | null;

  @Column({ type: "varchar", nullable: true })
  contentId: string | null;

  @Column({ type: "varchar" })
  contentType: ReportContentType;

  @Column({ type: "text", nullable: true })
  reason: string | null;

  @Column({ type: "varchar", default: "pending" })
  status: ReportStatus;

  @Column({ type: "varchar", nullable: true })
  assignedTo: string | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "simple-json" : "jsonb",
    nullable: true,
  })
  evidence: Record<string, unknown> | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
