//********************************************************************
//
// AdminController Class
//
// Controller for admin-only endpoints. Handles granting tokens and
// subscription status to users. All routes are protected by AdminGuard.
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
// adminService    AdminService    Injected admin service
//
//*******************************************************************

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Patch,
  Delete,
} from "@nestjs/common";

import { AdminGuard } from "../auth/guards/admin.guard";
import { AdminService } from "./admin.service";
import { GrantDto } from "./dto/grant.dto";
import { SearchService } from "../search/search.service";
import { AuthUser } from "../auth/auth-user.decorator";
import { UseInterceptors } from "@nestjs/common";
import { AdminAuditInterceptor } from "./admin-audit.interceptor";
import { CreateAdminDto } from "./dto/create-admin.dto";
import { ReviewsService } from "../reviews/reviews.service";
import { ReviewAppealsService } from "../reviews/review-appeals.service";
import { ReviewResponseDto } from "../reviews/dto/review-response.dto";

@Controller("admin")
@UseGuards(AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly searchService: SearchService,
    private readonly reviewsService: ReviewsService,
    private readonly reviewAppealsService: ReviewAppealsService,
  ) {}

  // Admin registry
  @Get("admins")
  async listAdmins() {
    return this.adminService.listAdmins();
  }

  @Post("admins")
  async createAdmin(
    @Body() dto: CreateAdminDto,
    @AuthUser() admin: { uid: string },
  ) {
    return this.adminService.createAdmin(dto.email, dto.uid, admin.uid);
  }

  @Delete("admins/:uid")
  async deleteAdmin(
    @Param("uid") uid: string,
    @AuthUser() admin: { uid: string },
  ) {
    await this.adminService.deleteAdmin(uid, admin.uid);
    return { message: "Admin removed" };
  }

  //********************************************************************
  //
  // grant Method
  //
  // POST /admin/grant endpoint. Grants tokens and/or subscription
  // status to a user.
  //
  // Return Value
  // ------------
  // Promise<User>    Updated user entity
  //
  // Value Parameters
  // ----------------
  // dto    GrantDto    Grant data
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
  @Post("grant")
  async grant(@AuthUser() admin: { uid: string }, @Body() dto: GrantDto) {
    return this.adminService.grant(dto, admin.uid);
  }

  //********************************************************************
  //
  // getUser Method
  //
  // GET /admin/users/:uid endpoint. Returns user details by UID for admin.
  //
  // Return Value
  // ------------
  // Promise<User>    User entity
  //
  // Value Parameters
  // ----------------
  // uid    string    Firebase UID
  //
  //*******************************************************************
  @Get("users/stats")
  async userStats() {
    return this.adminService.getUserStats();
  }

  @Get("users/activity/hourly")
  async userActivityByHour() {
    return this.adminService.getUserActivityByHour();
  }

  @Post("users/:uid/set-password")
  async setUserPassword(
    @Param("uid") uid: string,
    @Body() body: { password: string; permanent?: boolean },
  ) {
    await this.adminService.setCognitoPassword(uid, body.password, body.permanent ?? true);
    return { success: true };
  }

  @Get("users/:uid")
  async getUser(@Param("uid") uid: string) {
    return this.adminService.getUser(uid);
  }

  //********************************************************************
  //
  // getUserFlags Method
  //
  // GET /admin/users/:uid/flags endpoint. Returns per-user override flags.
  //
  //********************************************************************
  @Get("users/:uid/flags")
  async getUserFlags(@Param("uid") uid: string) {
    return this.adminService.getUserFlags(uid);
  }

  //********************************************************************
  //
  // updateUserFlags Method
  //
  // PATCH /admin/users/:uid/flags endpoint. Updates per-user override flags.
  //
  //********************************************************************
  @Patch("users/:uid/flags")
  async updateUserFlags(
    @Param("uid") uid: string,
    @Body()
    body: {
      unlimitedSearch?: boolean;
      unlimitedUndo?: boolean;
      unlimitedMessageReq?: boolean;
    },
    @AuthUser() admin: { uid: string },
  ) {
    return this.adminService.updateUserFlags(uid, body, admin.uid);
  }

  //********************************************************************
  //
  // getPhotos Method
  //
  // GET /admin/photos endpoint. Returns photos filtered by status
  // for manual review.
  //
  // Return Value
  // ------------
  // Promise<ProfilePhoto[]>    Array of profile photos
  //
  // Value Parameters
  // ----------------
  // status    string    Optional status filter (pending, flagged, rejected)
  //
  //*******************************************************************
  @Get("photos")
  async getPhotos(@Query("status") status?: string) {
    return this.adminService.getPhotos(status);
  }

  // Reports
  @Get("reports")
  async getReports(@Query("status") status?: string) {
    return this.adminService.getReports(status);
  }

  // Admin search by name
  @Get("users")
  async searchUsers(@Query("name") name?: string) {
    return this.adminService.searchUsersByName(name ?? "");
  }

  @Get("reports/:id")
  async getReport(@Param("id") id: string) {
    return this.adminService.getReport(id);
  }

  @Patch("reports/:id")
  async updateReport(
    @Param("id") id: string,
    @Body()
    body: {
      assignedTo?: string | null;
      notes?: string | null;
      status?: string;
      evidence?: Record<string, unknown> | null;
    },
  ) {
    return this.adminService.updateReport(id, body);
  }

  @Post("reports/:id/resolve")
  async resolveReport(
    @Param("id") id: string,
    @Body() body: { notes?: string | null; assignedTo?: string | null },
  ) {
    return this.adminService.resolveReport(id, body);
  }

  //********************************************************************
  //
  // approvePhoto Method
  //
  // POST /admin/photos/:id/approve endpoint. Manually approves a photo.
  //
  // Return Value
  // ------------
  // Promise<ProfilePhoto>    Updated photo entity
  //
  // Value Parameters
  // ----------------
  // id    string    Photo UUID
  //
  //*******************************************************************
  @Post("photos/:id/approve")
  async approvePhoto(
    @AuthUser() admin: { uid: string },
    @Param("id") id: string,
    @Body()
    body: { reason?: string | null; confidence?: number | null } = {},
  ) {
    return this.adminService.approvePhoto(id, admin.uid, body);
  }

  //********************************************************************
  //
  // rejectPhoto Method
  //
  // POST /admin/photos/:id/reject endpoint. Manually rejects a photo.
  //
  // Return Value
  // ------------
  // Promise<ProfilePhoto>    Updated photo entity
  //
  // Value Parameters
  // ----------------
  // id    string    Photo UUID
  //
  //*******************************************************************
  @Post("photos/:id/reject")
  async rejectPhoto(
    @AuthUser() admin: { uid: string },
    @Param("id") id: string,
    @Body()
    body: { reason?: string | null; confidence?: number | null } = {},
  ) {
    return this.adminService.rejectPhoto(id, admin.uid, body);
  }

  //********************************************************************
  //
  // getAuditLogs Method
  //
  // GET /admin/audit endpoint. Returns audit events for admin review.
  //
  // Return Value
  // ------------
  // Promise<AuditEvent[]>    Array of audit events
  //
  // Value Parameters
  // ----------------
  // limit    number|undefined    Optional limit (default 100)
  // offset   number|undefined    Optional offset (default 0)
  //
  //*******************************************************************
  @Get("audit")
  async getAuditLogs(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.adminService.getAuditLogs(
      limit ? parseInt(limit, 10) : 100,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  //********************************************************************
  // Photo bulk/requeue
  //********************************************************************
  @Post("photos/bulk")
  async bulkPhotoAction(
    @AuthUser() admin: { uid: string },
    @Body()
    body: {
      photoIds: string[];
      action: "approve" | "reject";
      reason?: string | null;
      confidence?: number | null;
    },
  ) {
    return this.adminService.bulkPhotoAction(admin.uid, body);
  }

  @Post("photos/:id/requeue")
  async requeuePhoto(
    @Param("id") id: string,
    @Body() body: { queue?: "vision" | "human" } = {},
  ) {
    return this.adminService.requeuePhoto(id, body.queue);
  }

  //********************************************************************
  //
  // deletePhoto Method
  //
  // DELETE /admin/photos/:id endpoint. Deletes a photo record and
  // removes it from the user's profile plus S3.
  //
  //*******************************************************************
  @Delete("photos/:id")
  async deletePhoto(
    @AuthUser() admin: { uid: string },
    @Param("id") id: string,
  ) {
    return this.adminService.deletePhoto(id, admin.uid);
  }

  //********************************************************************
  // Reviews & strikes
  //********************************************************************
  @Get("reviews")
  async getReviews(
    @Query("status") status?: string,
    @Query("targetUid") targetUid?: string,
    @Query("reviewerUid") reviewerUid?: string,
  ) {
    return this.adminService.getReviews({ status, targetUid, reviewerUid });
  }

  @Patch("reviews/:id")
  async updateReview(
    @Param("id") id: string,
    @Body()
    body: {
      approved?: boolean;
      rejected?: boolean;
      pendingHumanReview?: boolean;
    },
  ) {
    return this.adminService.updateReview(id, body);
  }

  @Post("reviews/:id/strike")
  async issueStrike(@Param("id") id: string) {
    return this.adminService.issueStrikeForReview(id);
  }

  @Delete("reviews/:id/strike")
  async removeStrike(@Param("id") id: string) {
    return this.adminService.removeStrikeForReviewTarget(id);
  }

  @Post("users/:uid/unblock-review-timeout")
  async unblockReviewTimeout(@Param("uid") uid: string) {
    return this.adminService.unblockReviewTimeout(uid);
  }

  //********************************************************************
  // Admin-specific review endpoints (bypass FirebaseAuthGuard requirement)
  //********************************************************************
  @Get("reviews/user/:uid")
  async getAdminUserReviews(@Param("uid") uid: string) {
    const reviews = await this.reviewsService.getUserReviews(uid);
    return reviews.map((r) => new ReviewResponseDto(r));
  }

  @Get("reviews/user/:uid/average")
  async getAdminUserAverage(@Param("uid") uid: string) {
    return this.reviewsService.getUserAverage(uid);
  }

  @Get("reviews/sent/:uid")
  async getAdminSentReviews(@Param("uid") uid: string) {
    const reviews = await this.reviewsService.getSentReviews(uid);
    return reviews.map((r) => new ReviewResponseDto(r));
  }

  //********************************************************************
  // Matches & chat oversight
  //********************************************************************
  @Get("users/:uid/matches")
  async getUserMatches(@Param("uid") uid: string) {
    return this.adminService.getMatches(uid);
  }

  @Post("matches/:matchId/unmatch")
  async unmatch(@Param("matchId") matchId: string) {
    return this.adminService.unmatch(matchId);
  }

  @Get("matches/:matchId/messages")
  async getMessages(@Param("matchId") matchId: string) {
    return this.adminService.getMessages(matchId);
  }

  @Post("users/:uid/mute-chat")
  async muteChat(@Param("uid") uid: string) {
    return this.adminService.muteChat(uid);
  }

  @Post("users/:uid/clear-message-tokens")
  async clearMessageTokens(@Param("uid") uid: string) {
    return this.adminService.clearMessageTokens(uid);
  }

  //********************************************************************
  // Enhanced user management
  //********************************************************************
  @Post("users/:uid/impersonate")
  async impersonate(
    @Param("uid") uid: string,
    @AuthUser() admin: { uid: string },
  ) {
    return this.adminService.impersonate(uid, admin.uid);
  }

  @Patch("users/:uid/pause")
  async pauseUser(@Param("uid") uid: string) {
    return this.adminService.pauseUser(uid);
  }

  @Patch("users/:uid/unpause")
  async unpauseUser(@Param("uid") uid: string) {
    return this.adminService.unpauseUser(uid);
  }

  @Delete("users/:uid")
  async deleteUser(@Param("uid") uid: string) {
    return this.adminService.deleteUser(uid);
  }

  @Post("users/:uid/reset-review-timeout")
  async resetReviewTimeout(@Param("uid") uid: string) {
    return this.adminService.resetReviewTimeout(uid);
  }

  @Post("users/:uid/reset-strikes")
  async resetStrikes(@Param("uid") uid: string) {
    return this.adminService.resetStrikes(uid);
  }

  @Post("users/:uid/revoke-sessions")
  async revokeSessions(@Param("uid") uid: string) {
    return this.adminService.revokeSessions(uid);
  }

  @Patch("users/:uid/role")
  async updateRole(
    @Param("uid") uid: string,
    @Body() body: { role: "user" | "admin" },
  ) {
    return this.adminService.updateUserRole(uid, body.role);
  }

  @Post("users/:uid/resend-verification")
  async resendVerification(@Param("uid") uid: string) {
    return this.adminService.resendVerification(uid);
  }

  //********************************************************************
  // Tokens & subscription management
  //********************************************************************
  @Get("users/:uid/tokens")
  async getTokens(@Param("uid") uid: string) {
    return this.adminService.getTokenBalances(uid);
  }

  @Post("users/:uid/tokens/grant")
  async grantTokens(
    @Param("uid") uid: string,
    @Body()
    body: { search?: number; message?: number; undo?: number },
  ) {
    return this.adminService.grantTokens(uid, body);
  }

  @Post("users/:uid/tokens/revoke")
  async revokeTokens(
    @Param("uid") uid: string,
    @Body()
    body: { search?: number; message?: number; undo?: number },
  ) {
    return this.adminService.revokeTokens(uid, body);
  }

  @Patch("users/:uid/subscription")
  async updateSubscription(
    @Param("uid") uid: string,
    @Body()
    body: { isSubscribed?: boolean; subscriptionExpiresAt?: string | null },
  ) {
    return this.adminService.updateSubscription(uid, body);
  }

  //********************************************************************
  // User ban management
  //********************************************************************
  @Post("users/:uid/ban")
  async banUser(
    @Param("uid") uid: string,
    @Body() body: { reason?: string | null },
  ) {
    return this.adminService.banUser(uid, body.reason ?? null);
  }

  @Post("users/:uid/unban")
  async unbanUser(@Param("uid") uid: string) {
    return this.adminService.unbanUser(uid);
  }

  //********************************************************************
  // Rate limit management
  //********************************************************************
  @Get("rate-limit/buckets")
  async listBuckets() {
    return this.adminService.listRateLimitBuckets();
  }

  @Delete("rate-limit/buckets/:key")
  async clearBucket(@Param("key") key: string) {
    return this.adminService.clearRateLimitBucket(key);
  }

  @Post("rate-limit/whitelist")
  async whitelistIp(@Body() body: { ip: string }) {
    return this.adminService.whitelistIp(body.ip);
  }

  @Post("rate-limit/blacklist")
  async blacklistIp(@Body() body: { ip: string }) {
    return this.adminService.blacklistIp(body.ip);
  }

  //********************************************************************
  // Queue debug
  //********************************************************************
  @Get("queue/:uid")
  async getQueue(@Param("uid") uid: string) {
    return this.adminService.getQueue(uid);
  }

  @Post("queue/:uid/rebuild")
  async rebuildQueue(@Param("uid") uid: string) {
    return this.adminService.rebuildQueue(uid);
  }

  //********************************************************************
  // Health/logs stubs
  //********************************************************************
  @Get("health")
  async health() {
    return this.adminService.health();
  }

  @Get("logs")
  async logs() {
    return this.adminService.logs();
  }

  @Get("jobs")
  async jobs() {
    return this.adminService.jobs();
  }

  //********************************************************************
  // Config flags
  //********************************************************************
  @Get("flags")
  async getFlags() {
    return this.adminService.getFlags();
  }

  @Patch("flags/:key")
  async setFlag(
    @Param("key") key: string,
    @Body() body: { value: boolean | string | number },
  ) {
    return this.adminService.setFlag(key, body.value);
  }

  //********************************************************************
  // Push/email test stubs
  //********************************************************************
  @Post("users/:uid/test-push")
  async testPush(@Param("uid") uid: string) {
    return await this.adminService.testPush(uid);
  }

  @Post("users/:uid/test-email")
  async testEmail(@Param("uid") uid: string) {
    return await this.adminService.testEmail(uid);
  }

  @Get("users/:uid/push-log")
  async pushLog(@Param("uid") uid: string) {
    return this.adminService.pushLog(uid);
  }

  //********************************************************************
  //
  // getProfileForAdmin Method
  //
  // GET /admin/profiles/:uid endpoint. Returns profile data for admin.
  //
  //*******************************************************************
  @Get("profiles/:uid")
  async getProfile(@Param("uid") uid: string) {
    return this.adminService.getProfileForAdmin(uid);
  }

  //********************************************************************
  //
  // getUserStrikes Method
  //
  // GET /admin/users/:uid/strikes endpoint. Returns strike count for user.
  //
  //*******************************************************************
  @Get("users/:uid/strikes")
  async getUserStrikes(@Param("uid") uid: string) {
    return this.adminService.getUserStrikes(uid);
  }

  //********************************************************************
  // Data export stub
  //********************************************************************
  @Post("users/:uid/export")
  async exportUser(@Param("uid") uid: string) {
    return this.adminService.exportUser(uid);
  }

  @Get("users/:uid/export/:jobId")
  async exportStatus(@Param("uid") uid: string, @Param("jobId") jobId: string) {
    return this.adminService.exportStatus(uid, jobId);
  }

  //********************************************************************
  // Support Ticket Admin Endpoints
  //********************************************************************
  @Get("support")
  async getSupportTickets(@Query("status") status?: string) {
    return this.adminService.getSupportTickets(status);
  }

  @Get("support/:id")
  async getSupportTicket(@Param("id") id: string) {
    return this.adminService.getSupportTicket(id);
  }

  @Patch("support/:id")
  async updateSupportTicket(
    @Param("id") id: string,
    @Body()
    body: {
      status?: "open" | "in_progress" | "closed";
      adminResponse?: string;
    },
  ) {
    return this.adminService.updateSupportTicket(id, body);
  }

  @Post("support/:id/reply")
  async replySupportTicket(
    @Param("id") id: string,
    @Body() body: { response: string },
    @AuthUser() admin: { uid: string },
  ) {
    return this.adminService.replySupportTicket(id, body.response, admin.uid);
  }

  @Post("support/:id/close")
  async closeSupportTicket(
    @Param("id") id: string,
    @AuthUser() admin: { uid: string },
  ) {
    return this.adminService.closeSupportTicket(id, admin.uid);
  }

  //********************************************************************
  // Suggestion Admin Endpoints
  //********************************************************************
  @Get("suggestions")
  async getSuggestions(@Query("status") status?: string) {
    return this.adminService.getSuggestions(status);
  }

  @Get("suggestions/:id")
  async getSuggestion(@Param("id") id: string) {
    return this.adminService.getSuggestion(id);
  }

  @Patch("suggestions/:id")
  async updateSuggestion(
    @Param("id") id: string,
    @Body()
    body: {
      status?: "new" | "reviewed" | "implemented" | "rejected";
    },
  ) {
    return this.adminService.updateSuggestion(id, body);
  }

  //********************************************************************
  // Browse users with photos (for admin grid view)
  //********************************************************************
  @Get("browse")
  async browseUsers(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.adminService.browseUsersWithPhotos(
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  //********************************************************************
  // Review Appeals Admin Endpoints
  //********************************************************************

  //********************************************************************
  //
  // getPendingAppeals Method
  //
  // GET /admin/appeals endpoint. Returns all pending review appeals
  // for admin resolution.
  //
  // Return Value
  // ------------
  // Promise<ReviewAppeal[]>    Array of pending appeal entities
  //
  //*******************************************************************
  @Get("appeals")
  async getPendingAppeals() {
    return this.reviewAppealsService.getPendingAppeals();
  }

  //********************************************************************
  //
  // resolveAppeal Method
  //
  // PATCH /admin/appeals/:id endpoint. Resolves a review appeal by
  // approving or rejecting it. Approval marks the original review as
  // rejected.
  //
  // Return Value
  // ------------
  // Promise<ReviewAppeal>    Updated appeal entity
  //
  // Value Parameters
  // ----------------
  // id      string    Appeal ID from route parameter
  // body    Object    Resolution data: status and optional adminNote
  //
  //*******************************************************************
  @Patch("appeals/:id")
  async resolveAppeal(
    @Param("id") id: string,
    @Body()
    body: {
      status: "approved" | "rejected";
      adminNote?: string;
    },
  ) {
    return this.reviewAppealsService.resolveAppeal(id, body);
  }
}
