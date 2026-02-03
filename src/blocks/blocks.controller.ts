//********************************************************************
//
// BlocksController Class
//
// Controller for block management endpoints. Handles block creation
// (POST /blocks/:targetUid) and block removal (DELETE /blocks/:targetUid).
// Block creation also creates SafetyExclusion for persistent enforcement.
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
// blocksService    BlocksService    Injected blocks service
//
//*******************************************************************

import { Controller, Post, Delete, Param } from "@nestjs/common";
import { Get } from "@nestjs/common";

import { AuthUser } from "../auth/auth-user.decorator";
import { BlocksService } from "./blocks.service";

@Controller("blocks")
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  // GET /blocks/me - list UIDs I have blocked
  @Get("me")
  async listMyBlocks(
    @AuthUser()
    user: {
      uid: string;
    },
  ) {
    const blockedSet = await this.blocksService.getBlockSet(user.uid);
    // Return array of UIDs that are blocked in either direction so UI can hide them
    return { blocked: Array.from(blockedSet) };
  }

  //********************************************************************
  //
  // blockUser Method
  //
  // POST /blocks/:targetUid endpoint. Creates a Block record (social,
  // user-visible) and also creates a SafetyExclusion (internal, persistent)
  // to enforce the block even after account deletion and re-signup.
  // SafetyExclusion persists across account deletion by design.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
  //
  // Value Parameters
  // ----------------
  // user        Object    Authenticated Firebase user from decorator
  //   uid         string      Firebase UID
  // targetUid   string    Firebase UID of user to block
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
  @Post(":targetUid")
  async blockUser(
    @AuthUser()
    user: {
      uid: string;
    },
    @Param("targetUid") targetUid: string,
  ) {
    await this.blocksService.blockUser(user.uid, targetUid);
    return { success: true };
  }

  //********************************************************************
  //
  // unblockUser Method
  //
  // DELETE /blocks/:targetUid endpoint. Removes a Block record (social,
  // user-visible) but preserves the SafetyExclusion (internal, persistent).
  // This allows users to "unblock" socially, but safety enforcement
  // remains in place to prevent abuse after account deletion and re-signup.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
  //
  // Value Parameters
  // ----------------
  // user        Object    Authenticated Firebase user from decorator
  //   uid         string      Firebase UID
  // targetUid   string    Firebase UID of user to unblock
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
  @Delete(":targetUid")
  async unblockUser(
    @AuthUser()
    user: {
      uid: string;
    },
    @Param("targetUid") targetUid: string,
  ) {
    await this.blocksService.unblockUser(user.uid, targetUid);
    return { success: true };
  }
}
