//********************************************************************
//
// Review Entity Class
//
// Stores a single user review (normal, emergency, or report). Includes
// moderation metadata for keyword scanning, LLM analysis, human review
// flow, and strike issuance. Unique constraint: a user may only review
// another user once.
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
// id                    string              Primary key UUID
// reviewerUid           string              Firebase UID of reviewer (indexed)
// targetUid             string              Firebase UID of target (indexed)
// rating                number              Review rating (1-10)
// comment               string              Review comment text
// type                  ReviewType          Review type (normal, emergency, report)
// phoneNumberUsed       string|null         Phone number snapshot for emergency reviews
// flaggedByKeywordScan  boolean             Whether flagged by keyword scan
// flaggedByLLM          boolean             Whether flagged by LLM analysis
// pendingHumanReview    boolean             Whether pending human review
// approved              boolean             Whether approved by moderation
// rejected              boolean             Whether rejected by moderation
// strikeIssued          boolean             Whether a strike was issued
// createdAt             Date                Review creation timestamp
// reviewer              User                Reviewer user relation
// target                User                Target user relation
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Unique,
  Index,
} from "typeorm";

import { User } from "./user.entity";

const photosColumnOptions =
  process.env.NODE_ENV === "test"
    ? ({ type: "simple-array", default: "" } as const)
    : ({ type: "text", array: true, default: () => "'{}'" } as const);

@Entity("reviews")
@Unique(["reviewerUid", "targetUid"])
export class Review {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ type: "varchar" })
  reviewerUid: string;

  @Index()
  @Column({ type: "varchar" })
  targetUid: string;

  @Column({ type: "int" })
  rating: number;

  @Column({ type: "text" })
  comment: string;

  @Column({ type: "varchar" })
  type: "normal" | "emergency" | "report";

  @Column({ type: "varchar", nullable: true })
  phoneNumberUsed: string | null;

  @Column({ type: "varchar", nullable: true })
  reportCategory: string | null;

  @Column(photosColumnOptions)
  photos: string[];

  @Column({ type: "boolean", default: false })
  flaggedByKeywordScan: boolean;

  @Column({ type: "boolean", default: false })
  flaggedByLLM: boolean;

  @Column({ type: "boolean", default: false })
  pendingHumanReview: boolean;

  @Column({ type: "boolean", default: false })
  approved: boolean;

  @Column({ type: "boolean", default: false })
  rejected: boolean;

  @Column({ type: "boolean", default: false })
  strikeIssued: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.id, { eager: false })
  reviewer: User;

  @ManyToOne(() => User, (user) => user.id, { eager: false })
  target: User;
}
