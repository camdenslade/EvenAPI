//********************************************************************
//
// ProfilesController Class
//
// Controller for profile management endpoints. Handles profile setup,
// updates, deletion, photo management, location updates, pause/unpause,
// and swipe queue generation. All routes are protected by CognitoAuthGuard.
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
// profiles    ProfilesService    Injected profiles service
//
//*******************************************************************

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from "@nestjs/common";
import { IsNumber } from "class-validator";

import { ProfilesService } from "./profiles.service";

import { AuthUser } from "../auth/auth-user.decorator";

import { SetupProfileDto } from "./dto/setup-profile.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";

//********************************************************************
//
// UpdateLocationDto Class
//
// DTO for updating user location via profiles endpoint.
// Uses 'lat' and 'lng' to match frontend convention.
//
//*******************************************************************
class UpdateLocationDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}

@Controller("profiles")
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  //********************************************************************
  //
  // status Method
  //
  // GET /profiles/status endpoint. Returns whether the current user
  // has a completed profile.
  //
  // Return Value
  // ------------
  // Promise<{ status: string }>    Status object with "complete" or "missing"
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
  @Get("status")
  async status(@AuthUser() user: { uid: string }) {
    return this.profiles.checkStatus(user.uid);
  }

  //********************************************************************
  //
  // upload Method
  //
  // GET /profiles/upload-url endpoint. Returns a pair of S3 pre-signed URLs
  // for uploading the original and derived versions of a photo.
  //
  // Return Value
  // ------------
  // Promise<Object>    Object containing upload URLs/keys for original and derived
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
  // None
  //
  //*******************************************************************
  @Get("upload-url")
  async upload() {
    return this.profiles.createUploadUrl();
  }

  //********************************************************************
  //
  // derivedUpload Method
  //
  // GET /profiles/derived-upload-url endpoint. Returns a presigned URL
  // for uploading a derived (cropped) image, preserving the original key.
  //
  //********************************************************************
  @Get("derived-upload-url")
  async derivedUpload(@Query("originalKey") originalKey?: string) {
    return this.profiles.createDerivedUploadUrl(originalKey);
  }

  //********************************************************************
  //
  // setup Method
  //
  // POST /profiles/setup endpoint. Creates or updates the user's
  // onboarding profile.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Created or updated profile response
  //
  // Value Parameters
  // ----------------
  // user    Object            Authenticated Firebase user from decorator
  //   uid     string              Firebase UID
  // dto     SetupProfileDto   Profile setup data
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
  @Post("setup")
  async setup(@AuthUser() user: { uid: string }, @Body() dto: SetupProfileDto) {
    return this.profiles.setup(user.uid, dto);
  }

  //********************************************************************
  //
  // queue Method
  //
  // GET /profiles/queue endpoint. Returns a randomized queue of
  // profiles to swipe on.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse[]>    Array of profile responses with distance
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
  @Get("queue")
  async queue(@AuthUser() user: { uid: string }) {
    return this.profiles.getSwipeQueue(user.uid);
  }

  //********************************************************************
  //
  // me Method
  //
  // GET /profiles/me endpoint. Returns the authenticated user's profile.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse | null>    Profile response or null
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
  @Get("me")
  async me(@AuthUser() user: { uid: string }) {
    return this.profiles.getProfile(user.uid);
  }

  //********************************************************************
  //
  // updateProfile Method
  //
  // PATCH /profiles/me endpoint. Allows partial updates to the user's
  // profile. Invalid enum values are automatically stripped.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
  //
  // Value Parameters
  // ----------------
  // user    Object            Authenticated Firebase user from decorator
  //   uid     string              Firebase UID
  // body    UpdateProfileDto  Partial profile update data
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
  @Patch("me")
  async updateProfile(
    @AuthUser() user: { uid: string },
    @Body() body: UpdateProfileDto,
  ) {
    if (
      body.sexPreference &&
      !["male", "female", "everyone"].includes(body.sexPreference)
    ) {
      delete body.sexPreference;
    }

    if (
      body.datingPreference &&
      ![
        "hookups",
        "situationship",
        "short_term_relationship",
        "short_term_open",
        "long_term_open",
        "long_term_relationship",
      ].includes(body.datingPreference)
    ) {
      delete body.datingPreference;
    }

    return this.profiles.updateProfile(user.uid, body);
  }

  //********************************************************************
  //
  // deleteMe Method
  //
  // DELETE /profiles/me endpoint. Deletes the user's profile, photos,
  // and associated user account.
  //
  // Return Value
  // ------------
  // Promise<void>
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
  async deleteMe(@AuthUser() user: { uid: string }) {
    return this.profiles.deleteProfile(user.uid);
  }

  //********************************************************************
  //
  // updatePhotos Method
  //
  // PATCH /profiles/me/photos endpoint. Updates the user's photo array.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
  //
  // Value Parameters
  // ----------------
  // user    Object            Authenticated Firebase user from decorator
  //   uid     string              Firebase UID
  // body    Object            Request body
  //   photos   string[]            Array of photo URLs
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
  @Patch("me/photos")
  async updatePhotos(
    @AuthUser() user: { uid: string },
    @Body() body: { photos: string[] },
  ) {
    return this.profiles.updatePhotos(user.uid, body.photos);
  }

  //********************************************************************
  //
  // deletePhoto Method
  //
  // DELETE /profiles/me/photo/:index endpoint. Deletes a photo at a
  // specific index from the user's profile.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
  // index   string    Photo index from route parameter
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
  @Delete("me/photo/:index")
  async deletePhoto(
    @AuthUser() user: { uid: string },
    @Param("index") index: string,
  ) {
    return this.profiles.deletePhotoByIndex(user.uid, Number(index));
  }

  //********************************************************************
  //
  // getPublic Method
  //
  // GET /profiles/:uid endpoint. Retrieves a public profile by Firebase UID.
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Profile response
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID from route parameter
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
  @Get(":uid")
  async getPublic(@Param("uid") uid: string) {
    return this.profiles.getPublicProfile(uid);
  }

  //********************************************************************
  //
  // pause Method
  //
  // PATCH /profiles/me/pause endpoint. Pauses the user's profile
  // (hides it from discovery).
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
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
  @Patch("me/pause")
  async pause(@AuthUser() user: { uid: string }) {
    return this.profiles.pauseProfile(user.uid);
  }

  //********************************************************************
  //
  // unpause Method
  //
  // PATCH /profiles/me/unpause endpoint. Unpauses the user's profile
  // (makes it visible in discovery again).
  //
  // Return Value
  // ------------
  // Promise<ProfileResponse>    Updated profile response
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
  @Patch("me/unpause")
  async unpause(@AuthUser() user: { uid: string }) {
    return this.profiles.unpauseProfile(user.uid);
  }

  //********************************************************************
  //
  // updateLocation Method
  //
  // PATCH /profiles/update-location endpoint. Updates the user's
  // location coordinates. Delegates to UsersService.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
  // lat     number    Latitude from request body
  // lng     number    Longitude from request body
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
  @Patch("update-location")
  async updateLocation(
    @AuthUser() user: { uid: string },
    @Body() body: UpdateLocationDto,
  ) {
    return this.profiles.updateLocation(user.uid, body.lat, body.lng);
  }

  //********************************************************************
  //
  // getPhotoStatuses Method
  //
  // GET /profiles/me/photo-statuses endpoint. Returns moderation status
  // for all user's photos.
  //
  // Return Value
  // ------------
  // Promise<ProfilePhoto[]>    Array of photo statuses
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
  //
  //*******************************************************************
  @Get("me/photo-statuses")
  async getPhotoStatuses(@AuthUser() user: { uid: string }) {
    return this.profiles.getPhotoStatuses(user.uid);
  }
}
