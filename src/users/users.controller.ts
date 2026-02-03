//********************************************************************
//
// UsersController Class
//
// Controller for user account management endpoints. Handles user creation
// and sync, location updates, and full account deletion with safety
// identity persistence.
//
// Return Value
// ------------
// None (NestJS controller class)
//
// Value Parameters
// ----------------
// None
//
// Reference Parameters
// --------------------
// None
//
// Local Variables
// ---------------
// usersService    UsersService    Injected users service
//
//*******************************************************************

import { Controller, Get, Post, Delete, Body } from "@nestjs/common";

import { AuthUser } from "../auth/auth-user.decorator";
import { UsersService } from "./users.service";
import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
} from "class-validator";

//********************************************************************
//
// UpdateLocationDto Class
//
// DTO for updating user geolocation.
//
// Value Parameters
// ----------------
// latitude    number    Latitude coordinate
// longitude   number    Longitude coordinate
//
//*******************************************************************
class UpdateLocationDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;
}

class PushTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

class SoftDeleteDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

class UpdateThemePresetsDto {
  @IsArray()
  presets: unknown[];
}

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  //********************************************************************
  //
  // getMe Method
  //
  // GET /users/me endpoint. Ensures the user exists in the database
  // and returns their record. Syncs email with Firebase authentication
  // data. Phone numbers are NEVER returned - only hashed in SafetyIdentity.
  //
  // Return Value
  // ------------
  // Promise<User>    User entity
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
  //   email   string|null   User's email
  //   phone   string|null   User's phone number (used only for SafetyIdentity hashing, NOT returned)
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
  @Get("me")
  async getMe(
    @AuthUser()
    user: {
      uid: string;
      email: string | null;
      phone: string | null;
    },
  ) {
    const userEntity = await this.usersService.ensureUserExists(
      user.uid,
      user.email,
      user.phone,
    );
    // Return DTO without phone number - phone is never exposed in API responses
    return this.usersService.toResponseDto(userEntity);
  }

  //********************************************************************
  //
  // updateLocation Method
  //
  // POST /users/update-location endpoint. Updates the authenticated
  // user's location and timestamps the change.
  //
  // Return Value
  // ------------
  // Promise<Object>    Success response with location data
  //
  // Value Parameters
  // ----------------
  // user    Object            Authenticated Firebase user from decorator
  //   uid     string              Firebase UID
  // body    UpdateLocationDto  Location update data
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
  @Post("update-location")
  async updateLocation(
    @AuthUser()
    user: { uid: string },
    @Body() body: UpdateLocationDto,
  ) {
    return this.usersService.updateLocation(
      user.uid,
      body.latitude,
      body.longitude,
    );
  }

  //********************************************************************
  //
  // deleteMe Method
  //
  // DELETE /users/me endpoint. Permanently deletes the authenticated
  // user's full account and all associated data (profile, photos,
  // messages, threads, matches, swipes, reviews, etc.). Additionally
  // persists SafetyIdentity metadata to prevent abuse resets and ban
  // evasion.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
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
  @Delete("me")
  async deleteMe(
    @AuthUser()
    user: {
      uid: string;
    },
  ) {
    await this.usersService.deleteUser(user.uid);
    return {
      success: true,
      warning:
        "Account permanently deleted. Tokens and purchases are removed and cannot be restored.",
    };
  }

  //********************************************************************
  //
  // updatePushToken Method
  //
  // POST /users/push-token endpoint. Updates the authenticated user's
  // push notification token.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
  //
  // Value Parameters
  // ----------------
  // user    Object          Authenticated Firebase user from decorator
  //   uid     string            Firebase UID
  // body    PushTokenDto    Push token data
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
  @Post("push-token")
  async updatePushToken(
    @AuthUser()
    user: {
      uid: string;
    },
    @Body() body: PushTokenDto,
  ) {
    await this.usersService.updatePushToken(user.uid, body.token);
    return { success: true };
  }

  @Get("theme-presets")
  async getThemePresets(
    @AuthUser()
    user: {
      uid: string;
    },
  ) {
    const presets = await this.usersService.getThemePresets(user.uid);
    return { presets };
  }

  @Post("theme-presets")
  async setThemePresets(
    @AuthUser()
    user: {
      uid: string;
    },
    @Body() body: UpdateThemePresetsDto,
  ) {
    const presets = await this.usersService.setThemePresets(
      user.uid,
      body.presets,
    );
    return { presets };
  }

  @Post("me/soft-delete")
  async softDelete(
    @AuthUser()
    user: {
      uid: string;
    },
    @Body() body: SoftDeleteDto,
  ) {
    await this.usersService.deleteUser(user.uid, {
      soft: true,
      reason: body?.reason ?? null,
    });
    return {
      success: true,
      message:
        "Account hidden and data cleared. Tokens and purchases remain linked to your login.",
    };
  }
}
