//********************************************************************
//
// ReportsController Class
//
// Controller for report endpoints. Handles user reports and content
// reports. All endpoints require authentication and always return 2xx
// (even for duplicate reports).
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
// reportsService    ReportsService    Injected reports service
//
//*******************************************************************

import { Controller, Post, Param, Body } from "@nestjs/common";

import { AuthUser } from "../auth/auth-user.decorator";
import { ReportsService } from "./reports.service";
import { IsString, IsOptional, IsEnum } from "class-validator";
import type { ReportContentType } from "../database/entities/report.entity";

//********************************************************************
//
// ReportContentDto Class
//
// DTO for content report requests.
//
// Value Parameters
// ----------------
// contentType    ReportContentType    Type of content being reported
// contentId      string               Identifier for the content
// reason         string|null          Optional reason text
//
//*******************************************************************
class ReportContentDto {
  @IsEnum(["message", "photo", "profile", "other"])
  contentType: ReportContentType;

  @IsString()
  contentId: string;

  @IsString()
  @IsOptional()
  reason?: string | null;
}

@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  //********************************************************************
  //
  // reportUser Method
  //
  // POST /reports/users/:targetUid endpoint. Creates a user report.
  // Handles duplicates idempotently. Always returns 2xx success.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
  //
  // Value Parameters
  // ----------------
  // user        Object    Authenticated Firebase user from decorator
  //   uid         string      Firebase UID
  // targetUid   string    Firebase UID of user to report
  // body        Object    Optional request body with reason
  //   reason      string|null  Optional reason text
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
  @Post("users/:targetUid")
  async reportUser(
    @AuthUser()
    user: {
      uid: string;
    },
    @Param("targetUid") targetUid: string,
    @Body() body?: { reason?: string | null },
  ) {
    await this.reportsService.reportUser(
      user.uid,
      targetUid,
      body?.reason ?? null,
    );
    return { success: true };
  }

  //********************************************************************
  //
  // reportContent Method
  //
  // POST /reports/content endpoint. Creates a content report (message,
  // photo, etc.). Handles duplicates idempotently. Always returns 2xx success.
  //
  // Return Value
  // ------------
  // Promise<{ success: boolean }>    Success response object
  //
  // Value Parameters
  // ----------------
  // user        Object          Authenticated Firebase user from decorator
  //   uid         string            Firebase UID
  // body        ReportContentDto  Content report data
  //   contentType ReportContentType Type of content
  //   contentId   string            Content identifier
  //   reason      string|null       Optional reason text
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
  @Post("content")
  async reportContent(
    @AuthUser()
    user: {
      uid: string;
    },
    @Body() body: ReportContentDto,
  ) {
    await this.reportsService.reportContent(
      user.uid,
      body.contentType,
      body.contentId,
      body.reason ?? null,
    );
    return { success: true };
  }
}
