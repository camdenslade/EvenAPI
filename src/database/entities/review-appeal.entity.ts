//********************************************************************
//
// ReviewAppeal Entity Class
//
// Tracks appeals submitted by users who are the subject of a review.
// Allows the review target to provide written explanation and photos.
// Admin resolves appeals by approving or rejecting them. Approval
// causes the original review to be marked as rejected.
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
// id                string                  Primary key UUID
// reviewId          string                  FK to reviews.id
// appellantUserId   string                  FK to users.id (the review subject)
// text              string|null             Written explanation from appellant
// photoUrls         string[]                Array of supporting photo URLs
// status            ReviewAppealStatus      Current status of the appeal
// adminNote         string|null             Admin's note when resolving
// createdAt         Date                    Appeal creation timestamp
// updatedAt         Date                    Appeal last update timestamp
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

export type ReviewAppealStatus = "pending" | "approved" | "rejected";

const photoUrlsColumnOptions =
  process.env.NODE_ENV === "test"
    ? ({ type: "simple-array", default: "" } as const)
    : ({ type: "text", array: true, default: () => "'{}'" } as const);

@Entity("review_appeals")
@Index(["reviewId"])
@Index(["appellantUserId"])
@Index(["status"])
export class ReviewAppeal {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar" })
  reviewId: string;

  @Column({ type: "varchar" })
  appellantUserId: string;

  @Column({ type: "text", nullable: true })
  text: string | null;

  @Column(photoUrlsColumnOptions)
  photoUrls: string[];

  @Column({ type: "varchar", default: "pending" })
  status: ReviewAppealStatus;

  @Column({ type: "text", nullable: true })
  adminNote: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
