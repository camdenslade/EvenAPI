//********************************************************************
//
// SupportController
//
// Public endpoint to submit support tickets.
//
//********************************************************************

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { SupportService } from "./support.service";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { Public } from "../auth/decorators/public.decorator";
import { SupportRateLimitGuard } from "../common/guards/rate-limit.guard";
import { SanitizeUtil } from "../common/utils/sanitize.util";

@Controller("support")
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Public()
  @UseGuards(SupportRateLimitGuard)
  @HttpCode(HttpStatus.CREATED)
  async createTicket(@Body() dto: CreateTicketDto) {
    const sanitized = {
      name: SanitizeUtil.sanitizeInput(dto.name),
      email: SanitizeUtil.sanitizeInput(dto.email),
      category: dto.category,
      priority: dto.priority,
      subject: SanitizeUtil.sanitizeInput(dto.subject),
      description: SanitizeUtil.sanitizeInput(dto.description),
    };

    if (!SanitizeUtil.isValidEmail(sanitized.email)) {
      throw new BadRequestException("Invalid email format");
    }
    if (!SanitizeUtil.isValidName(sanitized.name)) {
      throw new BadRequestException("Invalid name format");
    }
    if (SanitizeUtil.containsSpamPatterns(sanitized.description)) {
      throw new BadRequestException("Message contains spam patterns");
    }

    return this.supportService.createTicket(sanitized);
  }
}
