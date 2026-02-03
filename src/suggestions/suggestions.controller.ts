//********************************************************************
//
// SuggestionsController
//
// Public endpoint to submit product suggestions.
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
import { SuggestionsService } from "./suggestions.service";
import { CreateSuggestionDto } from "./dto/create-suggestion.dto";
import { Public } from "../auth/decorators/public.decorator";
import { SuggestionsRateLimitGuard } from "../common/guards/rate-limit.guard";
import { SanitizeUtil } from "../common/utils/sanitize.util";

@Controller("suggestions")
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  @Public()
  @UseGuards(SuggestionsRateLimitGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateSuggestionDto) {
    const sanitized = {
      name: SanitizeUtil.sanitizeInput(dto.name),
      email: SanitizeUtil.sanitizeInput(dto.email),
      category: dto.category,
      subject: SanitizeUtil.sanitizeInput(dto.subject),
      suggestion: SanitizeUtil.sanitizeInput(dto.suggestion),
    };

    if (!SanitizeUtil.isValidEmail(sanitized.email)) {
      throw new BadRequestException("Invalid email format");
    }
    if (!SanitizeUtil.isValidName(sanitized.name)) {
      throw new BadRequestException("Invalid name format");
    }
    if (SanitizeUtil.containsSpamPatterns(sanitized.suggestion)) {
      throw new BadRequestException("Suggestion contains spam patterns");
    }

    return this.suggestionsService.createSuggestion(sanitized);
  }
}
