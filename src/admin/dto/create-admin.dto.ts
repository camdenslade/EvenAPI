//********************************************************************
//
// CreateAdminDto
//
// Validation for creating an admin record.
//
//********************************************************************

import { IsEmail, IsString } from "class-validator";

export class CreateAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  uid: string;
}
