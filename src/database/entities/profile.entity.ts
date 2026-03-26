//********************************************************************
//
// Profile Entity Class
//
// Stores all user-visible profile metadata. Connected 1:1 with User
// via userUid. Includes identity (name, birthday, bio), preferences
// (sex, sexPreference, datingPreference), assets (photos, interests),
// and onboarding status (paused flag).
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
// userUid           string              Firebase UID (foreign key to User)
// user              User                User relation
// name              string              User's display name
// birthday          string              Birthday date string
// bio               string              User's bio text
// sex               "male"|"female"     User's biological sex
// sexPreference     SexPreference       Who user is interested in
// datingPreference  DatingPreference    Type of relationship sought
// interests         string[]            Array of interest strings
// photos            string[]            Array of photo URLs
// paused            boolean             Whether profile is hidden from discovery
// createdAt         Date                Profile creation timestamp
// updatedAt         Date                Profile last update timestamp
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

import { User } from "./user.entity";

@Entity("profiles")
export class Profile {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  userUid: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "userUid", referencedColumnName: "uid" })
  user: User;

  @Column()
  name: string;

  @Column({ type: "date" })
  birthday: Date;

  @Column()
  bio: string;

  @Column({ type: "varchar" })
  sex: "male" | "female";

  @Column({ type: "varchar" })
  sexPreference: "male" | "female" | "everyone";

  @Column({ type: "varchar" })
  datingPreference:
    | "hookups"
    | "situationship"
    | "short_term_relationship"
    | "short_term_open"
    | "long_term_open"
    | "long_term_relationship";

  @Column("text", { array: true })
  interests: string[];

  @Column("text", { array: true })
  photos: string[];

  // Original (uncropped) photo keys, aligned by index with photos.
  // Defaults to the same values as photos for legacy data.
  @Column("text", { array: true, nullable: true })
  photoOriginals: string[] | null;

  @Column({ type: "boolean", default: false })
  paused: boolean;

  @Column("text", { array: true })
  height: string[];

  @Column("text", { array: true })
  race: string[];

  @Column("text", { array: true, nullable: true })
  religion: string[] | null;

  @Column("text", { array: true, nullable: true })
  politics: string[] | null;

  @Column("text", { array: true, nullable: true })
  education: string[] | null;

  @Column({ type: "varchar", nullable: true })
  activityLevel: string | null;

  @Column("text", { array: true, nullable: true })
  drinking: string[] | null;

  @Column("text", { array: true, nullable: true })
  smoking: string[] | null;

  @Column("text", { array: true, nullable: true })
  marijuana: string[] | null;

  @Column({ type: "int", default: 18 })
  prefMinAge: number;

  @Column({ type: "int", default: 60 })
  prefMaxAge: number;

  @Column({ type: "int", default: 1 })
  prefMinDistanceMiles: number;

  @Column({ type: "int", default: 50 })
  prefMaxDistanceMiles: number;

  @Column({ type: "boolean", default: false })
  showOutsideRange: boolean;

  // Per-dimension expansion flags (relax filters when queue is empty)
  @Column({ type: "boolean", default: false })
  expandAge: boolean;

  @Column({ type: "boolean", default: false })
  expandDistance: boolean;

  @Column({ type: "boolean", default: false })
  expandHeight: boolean;

  // Discovery filter preferences (what user wants to filter by, not their own details)
  @Column({ type: "int", nullable: true })
  prefMinHeight: number | null; // Minimum height in inches (e.g., 60 = 5'0")

  @Column({ type: "int", nullable: true })
  prefMaxHeight: number | null; // Maximum height in inches (e.g., 72 = 6'0")

  @Column("text", { array: true, nullable: true })
  prefRace: string[] | null;

  @Column("text", { array: true, nullable: true })
  prefReligion: string[] | null;

  @Column("text", { array: true, nullable: true })
  prefPolitics: string[] | null;

  @Column("text", { array: true, nullable: true })
  prefEducation: string[] | null;

  @Column({ type: "varchar", nullable: true })
  prefActivityLevel: string | null;

  @Column("text", { array: true, nullable: true })
  prefDrinking: string[] | null;

  @Column("text", { array: true, nullable: true })
  prefSmoking: string[] | null;

  @Column("text", { array: true, nullable: true })
  prefMarijuana: string[] | null;

  @Column({ type: "varchar", nullable: true })
  school: string | null;

  @Column({ type: "int", nullable: true })
  gradYear: number | null;

  @Column({ type: "varchar", nullable: true })
  major: string | null;

  @Column({ type: "boolean", nullable: true, default: false })
  showSchoolInfo: boolean | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  deletedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
