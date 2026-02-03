//********************************************************************
//
// Like Entity Class
//
// Represents a hard user action: "I like this person." Includes
// expiration timestamp (30-day TTL), hiddenUntil for queue suppression
// window, and isHidden flag for manual hiding. Rules enforced in service
// logic: when liking, expiresAt = now + 30 days, hiddenUntil = now + 30
// days (unless mutual), and only one active like per pair.
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
// id          string      Primary key UUID
// swiperUid   string      Firebase UID of user performing the like
// targetUid   string      Firebase UID of user being liked
// liked       boolean     Always true in Even (explicit pass does not exist)
// createdAt   Date        When the like was created
// expiresAt   Date        Expiration timestamp (30 days from creation)
// hiddenUntil Date|null   Queue suppression window expiration
// isHidden    boolean     Manual hiding flag for future features
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("likes")
export class Like {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  swiperUid: string;

  @Column()
  targetUid: string;

  @Column({ default: true })
  liked: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: false,
  })
  expiresAt: Date;

  @Column({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
    nullable: true,
  })
  hiddenUntil: Date | null;

  @Column({ default: false })
  isHidden: boolean;
}
