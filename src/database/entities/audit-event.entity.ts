//********************************************************************
//
// AuditEvent Entity
//
// Append-only audit log for security/privacy events (e.g., DSAR deletes,
// role changes, purchase/token changes). Stores event name, sanitized
// payload, and timestamp. Intended for immutable audit trails.
//
//*******************************************************************

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity("audit_events")
export class AuditEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar" })
  event: string;

  @Column({
    type: "simple-json",
    nullable: true,
  })
  payload: Record<string, unknown> | null;

  @CreateDateColumn({
    type: process.env.NODE_ENV === "test" ? "datetime" : "timestamptz",
  })
  createdAt: Date;
}
