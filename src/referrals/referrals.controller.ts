//********************************************************************
//
// ReferralsController Class
//
// Controller for referral program endpoints. Handles sending referrals
// by email, retrieving a user's sent referrals, pinging activity for
// token reward tracking, and checking a user's referral status.
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
// referralsService    ReferralsService    Injected referrals service
//
//*******************************************************************

import { Controller, Post, Get, Body, Req } from "@nestjs/common";

import { ReferralsService } from "./referrals.service";
import { AuthUser } from "../auth/auth-user.decorator";

interface SendReferralDto {
  email: string;
}

@Controller("referrals")
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  //********************************************************************
  //
  // sendReferral Method
  //
  // POST /referrals/send endpoint. Creates a referral for the given
  // email address. Validates domain, uniqueness, and circular referral
  // constraints before creating the referral record.
  //
  // Return Value
  // ------------
  // Promise<Referral>    Created referral entity
  //
  // Value Parameters
  // ----------------
  // user    AuthUser           Authenticated user from decorator
  // body    SendReferralDto    Request body containing email
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
  @Post("send")
  async sendReferral(
    @AuthUser() user: { uid: string; email: string | null },
    @Body() body: SendReferralDto,
  ) {
    // uid is the Cognito/Firebase UID; we need to work with users by their
    // database id. The service resolves by the User.id stored on the record.
    // We pass uid here and the service queries by uid via usersRepo.
    return this.referralsService.sendReferralByUid(user.uid, body.email);
  }

  //********************************************************************
  //
  // getMyReferrals Method
  //
  // GET /referrals/my endpoint. Returns all referrals sent by the
  // currently authenticated user.
  //
  // Return Value
  // ------------
  // Promise<Referral[]>    Array of referral entities
  //
  // Value Parameters
  // ----------------
  // user    AuthUser    Authenticated user from decorator
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
  @Get("my")
  async getMyReferrals(@AuthUser() user: { uid: string }) {
    return this.referralsService.getMyReferralsByUid(user.uid);
  }

  //********************************************************************
  //
  // pingActivity Method
  //
  // POST /referrals/ping endpoint. Called periodically by the client
  // app to record 1 minute of active usage for the authenticated user.
  // Once the referred user has accumulated 60 minutes, token rewards
  // are granted to both the referrer and the referred user.
  //
  // Return Value
  // ------------
  // Promise<{ minutesActive: number; rewarded: boolean }>    Activity stats
  //
  // Value Parameters
  // ----------------
  // user    AuthUser    Authenticated user from decorator
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
  @Post("ping")
  async pingActivity(@AuthUser() user: { uid: string }) {
    return this.referralsService.pingActivityByUid(user.uid);
  }

  //********************************************************************
  //
  // getReferralStatus Method
  //
  // GET /referrals/status endpoint. Returns referral status for the
  // current user — whether they were referred and whether they have
  // qualified for or received rewards.
  //
  // Return Value
  // ------------
  // Promise<Referral | null>    Referral entity or null
  //
  // Value Parameters
  // ----------------
  // user    AuthUser    Authenticated user from decorator
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
  async getReferralStatus(@AuthUser() user: { uid: string }) {
    return this.referralsService.getReferralStatusByUid(user.uid);
  }
}
