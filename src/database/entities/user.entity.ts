//********************************************************************
//
// User Entity Class
//
// Core identity model for the app. Represents an authenticated Firebase
// user. Stores email (synced on each login), location coordinates and
// last update time, review timeout for moderation, and messages sent
// by this user. Phone numbers are NOT stored here - only hashed in
// SafetyIdentity for fraud prevention.
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
// id                      string              Primary key UUID
// uid                     string              Firebase UID (unique)
// email                   string|null         User's email address
// latitude                number|null         Location latitude
// longitude               number|null         Location longitude
// lastLocationUpdate      Date|null           Last location update timestamp
// reviewTimeoutExpiresAt  Date|null           Review timeout expiration timestamp
// pushToken               string|null         Expo push notification token
// notificationsEnabled    boolean             Whether user opted in to push notifications
// subscriptionExpiresAt   Date|null           Subscription expiration timestamp
// lastBaselineGrantAt      Date|null           Last monthly baseline grant timestamp
// safetyIdentityId         string|null         Safety identity ID (foreign key)
// safetyIdentity           SafetyIdentity|null  Safety identity relation
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";

import { SafetyIdentity } from "./safety-identity.entity";

export type ThemeColors = {
  background: string;
  card: string;
  text: string;
  subtitle: string;
  accent: string;
  circle: string;
  shapeRect: string;
  textSecondary: string;
  buttonText: string;
  overlay: string;
  border: string;
  bottomButton: string;
  bottomButtonIcon: string;
};

export type ThemePreset = {
  id: string;
  name: string;
  favorite?: boolean;
  colors: ThemeColors;
};

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  uid: string;

  @Column({ type: "varchar", nullable: true })
  email: string | null;

  @Column({ type: "varchar", unique: true, nullable: true })
  cognitoSub: string | null;

  @Column({ type: "varchar", unique: true, nullable: true })
  appleSub: string | null;

  @Column({ type: "varchar", unique: true, nullable: true })
  phoneHashDet: string | null;

  @Column({ type: "text", nullable: true })
  phoneE164Encrypted: string | null;

  @Column({ type: "float", nullable: true })
  latitude: number | null;

  @Column({ type: "float", nullable: true })
  longitude: number | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  lastLocationUpdate: Date | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  reviewTimeoutExpiresAt: Date | null;

  @Column({ type: "boolean", default: false })
  isSubscribed: boolean;

  @Column({ type: "int", default: 0 })
  searchTokens: number;

  @Column({ type: "int", default: 0 })
  messageTokens: number;

  @Column({ type: "int", default: 0 })
  undoTokens: number;

  @Column({ type: "varchar", nullable: true })
  pushToken: string | null;

  @Column({ type: "boolean", default: true })
  notificationsEnabled: boolean;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  subscriptionExpiresAt: Date | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  lastBaselineGrantAt: Date | null;

  @Column({ nullable: true })
  safetyIdentityId: string | null;

  @ManyToOne(() => SafetyIdentity, { nullable: true })
  @JoinColumn({ name: "safetyIdentityId" })
  safetyIdentity: SafetyIdentity | null;

  @Column({ type: "boolean", default: false })
  schoolEmailVerified: boolean;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  schoolEmailVerifiedAt: Date | null;

  @Column({ type: "boolean", default: false })
  banned: boolean;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  bannedAt: Date | null;

  @Column({ type: "text", nullable: true })
  banReason: string | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  deletedAt: Date | null;

  @Column({ type: "text", nullable: true })
  deletedReason: string | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "simple-json" : "jsonb",
    nullable: true,
  })
  themePresets: ThemePreset[] | null;
}
