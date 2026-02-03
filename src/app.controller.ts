//********************************************************************
//
// AppController Class
//
// Root application controller. Provides basic endpoints including
// GET /me to retrieve the authenticated user's profile. All routes
// are protected by the global CognitoAuthGuard.
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
// profilesService    ProfilesService    Injected profiles service
//
//*******************************************************************

import { Controller, Get } from "@nestjs/common";

import { ProfilesService } from "./profiles/profiles.service";

import { AuthUser } from "./auth/auth-user.decorator";

@Controller()
export class AppController {
  constructor(private readonly profilesService: ProfilesService) {}

  //********************************************************************
  //
  // me Method
  //
  // GET /me endpoint. Returns the authenticated user's profile.
  // Requires FirebaseAuthGuard (applied globally).
  //
  // Return Value
  // ------------
  // Promise<UserProfile>    User profile data
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
  //   email   string|null   User's email
  //   phone   string|null   User's phone number
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
  async me(
    @AuthUser()
    user: {
      uid: string;
      email: string | null;
      phone: string | null;
    },
  ) {
    return this.profilesService.getProfile(user.uid);
  }
}
