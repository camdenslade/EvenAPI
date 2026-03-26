//********************************************************************
//
// UpdateProfileDto Class
//
// Data Transfer Object for partial profile updates. Allows optional
// updates to any profile field. All fields are validated only if present.
// Used in PATCH /profiles/me endpoint.
//
// Return Value
// ------------
// None (NestJS DTO class)
//
// Value Parameters
// ----------------
// name              string|undefined                    User's name
// birthday          BirthdayDto|undefined               Birthday object with year, month, day
// bio               string|undefined                    User's bio text
// sex               "male"|"female"|undefined           User's biological sex
// sexPreference     "male"|"female"|"everyone"|undefined Who user is interested in
// datingPreference  DatingPreference|undefined          Type of relationship sought
// interests         string[]|undefined                  Array of interest strings
// photos            string[]|undefined                  Array of photo URLs
// height            HeightDto|undefined                  Height object with feet, inches
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
  IsOptional,
  IsArray,
  IsIn,
  IsNumber,
  IsBoolean,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  ValidateIf,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";

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

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsIn(["male", "female", "everyone"])
  sexPreference?: "male" | "female" | "everyone";

  @IsOptional()
  @IsIn([
    "hookups",
    "situationship",
    "short_term_relationship",
    "short_term_open",
    "long_term_open",
    "long_term_relationship",
  ])
  datingPreference?:
    | "hookups"
    | "situationship"
    | "short_term_relationship"
    | "short_term_open"
    | "long_term_open"
    | "long_term_relationship";

  @IsOptional()
  @IsArray()
  interests?: string[];

  @IsOptional()
  @IsArray()
  photos?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoOriginals?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => HeightDto)
  height?: HeightDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1, { message: "Race must have at least one value" })
  @ArrayMaxSize(2, { message: "Race can have at most two values" })
  race?: string[];

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

  @IsOptional()
  @IsString()
  @ValidateIf((_, value) => value !== null)
  school?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Type(() => Number)
  gradYear?: number | null;

  @IsOptional()
  @IsString()
  @ValidateIf((_, value) => value !== null)
  major?: string | null;

  @IsOptional()
  @IsBoolean()
  showSchoolInfo?: boolean;

  // Discovery filter preferences (what user wants to filter by)
  @IsOptional()
  @IsNumber()
  @Min(48) // 4'0"
  @Max(84) // 7'0"
  prefMinHeight?: number; // Minimum height in inches

  @IsOptional()
  @IsNumber()
  @Min(48) // 4'0"
  @Max(84) // 7'0"
  prefMaxHeight?: number; // Maximum height in inches

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefRace?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefReligion?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefPolitics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefEducation?: string[];

  @IsOptional()
  @IsString()
  prefActivityLevel?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefDrinking?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefSmoking?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prefMarijuana?: string[];
}
