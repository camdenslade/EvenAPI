//********************************************************************
//
// Moderation Policy Scaffolding
//
// Centralized policy definitions for future moderation actions.
// This file contains interfaces and types ONLY - no runtime enforcement,
// no database writes, no scheduled jobs. Used to avoid refactors when
// implementing moderation actions in the future.
//
// Return Value
// ------------
// None (TypeScript type definitions)
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

/**
 * Severity level for moderation actions.
 * Used to categorize reports and determine appropriate responses.
 */
export type ModerationSeverity = "low" | "medium" | "high";

/**
 * Aggregated report counts for a user or content item.
 * Used to evaluate whether thresholds are met for moderation actions.
 */
export interface AggregatedReportCounts {
  /** Total number of reports */
  total: number;

  /** Number of reports in the last 24 hours */
  last24Hours: number;

  /** Number of reports in the last 7 days */
  last7Days: number;

  /** Number of reports in the last 30 days */
  last30Days: number;

  /** Number of unique reporters */
  uniqueReporters: number;

  /** Breakdown by severity */
  bySeverity: {
    low: number;
    medium: number;
    high: number;
  };

  /** Breakdown by reason category (if applicable) */
  byReason?: Record<string, number>;
}

/**
 * Threshold definitions for moderation actions.
 * These are policy numbers only - no enforcement logic here.
 */
export interface ModerationThresholds {
  /** Minimum reports required for low severity action */
  lowSeverityMinReports: number;

  /** Minimum reports required for medium severity action */
  mediumSeverityMinReports: number;

  /** Minimum reports required for high severity action */
  highSeverityMinReports: number;

  /** Minimum unique reporters required (prevents single-user abuse) */
  minUniqueReporters: number;

  /** Time window in hours for report aggregation */
  reportWindowHours: number;

  /** Cooldown period in hours before same user can report again */
  reportCooldownHours: number;
}

/**
 * Default threshold values (policy scaffolding only).
 * These values are placeholders and should be configured based on
 * actual moderation requirements and store policies.
 */
export const DEFAULT_MODERATION_THRESHOLDS: ModerationThresholds = {
  lowSeverityMinReports: 3,
  mediumSeverityMinReports: 5,
  highSeverityMinReports: 10,
  minUniqueReporters: 2,
  reportWindowHours: 168, // 7 days
  reportCooldownHours: 24,
};

/**
 * Policy configuration for different content types.
 * Different content types may have different thresholds.
 */
export interface ContentTypePolicy {
  /** Content type identifier */
  contentType: "message" | "photo" | "profile" | "other";

  /** Thresholds specific to this content type */
  thresholds: ModerationThresholds;
}

/**
 * User moderation status (for future use).
 * This interface defines what moderation state a user might have,
 * but no enforcement is implemented yet.
 */
export interface UserModerationStatus {
  /** User's current moderation status */
  status: "active" | "warned" | "suspended" | "banned";

  /** Number of active warnings */
  warningCount: number;

  /** Timestamp when status was last updated */
  statusUpdatedAt: Date | null;

  /** Reason for current status */
  statusReason: string | null;
}

/**
 * Report evaluation result (for future use).
 * This interface defines what a moderation system might return when
 * evaluating whether action should be taken, but no evaluation logic
 * is implemented yet.
 */
export interface ReportEvaluationResult {
  /** Whether threshold is met for action */
  thresholdMet: boolean;

  /** Recommended severity level */
  recommendedSeverity: ModerationSeverity | null;

  /** Aggregated report counts used for evaluation */
  reportCounts: AggregatedReportCounts;

  /** Whether action should be taken */
  shouldTakeAction: boolean;
}
