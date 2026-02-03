//********************************************************************
//
// Admin Entity
//
// Stores admin users (Firebase UID + email) for admin access control.
//
//********************************************************************

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("admins")
export class Admin {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  uid: string;

  @Column({ unique: true })
  email: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @Column({ name: "created_by_uid", nullable: true, type: "varchar" })
  createdByUid: string | null;
}
