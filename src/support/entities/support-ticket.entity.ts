//********************************************************************
//
// SupportTicket Entity
//
// Stores public support submissions.
//
//********************************************************************

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("support_tickets")
export class SupportTicket {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column()
  category: string;

  @Column()
  priority: "low" | "medium" | "high";

  @Column()
  subject: string;

  @Column({ type: "text" })
  description: string;

  @Column({ default: "open" })
  status: "open" | "in_progress" | "closed";

  @CreateDateColumn()
  createdAt: Date;
}
