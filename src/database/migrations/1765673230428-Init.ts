import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1765673230428 implements MigrationInterface {
  name = "Init1765673230428";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "safety_identities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "phoneHash" character varying NOT NULL,
        "emergencyUsed" boolean NOT NULL DEFAULT false,
        "strikes" integer NOT NULL DEFAULT 0,
        "lastReviewTimeout" TIMESTAMP WITH TIME ZONE,
        "lastSeenAt" TIMESTAMP WITH TIME ZONE,
        "deletedCount" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_safety_identities_phoneHash" UNIQUE ("phoneHash"),
        CONSTRAINT "PK_safety_identities" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "uid" character varying NOT NULL,
        "email" character varying,
        "phone" character varying,
        "latitude" double precision,
        "longitude" double precision,
        "lastLocationUpdate" TIMESTAMP WITH TIME ZONE,
        "reviewTimeoutExpiresAt" TIMESTAMP WITH TIME ZONE,
        "role" character varying NOT NULL DEFAULT 'user',
        "isSubscribed" boolean NOT NULL DEFAULT false,
        "searchTokens" integer NOT NULL DEFAULT 0,
        "messageTokens" integer NOT NULL DEFAULT 0,
        "undoTokens" integer NOT NULL DEFAULT 0,
        "pushToken" character varying,
        "subscriptionExpiresAt" TIMESTAMP WITH TIME ZONE,
        "lastBaselineGrantAt" TIMESTAMP WITH TIME ZONE,
        "safetyIdentityId" uuid,
        CONSTRAINT "UQ_users_uid" UNIQUE ("uid"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "purchases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "platform" character varying NOT NULL,
        "productId" character varying NOT NULL,
        "transactionId" character varying NOT NULL,
        "originalTransactionId" character varying,
        "receipt" text NOT NULL,
        "purchaseType" character varying NOT NULL,
        "status" character varying NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "verifiedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_purchases" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "token_ledger" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tokenType" character varying NOT NULL,
        "source" character varying NOT NULL,
        "quantity" integer NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "purchaseId" uuid,
        "consumedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_token_ledger" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_token_ledger_quantity_positive" CHECK ("quantity" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userUid" character varying NOT NULL,
        "name" character varying NOT NULL,
        "birthday" date NOT NULL,
        "bio" character varying NOT NULL,
        "sex" character varying NOT NULL,
        "sexPreference" character varying NOT NULL,
        "datingPreference" character varying NOT NULL,
        "interests" text[] NOT NULL,
        "photos" text[] NOT NULL,
        "paused" boolean NOT NULL DEFAULT false,
        "height" text[],
        "race" text[],
        "religion" text[],
        "politics" text[],
        "education" text[],
        "activityLevel" character varying,
        "drinking" text[],
        "smoking" text[],
        "marijuana" text[],
        "prefMinAge" integer NOT NULL DEFAULT 18,
        "prefMaxAge" integer NOT NULL DEFAULT 60,
        "prefMaxDistanceMiles" integer NOT NULL DEFAULT 50,
        "showOutsideRange" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_profiles" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "threads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "matchId" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastMessageAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "UQ_threads_matchId" UNIQUE ("matchId"),
        CONSTRAINT "PK_threads" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "threadId" uuid NOT NULL,
        "senderProfileId" uuid NOT NULL,
        "text" text NOT NULL,
        "imageUrl" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_messages" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "review_week_windows" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "windowStart" TIMESTAMP WITH TIME ZONE NOT NULL,
        "windowEnd" TIMESTAMP WITH TIME ZONE NOT NULL,
        "reviewsUsed" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_week_windows" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "review_strikes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "reason" character varying(255) NOT NULL,
        "strikeNumber" integer NOT NULL,
        "timeoutHours" integer NOT NULL,
        "timeoutExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_strikes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "reviews" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reviewerUid" character varying NOT NULL,
        "targetUid" character varying NOT NULL,
        "rating" integer NOT NULL,
        "comment" text NOT NULL,
        "type" character varying NOT NULL,
        "phoneNumberUsed" character varying,
        "flaggedByKeywordScan" boolean NOT NULL DEFAULT false,
        "flaggedByLLM" boolean NOT NULL DEFAULT false,
        "pendingHumanReview" boolean NOT NULL DEFAULT false,
        "approved" boolean NOT NULL DEFAULT false,
        "rejected" boolean NOT NULL DEFAULT false,
        "strikeIssued" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "reviewerId" uuid,
        "targetId" uuid,
        CONSTRAINT "UQ_reviews_pair" UNIQUE ("reviewerUid","targetUid"),
        CONSTRAINT "PK_reviews" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "review_emergency" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reviewerId" uuid NOT NULL,
        "targetId" uuid NOT NULL,
        "used" boolean NOT NULL DEFAULT false,
        "usedAt" TIMESTAMP WITH TIME ZONE,
        "phoneNumberSnapshot" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_emergency" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "message_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "senderUid" character varying NOT NULL,
        "recipientUid" character varying NOT NULL,
        "content" text NOT NULL,
        "imageUrl" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "status" character varying NOT NULL DEFAULT 'pending',
        "acceptedAt" TIMESTAMP WITH TIME ZONE,
        "rejectedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_message_requests" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "matches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userAUid" character varying NOT NULL,
        "userBUid" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "firstMessageAt" TIMESTAMP WITH TIME ZONE,
        "restoredAt" TIMESTAMP WITH TIME ZONE,
        "lastActivityAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        CONSTRAINT "PK_matches" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "likes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "swiperUid" character varying NOT NULL,
        "targetUid" character varying NOT NULL,
        "liked" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "hiddenUntil" TIMESTAMP WITH TIME ZONE,
        "isHidden" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_likes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "blocks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "blockerUid" character varying NOT NULL,
        "blockedUid" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_blocks" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "FK_users_safetyIdentity"
      FOREIGN KEY ("safetyIdentityId")
      REFERENCES "safety_identities"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "purchases"
      ADD CONSTRAINT "FK_purchases_user"
      FOREIGN KEY ("userId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "token_ledger"
      ADD CONSTRAINT "FK_token_ledger_user"
      FOREIGN KEY ("userId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "token_ledger"
      ADD CONSTRAINT "FK_token_ledger_purchase"
      FOREIGN KEY ("purchaseId")
      REFERENCES "purchases"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "profiles"
      ADD CONSTRAINT "FK_profiles_user"
      FOREIGN KEY ("userUid")
      REFERENCES "users"("uid")
    `);

    await queryRunner.query(`
      ALTER TABLE "messages"
      ADD CONSTRAINT "FK_messages_thread"
      FOREIGN KEY ("threadId")
      REFERENCES "threads"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "messages"
      ADD CONSTRAINT "FK_messages_profile"
      FOREIGN KEY ("senderProfileId")
      REFERENCES "profiles"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "review_week_windows"
      ADD CONSTRAINT "FK_review_week_windows_user"
      FOREIGN KEY ("userId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "review_strikes"
      ADD CONSTRAINT "FK_review_strikes_user"
      FOREIGN KEY ("userId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "review_emergency"
      ADD CONSTRAINT "FK_review_emergency_reviewer"
      FOREIGN KEY ("reviewerId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "review_emergency"
      ADD CONSTRAINT "FK_review_emergency_target"
      FOREIGN KEY ("targetId")
      REFERENCES "users"("id")
      ON DELETE CASCADE
    `);
  }

  public down(): Promise<void> {
    throw new Error("Down migration intentionally disabled for baseline Init");
  }
}
