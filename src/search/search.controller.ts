//********************************************************************
//
// SearchController Class
//
// Controller for search endpoints. Handles GET /search/name to search
// profiles by name with distance filtering.
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
// searchService    SearchService    Injected search service
//
//*******************************************************************

import { Controller, Get, Query } from "@nestjs/common";

import { AuthUser } from "../auth/auth-user.decorator";

import { SearchService } from "./search.service";

@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  //********************************************************************
  //
  // searchByName Method
  //
  // GET /search/name endpoint. Searches profiles by first name and
  // filters by distance from the authenticated user. Default radius
  // is 25 miles.
  //
  // Return Value
  // ------------
  // Promise<ProfilePreview[]>    Array of profile preview objects
  //
  // Value Parameters
  // ----------------
  // user      Object        Authenticated Firebase user from decorator
  //   uid       string          Firebase UID
  // name      string        Name to search for from query parameter
  // radius    string|undefined Optional radius in miles from query parameter
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // miles    number    Parsed radius in miles (default 25)
  //
  //*******************************************************************
  @Get("name")
  async searchByName(
    @AuthUser() user: { uid: string },
    @Query("name") name: string,
    @Query("radius") radius?: string,
  ) {
    const miles = radius ? Number(radius) : 25;
    return this.searchService.searchByName(user.uid, name, miles);
  }
}
