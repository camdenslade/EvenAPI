//********************************************************************
//
// ReportsService Class
//
// Service for managing user and content reports. Handles report creation
// with idempotent duplicate handling. Reports are persisted indefinitely
// and are not deleted when users are deleted.
//
// Return Value
// ------------
// None (NestJS service class)
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
// reportRepo    Repository<Report>    TypeORM repository for reports
//
//*******************************************************************

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import {
  Report,
  ReportContentType,
  ReportStatus,
} from "../database/entities/report.entity";

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
  ) {}

  //********************************************************************
  //
  // reportUser Method
  //
  // Creates a user report. Handles duplicates idempotently by updating
  // timestamp if same reporter + same target already exists. Always
  // returns successfully (2xx) even for duplicates.
  //
  // Return Value
  // ------------
  // Promise<Report>    Created or updated report entity
  //
  // Value Parameters
  // ----------------
  // reporterUid    string        Firebase UID of user making the report
  // targetUid      string        Firebase UID of user being reported
  // reason         string|null    Optional reason text
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // existing    Report|null    Existing report with same reporter + target
  // report      Report         Report entity to create or update
  //
  //*******************************************************************
  async reportUser(
    reporterUid: string,
    targetUid: string,
    reason?: string | null,
  ): Promise<Report> {
    if (reporterUid === targetUid) {
      // Allow self-reports (may be used for testing or edge cases)
      // Still return success to maintain idempotent behavior
    }

    // Check for existing report (idempotent handling)
    const existing = await this.reportRepo.findOne({
      where: {
        reporterUid,
        targetUid,
        contentType: "profile", // User reports use 'profile' as contentType
      },
    });

    if (existing) {
      // Update timestamp to reflect latest report attempt
      // This maintains idempotency while showing activity
      existing.createdAt = new Date();
      if (reason) {
        existing.reason = reason;
      }
      return this.reportRepo.save(existing);
    }

    // Create new report
    const report = this.reportRepo.create({
      reporterUid,
      targetUid,
      contentType: "profile",
      reason: reason ?? null,
      status: "pending" as ReportStatus,
    });

    return this.reportRepo.save(report);
  }

  //********************************************************************
  //
  // reportContent Method
  //
  // Creates a content report (message, photo, etc.). Handles duplicates
  // idempotently by updating timestamp if same reporter + same content
  // already exists. Always returns successfully (2xx) even for duplicates.
  //
  // Return Value
  // ------------
  // Promise<Report>    Created or updated report entity
  //
  // Value Parameters
  // ----------------
  // reporterUid    string              Firebase UID of user making the report
  // contentType    ReportContentType    Type of content being reported
  // contentId      string               Identifier for the content
  // reason         string|null          Optional reason text
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // existing    Report|null    Existing report with same reporter + content
  // report      Report         Report entity to create or update
  //
  //*******************************************************************
  async reportContent(
    reporterUid: string,
    contentType: ReportContentType,
    contentId: string,
    reason?: string | null,
  ): Promise<Report> {
    // Check for existing report (idempotent handling)
    const existing = await this.reportRepo.findOne({
      where: {
        reporterUid,
        contentType,
        contentId,
      },
    });

    if (existing) {
      // Update timestamp to reflect latest report attempt
      // This maintains idempotency while showing activity
      existing.createdAt = new Date();
      if (reason) {
        existing.reason = reason;
      }
      return this.reportRepo.save(existing);
    }

    // Create new report
    const report = this.reportRepo.create({
      reporterUid,
      targetUid: null, // Content reports don't have a target user
      contentType,
      contentId,
      reason: reason ?? null,
      status: "pending" as ReportStatus,
    });

    return this.reportRepo.save(report);
  }
}
