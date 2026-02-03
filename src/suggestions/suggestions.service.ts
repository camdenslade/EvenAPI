//********************************************************************
//
// SuggestionsService
//
// Persists user suggestions submitted via public form.
//
//********************************************************************

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Suggestion } from "./entities/suggestion.entity";

@Injectable()
export class SuggestionsService {
  constructor(
    @InjectRepository(Suggestion)
    private readonly suggestionRepo: Repository<Suggestion>,
  ) {}

  async createSuggestion(data: {
    name: string;
    email: string;
    category: string;
    subject: string;
    suggestion: string;
  }) {
    const record = this.suggestionRepo.create({
      ...data,
      status: "new",
    });
    const saved = await this.suggestionRepo.save(record);
    return { success: true, suggestionId: saved.id };
  }
}
