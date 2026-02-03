//********************************************************************
//
// EmailService Class
//
// Service for sending email verification codes via Postmark. Handles
// code generation, storage, validation, and email sending.
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
// postmarkClient  postmark.ServerClient  Postmark client
// fromEmail       string                 From email address
// verificationRepo  Repository<EmailVerification>  TypeORM repository
//
//*******************************************************************

import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ServerClient } from "postmark";
import { EmailVerification } from "../database/entities/email-verification.entity";
import {
  isDemoEmail,
  getDemoVerificationCode,
} from "../constants/review-config";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  private readonly postmarkClient: ServerClient | null;
  private readonly fromEmail: string;

  constructor(
    @InjectRepository(EmailVerification)
    private readonly verificationRepo: Repository<EmailVerification>,
  ) {
    const apiToken = process.env.POSTMARK_API_TOKEN;
    if (!apiToken) {
      this.logger.warn("POSTMARK_API_TOKEN not set. Email sending will fail.");
      this.postmarkClient = null;
    } else {
      this.postmarkClient = new ServerClient(apiToken);
    }
    this.fromEmail = "no-reply@evendating.us";

    // Log configuration on startup
    this.logger.log(`EmailService initialized with sender: ${this.fromEmail}`);
  }

  //********************************************************************
  //
  // generateCode Method
  //
  // Generates a 6-digit numeric verification code.
  //
  // Return Value
  // ------------
  // string    6-digit code as string
  //
  //*******************************************************************
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  //********************************************************************
  //
  // invalidateOldCodes Method
  //
  // Invalidates all existing unused codes for a user+email combination.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // userUid    string    Firebase UID
  // email      string    Email address
  //
  //*******************************************************************
  private async invalidateOldCodes(
    userUid: string,
    email: string,
  ): Promise<void> {
    await this.verificationRepo.delete({
      userUid,
      email: email.toLowerCase(),
      used: false,
    });
  }

  //********************************************************************
  //
  // sendVerificationCode Method
  //
  // Generates verification code, invalidates old codes, sends email,
  // and stores code in database.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // userUid    string    Firebase UID
  // email      string    Email address to send code to
  //
  //*******************************************************************
  async sendVerificationCode(userUid: string, email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase();

    // Demo account bypass - skip actual email sending for App Store review
    const demoCode = getDemoVerificationCode();
    if (isDemoEmail(normalizedEmail) && demoCode) {
      this.logger.log(
        `Demo email detected: ${normalizedEmail} - skipping actual send`,
      );
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 60); // 1 hour for demo

      await this.invalidateOldCodes(userUid, normalizedEmail);
      const verification = this.verificationRepo.create({
        userUid,
        email: normalizedEmail,
        code: demoCode.toLowerCase(),
        expiresAt,
        used: false,
      });
      await this.verificationRepo.save(verification);
      return;
    }

    const code = this.generateCode();
    const expiresInMinutes =
      Number(process.env.EMAIL_VERIFICATION_CODE_EXPIRY_MINUTES) || 15;
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + expiresInMinutes);

    // Invalidate old codes for this user+email
    await this.invalidateOldCodes(userUid, normalizedEmail);

    // Store new code (store code as lowercase for case-insensitive comparison)
    const verification = this.verificationRepo.create({
      userUid,
      email: normalizedEmail,
      code: code.toLowerCase(),
      expiresAt,
      used: false,
    });
    await this.verificationRepo.save(verification);

    // Send email via Postmark
    if (!this.postmarkClient) {
      throw new InternalServerErrorException(
        "Email service is not configured. Please contact support.",
      );
    }

    try {
      await this.postmarkClient.sendEmail({
        From: this.fromEmail,
        To: normalizedEmail,
        Subject: "Verify your school email",
        HtmlBody: `<p>Your verification code is: <strong>${code}</strong></p><p>This code will expire in ${expiresInMinutes} minutes.</p>`,
        TextBody: `Your verification code is: ${code}\n\nThis code will expire in ${expiresInMinutes} minutes.`,
        MessageStream: "outbound",
      });

      this.logger.log(`Verification code sent to ${normalizedEmail}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Extract Postmark error properties safely
      interface PostmarkError {
        ErrorCode?: number;
        Message?: string;
      }
      const postmarkError = error as PostmarkError;
      const errorCode = postmarkError?.ErrorCode;
      const postmarkMessage = postmarkError?.Message;

      // Log detailed error information
      this.logger.error(
        `Failed to send verification email to ${normalizedEmail}`,
        {
          message: errorMessage,
          errorCode: errorCode,
          postmarkMessage: postmarkMessage,
          stack: errorStack,
        },
      );

      // Convert Postmark errors to user-friendly messages
      if (error instanceof Error) {
        // 401: Invalid API token
        if (errorCode === 401 || errorMessage.includes("401")) {
          this.logger.error(
            "Postmark API token error - check POSTMARK_API_TOKEN environment variable",
          );
          throw new InternalServerErrorException(
            "Email service configuration error. Please contact support.",
          );
        }
        // 422: Validation error (invalid email, etc.)
        if (errorCode === 422 || errorMessage.includes("422")) {
          throw new InternalServerErrorException(
            "Email address is invalid. Please check and try again.",
          );
        }
        // 429: Rate limit exceeded
        if (errorCode === 429 || errorMessage.includes("429")) {
          throw new InternalServerErrorException(
            "Email service is temporarily unavailable. Please try again later.",
          );
        }
        // 500: Postmark server error
        if (errorCode === 500 || errorMessage.includes("500")) {
          throw new InternalServerErrorException(
            "Email service is temporarily unavailable. Please try again later.",
          );
        }
      }

      // Generic error for unknown issues
      throw new InternalServerErrorException(
        "Failed to send verification email. Please try again later.",
      );
    }
  }

  //********************************************************************
  //
  // verifyCode Method
  //
  // Verifies a code and marks it as used. Returns true if valid,
  // false otherwise.
  //
  // Return Value
  // ------------
  // Promise<boolean>    True if code is valid and not expired
  //
  // Value Parameters
  // ----------------
  // userUid    string    Firebase UID
  // email      string    Email address
  // code       string    Verification code
  //
  //*******************************************************************
  async verifyCode(
    userUid: string,
    email: string,
    code: string,
  ): Promise<boolean> {
    const normalizedEmail = email.toLowerCase();
    const normalizedCode = code.toLowerCase().trim();

    const verification = await this.verificationRepo.findOne({
      where: {
        userUid,
        email: normalizedEmail,
        code: normalizedCode,
        used: false,
      },
    });

    if (!verification) {
      return false;
    }

    // Check expiration
    if (new Date() > verification.expiresAt) {
      return false;
    }

    // Mark as used (only allow one verification attempt)
    verification.used = true;
    await this.verificationRepo.save(verification);

    return true;
  }

  //********************************************************************
  //
  // sendEmail Method
  //
  // General-purpose email sending method. Can be used by other services
  // to send emails via Postmark.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // to          string    Recipient email address
  // subject     string    Email subject
  // htmlBody    string    HTML email body
  // textBody    string    Plain text email body (optional)
  //
  //*******************************************************************
  async sendEmail(
    to: string,
    subject: string,
    htmlBody: string,
    textBody?: string,
  ): Promise<void> {
    const normalizedEmail = to.toLowerCase();

    if (!this.postmarkClient) {
      throw new InternalServerErrorException(
        "Email service is not configured. Please contact support.",
      );
    }

    try {
      await this.postmarkClient.sendEmail({
        From: this.fromEmail,
        To: normalizedEmail,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody || htmlBody,
        MessageStream: "outbound",
      });

      this.logger.log(`Email sent to ${normalizedEmail}: ${subject}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // Extract Postmark error properties safely
      interface PostmarkError {
        ErrorCode?: number;
        Message?: string;
      }
      const postmarkError = error as PostmarkError;
      const errorCode = postmarkError?.ErrorCode;
      const postmarkMessage = postmarkError?.Message;

      // Log detailed error information
      this.logger.error(`Failed to send email to ${normalizedEmail}`, {
        message: errorMessage,
        errorCode: errorCode,
        postmarkMessage: postmarkMessage,
        stack: errorStack,
        subject: subject,
      });

      // Convert Postmark errors to user-friendly messages
      if (error instanceof Error) {
        // 401: Invalid API token
        if (errorCode === 401 || errorMessage.includes("401")) {
          this.logger.error(
            "Postmark API token error - check POSTMARK_API_TOKEN environment variable",
          );
          throw new InternalServerErrorException(
            "Email service configuration error. Please contact support.",
          );
        }
        // 422: Validation error (invalid email, etc.)
        if (errorCode === 422 || errorMessage.includes("422")) {
          throw new InternalServerErrorException(
            "Email address is invalid. Please check and try again.",
          );
        }
        // 429: Rate limit exceeded
        if (errorCode === 429 || errorMessage.includes("429")) {
          throw new InternalServerErrorException(
            "Email service is temporarily unavailable. Please try again later.",
          );
        }
        // 500: Postmark server error
        if (errorCode === 500 || errorMessage.includes("500")) {
          throw new InternalServerErrorException(
            "Email service is temporarily unavailable. Please try again later.",
          );
        }
      }

      // Generic error for unknown issues
      throw new InternalServerErrorException(
        "Failed to send email. Please try again later.",
      );
    }
  }
}
