//********************************************************************
//
// TokenLedger Entity Class
//
// Tracks all token grants with source and expiration. Single source of
// truth for token entitlements. Supports baseline (monthly free),
// subscription (auto-renewing), and purchase (consumable) tokens.
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
// id            string              Primary key UUID
// userId        string              User ID (foreign key to User)
// user          User                User relation
// tokenType     TokenType           Type of token (undo, search, message_request)
// source        TokenSource         Source of token (baseline, subscription, purchase)
// quantity      number              Number of tokens granted (>0)
// expiresAt     Date|null           Expiration timestamp (null for consumables)
// purchaseId    string|null         Purchase ID (foreign key, null for baseline)
// purchase      Purchase|null       Purchase relation
// consumedAt   Date|null           Consumption timestamp (null if unused)
// createdAt     Date                Grant creation timestamp
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
import { Purchase } from "./purchase.entity";

export type TokenType = "undo" | "search" | "message_request";
export type TokenSource = "baseline" | "subscription" | "purchase";

@Entity("token_ledger")
@Index(["userId", "tokenType", "consumedAt"])
@Index(["userId", "expiresAt"])
export class TokenLedger {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "userId" })
  user: User | null;

  @Column({ type: "varchar" })
  tokenType: TokenType;

  @Column({ type: "varchar" })
  source: TokenSource;

  @Column({ type: "int" })
  quantity: number;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  expiresAt: Date | null;

  @Column({ nullable: true })
  purchaseId: string | null;

  @ManyToOne(() => Purchase, { nullable: true })
  @JoinColumn({ name: "purchaseId" })
  purchase: Purchase | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  consumedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
