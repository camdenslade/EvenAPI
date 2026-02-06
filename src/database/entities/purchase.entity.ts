//********************************************************************
//
// Purchase Entity Class
//
// Tracks in-app purchase transactions from Apple App Store and Google
// Play Store. Stores receipt data for validation and supports both
// consumable and subscription purchase types.
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
// userId                string              User ID (foreign key to User)
// user                  User                 User relation
// platform              PurchasePlatform    Platform (ios, android)
// store                 PurchaseStore       Store ('apple' | 'google')
// productId             string              Store product SKU
// transactionId         string              Store transaction ID
// originalTransactionId string|null         Original transaction ID (Apple subscriptions)
// storePurchaseIdentifier string|null       Store-scoped stable purchase identifier (indexed)
//                                                      Apple: original_transaction_id
//                                                      Google: purchaseToken or obfuscatedAccountId
// phoneHashDet          string|null         Deterministic phone hash for cross-account restore
// receipt               string              Protected receipt data (encrypted or hashed)
// purchaseType          PurchaseType        Type (consumable, subscription)
// status                PurchaseStatus      Verification status
// expiresAt             Date|null           Subscription expiration (null for consumables)
// deletedAt             Date|null           Soft delete timestamp (null if active)
// createdAt             Date                 Purchase creation timestamp
// verifiedAt            Date|null           Receipt verification timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
  Index,
} from "typeorm";

import { User } from "./user.entity";

export type PurchasePlatform = "ios" | "android";
export type PurchaseStore = "apple" | "google";
export type PurchaseType = "consumable" | "subscription";
export type PurchaseStatus = "pending" | "verified" | "failed";

@Entity("purchases")
@Index(["userId", "status"])
@Index(["userId", "purchaseType"])
@Index(["transactionId", "platform"])
@Index(["store", "storePurchaseIdentifier"]) // For purchase restoration by store account
@Index(["phoneHashDet"]) // For purchase restoration by phone number
export class Purchase {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "userId" })
  user: User;

  @Column({ type: "varchar" })
  platform: PurchasePlatform;

  @Column({ type: "varchar" })
  store: PurchaseStore;

  @Column({ type: "varchar" })
  productId: string;

  @Column({ type: "varchar" })
  transactionId: string;

  @Column({ type: "varchar", nullable: true })
  originalTransactionId: string | null;

  @Column({ type: "varchar", nullable: true })
  storePurchaseIdentifier: string | null;

  @Column({ type: "varchar", nullable: true })
  phoneHashDet: string | null;

  @Column({ type: "text" })
  receipt: string;

  @Column({ type: "varchar" })
  purchaseType: PurchaseType;

  @Column({ type: "varchar" })
  status: PurchaseStatus;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  expiresAt: Date | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  deletedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  verifiedAt: Date | null;
}
