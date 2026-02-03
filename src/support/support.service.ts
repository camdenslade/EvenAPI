//********************************************************************
//
// SupportService
//
// Persists support tickets submitted via public form.
//
//********************************************************************

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SupportTicket } from "./entities/support-ticket.entity";

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
  ) {}

  async createTicket(data: {
    name: string;
    email: string;
    category: string;
    priority: "low" | "medium" | "high";
    subject: string;
    description: string;
  }) {
    const ticket = this.ticketRepo.create({
      ...data,
      status: "open",
    });
    const saved = await this.ticketRepo.save(ticket);

    return { success: true, ticketId: saved.id };
  }
}
