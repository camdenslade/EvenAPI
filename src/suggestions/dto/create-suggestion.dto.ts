//********************************************************************
//
// CreateSuggestionDto
//
// Validation for suggestion submissions.
//
//********************************************************************

import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

const CATEGORY_VALUES = [
  "feature",
  "improvement",
  "bug",
  "ui",
  "rating",
  "safety",
  "other",
] as const;

export class CreateSuggestionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsEnum(CATEGORY_VALUES)
  category: (typeof CATEGORY_VALUES)[number];

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  suggestion: string;
}
