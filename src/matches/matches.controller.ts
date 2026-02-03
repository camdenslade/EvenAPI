//********************************************************************
//
// MatchesController Class
//
// Controller for match endpoints. Handles GET /matches/me to retrieve
// user matches and POST /matches to manually create matches.
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
// matchesService    MatchesService    Injected matches service
//
//*******************************************************************

import { Controller, Get, Post, Body, Delete, Param } from "@nestjs/common";

import { MatchesService } from "./matches.service";

import { AuthUser } from "../auth/auth-user.decorator";

@Controller("matches")
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  //********************************************************************
  //
  // getMyMatches Method
  //
  // GET /matches/me endpoint. Returns all matches for the authenticated
  // user (active and restored only, with lazy expiration).
  //
  // Return Value
  // ------------
  // Promise<Array>    Array of match objects with profile data
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
  async getMyMatches(@AuthUser() user: { uid: string }) {
    return this.matchesService.getMatches(user.uid);
  }

  //********************************************************************
  //
  // createMatch Method
  //
  // POST /matches endpoint. Manually creates a match between the
  // logged-in user and a target user. Usually triggered when two likes
  // occur simultaneously or for testing.
  //
  // Return Value
  // ------------
  // Promise<Match>    Created or existing match entity
  //
  // Value Parameters
  // ----------------
  // user      Object    Authenticated Firebase user from decorator
  //   uid       string        Firebase UID
  // targetId  string    Target user's Firebase UID from request body
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
  @Post()
  async createMatch(
    @AuthUser() user: { uid: string },
    @Body("targetId") targetId: string,
  ) {
    return this.matchesService.createMatch(user.uid, targetId);
  }

  //********************************************************************
  //
  // unmatch Method
  //
  // DELETE /matches/:id endpoint. Marks a match as expired for either
  // participant. Returns { success: true } on completion.
  //
  //********************************************************************
  @Delete(":id")
  async unmatch(@AuthUser() user: { uid: string }, @Param("id") id: string) {
    await this.matchesService.unmatch(user.uid, id);
    return { success: true };
  }
}
