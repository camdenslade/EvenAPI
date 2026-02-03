//********************************************************************
//
// LikeController Class
//
// Controller for like/swipe endpoints. Handles POST /like to create
// a like action and check for mutual likes/matches.
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
// likeService    LikeService    Injected like service
//
//*******************************************************************

import { Controller, Post, Body, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LikeDto } from "./dto/like.dto";
import { LikeService } from "./like.service";
import { AuthUser } from "../auth/auth-user.decorator";
import { User } from "../database/entities/user.entity";
import { TokensService } from "../tokens/tokens.service";

@Controller("like")
export class LikeController {
  constructor(
    private readonly likeService: LikeService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly tokens: TokensService,
  ) {}

  //********************************************************************
  //
  // likeUser Method
  //
  // POST /like endpoint. Creates a like action from the authenticated
  // user to the target user. Returns match status and matchId if a
  // match is created.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with match status and matchId
  //
  // Value Parameters
  // ----------------
  // user    Object        Authenticated Firebase user from decorator
  //   uid     string          Firebase UID
  // dto     LikeDto       Like DTO containing targetUid
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // result    Object    Result from like service
  //
  //*******************************************************************
  @Post()
  async likeUser(@AuthUser() user: { uid: string }, @Body() dto: LikeDto) {
    const result = await this.likeService.likeUser(user.uid, dto.targetUid);

    return result;
  }

  //********************************************************************
  //
  // undo Method
  //
  // POST /like/undo endpoint. Decrements undoTokens for the authenticated
  // user when they perform an undo action.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response
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
  // currentUser    User|null    User entity from database
  //
  //*******************************************************************
  @Post("undo")
  async undo(@AuthUser() user: { uid: string }) {
    const currentUser = await this.userRepo.findOne({
      where: { uid: user.uid },
    });
    if (!currentUser) {
      throw new ForbiddenException("User not found");
    }

    const consumed = await this.tokens.consumeToken(currentUser.id, "undo");
    if (!consumed) {
      throw new ForbiddenException("insufficient undo tokens");
    }

    return { success: true };
  }
}
