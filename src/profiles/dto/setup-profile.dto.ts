//********************************************************************
//
// SetupProfileDto Class
//
// Data Transfer Object for profile setup during onboarding. Ensures
// all critical fields are validated before profile creation. Used in
// POST /profiles/setup endpoint.
//
// Return Value
// ------------
// None (NestJS DTO class)
//
// Value Parameters
// ----------------
// name              string                    User's name
// birthday          BirthdayDto                Birthday object with year, month, day
// bio               string                    User's bio text
// sex               "male"|"female"           User's biological sex
// sexPreference     "male"|"female"|"everyone" Who user is interested in
// datingPreference  DatingPreference          Type of relationship sought
// interests         string[]                  Array of interest strings
// photos            string[]                  Array of photo URLs
// height            HeightDto                  Height object with feet, inches
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// None
//
//*******************************************************************

import {
  IsString,
  IsArray,
  IsIn,
  IsOptional,
  IsNumber,
  IsBoolean,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";

//********************************************************************
//
// BirthdayDto Class
//
// Data Transfer Object for birthday date components.
//
//*******************************************************************
export class BirthdayDto {
  @IsNumber()
  @Min(1900)
  @Max(new Date().getFullYear())
  year: number;

  @IsNumber()
  @Min(0)
  @Max(11)
  month: number;

  @IsNumber()
  @Min(1)
  @Max(31)
  day: number;
}

//********************************************************************
//
// HeightDto Class
//
// Data Transfer Object for height components.
//
//*******************************************************************
export class HeightDto {
  @IsNumber()
  @Min(4)
  @Max(7)
  feet: number;

  @IsNumber()
  @Min(0)
  @Max(11)
  inches: number;
}

export class SetupProfileDto {
  @IsString()
  name: string;

  @ValidateNested()
  @Type(() => BirthdayDto)
  birthday: BirthdayDto;

  @IsString()
  bio: string;

  @IsIn(["male", "female"])
  sex: "male" | "female";

  @IsIn(["male", "female", "everyone"])
  sexPreference: "male" | "female" | "everyone";

  @IsIn([
    "hookups",
    "situationship",
    "short_term_relationship",
    "short_term_open",
    "long_term_open",
    "long_term_relationship",
  ])
  datingPreference:
    | "hookups"
    | "situationship"
    | "short_term_relationship"
    | "short_term_open"
    | "long_term_open"
    | "long_term_relationship";

  @IsArray()
  interests: string[];

  @IsArray()
  photos: string[];

  // Original uncropped photos aligned with photos (fallback to photos when not provided)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoOriginals?: string[];

  @ValidateNested()
  @Type(() => HeightDto)
  height: HeightDto;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: "Race must have at least one value" })
  @ArrayMaxSize(2, { message: "Race can have at most two values" })
  race: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1, { message: "Religion can only have one value" })
  religion?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1, { message: "Politics can only have one value" })
  politics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1, { message: "Education can only have one value" })
  education?: string[];

  @IsOptional()
  @IsString()
  activityLevel?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1, { message: "Drinking can only have one value" })
  drinking?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1, { message: "Smoking can only have one value" })
  smoking?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1, { message: "Marijuana can only have one value" })
  marijuana?: string[];

  @IsOptional()
  @IsNumber()
  prefMinAge?: number;

  @IsOptional()
  @IsNumber()
  prefMaxAge?: number;

  @IsOptional()
  @IsNumber()
  prefMinDistanceMiles?: number;

  @IsOptional()
  @IsNumber()
  prefMaxDistanceMiles?: number;

  @IsOptional()
  @IsBoolean()
  showOutsideRange?: boolean;

  @IsOptional()
  @IsBoolean()
  expandAge?: boolean;

  @IsOptional()
  @IsBoolean()
  expandDistance?: boolean;

  @IsOptional()
  @IsBoolean()
  expandHeight?: boolean;
}
