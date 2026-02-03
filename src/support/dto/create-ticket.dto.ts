//********************************************************************
//
// CreateTicketDto
//
// Validation for support ticket submissions.
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
  "account",
  "technical",
  "billing",
  "safety",
  "feature",
  "other",
] as const;

const PRIORITY_VALUES = ["low", "medium", "high"] as const;

export class CreateTicketDto {
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

  @IsEnum(PRIORITY_VALUES)
  priority: (typeof PRIORITY_VALUES)[number];

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  description: string;
}
