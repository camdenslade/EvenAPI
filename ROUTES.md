# Backend Routes Developer Guide

Canonical base URL: `https://api.evendating.us/api` (or `EXPO_PUBLIC_API_BASE_URL`). All non-public routes are protected by the global Cognito/Firebase auth guard and expect `Authorization: Bearer <idToken>`. Admin routes additionally require `AdminGuard` and are audited by `AdminAuditInterceptor`. Unless stated otherwise, responses are JSON and errors are standard HTTP errors with a message.

## Public Endpoints (no auth)
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| POST | `/auth/phone/start` | Start phone auth challenge. | `{ phoneNumber }` | Normalizes to E.164, carrier/ratelimit checks. Demo numbers return mock session. |
| POST | `/auth/phone/resend` | Resend phone code. | `{ phoneNumber }` | Same validation as `start`. |
| POST | `/auth/phone/verify` | Verify SMS code and issue tokens. | `{ phoneNumber, code, session }` | Returns `{ accessToken, refreshToken, idToken, expiresIn, tokenType }`. Demo bypass supports secret code. |
| POST | `/auth/refresh` | Disabled identity rehydration endpoint. | `{ uid }` (ignored) | Always 401 Unauthorized (kept for compatibility). |
| POST | `/purchases/webhook/apple` | Handle App Store Server Notifications v2. | `{ signedPayload }` | Verifies and revokes entitlements on refund/revoke. |
| POST | `/support` | Submit a support ticket. | `{ name, email, category, priority, subject, description }` | Rate-limited, input sanitized and validated. |
| POST | `/suggestions` | Submit a product suggestion. | `{ name, email, category, subject, suggestion }` | Rate-limited, input sanitized and validated. |
| POST | `/admin/login` | Admin login bootstrap. | `{ email, password }` | Exchanges admin app client creds for access/refresh tokens via Cognito (supports client secret). |

## Authenticated User Endpoints
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| GET | `/me` | Fetch current profile (alias of `/profiles/me`). | – | Requires auth. |

### Auth / Email
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| POST | `/auth/logout` | Log out (token revocation stub). | – | Logs request; Cognito manages revocation. |
| POST | `/auth/update-email` | Send school email verification code. | `{ email }` | Validates allowed school domains, rate-limits (3/15m), fails if already verified. |
| POST | `/auth/verify-email` | Verify code and mark email verified. | `{ email, code }` | Updates school email; grants 1 search token for first-time missouristate.edu verification when unused elsewhere. |

### Users
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| GET | `/users/me` | Ensure user exists and return user DTO. | – | Syncs email from auth; phone never returned. |
| POST | `/users/update-location` | Update latitude/longitude. | `{ latitude, longitude }` | Timestamps last location update. |
| DELETE | `/users/me` | Hard-delete account and all data. | – | Persists safety identity metadata; tokens/purchases removed. |
| POST | `/users/push-token` | Save Expo push token. | `{ token }` | – |
| GET | `/users/theme-presets` | Fetch saved theme presets. | – | – |
| POST | `/users/theme-presets` | Save theme presets. | `{ presets: any[] }` | – |
| POST | `/users/me/soft-delete` | Hide account / clear data but keep link to purchases. | `{ reason? }` | Tokens/purchases remain linked. |

### Profiles
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| GET | `/profiles/status` | Check if profile is complete. | – | – |
| GET | `/profiles/upload-url` | Get presigned URLs for photo upload (orig/derived). | – | – |
| GET | `/profiles/derived-upload-url` | Get presigned URL for derived (cropped) upload. | `originalKey?` | Preserves original key. |
| POST | `/profiles/setup` | Create or update onboarding profile. | `SetupProfileDto` | – |
| GET | `/profiles/queue` | Get swipe queue. | – | Randomized queue with distance. |
| GET | `/profiles/me` | Get own profile. | – | – |
| PATCH | `/profiles/me` | Partial profile update. | `UpdateProfileDto` | Invalid enums stripped. |
| DELETE | `/profiles/me` | Delete profile + photos + user account. | – | – |
| PATCH | `/profiles/me/photos` | Replace photo array. | `{ photos: string[] }` | – |
| DELETE | `/profiles/me/photo/:index` | Delete photo by index. | – | Index is zero-based. |
| GET | `/profiles/:uid` | Public profile lookup. | – | By Firebase UID. |
| PATCH | `/profiles/me/pause` | Pause (hide) profile. | – | – |
| PATCH | `/profiles/me/unpause` | Unpause profile. | – | – |
| PATCH | `/profiles/update-location` | Update location (lat/lng). | `{ lat, lng }` | Uses ProfilesService path; same as users update. |
| GET | `/profiles/me/photo-statuses` | List moderation statuses for photos. | – | – |

### Search
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| GET | `/search/name` | Search users by first name within radius. | `name` (required), `radius` miles (optional, default 25) | Consumes a search token unless unlimited flags; returns profile previews with distance and rating summaries. |

### Likes & Matches
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| POST | `/like` | Like a user (swipe right). | `{ targetUid }` | Returns match status and `matchId` if mutual. |
| POST | `/like/undo` | Consume undo token for last swipe. | – | 403 if no undo tokens. |
| GET | `/matches/me` | List matches for user. | – | Active/restored only. |
| POST | `/matches` | Manually create a match. | `{ targetId }` | Used for simultaneous likes/testing. |
| DELETE | `/matches/:id` | Expire/unmatch. | – | – |

### Chat
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| GET | `/chat/threads` | Get chat thread previews. | – | – |
| GET | `/chat/messages/:threadId` | Get messages in a thread. | – | Verifies requester can access thread. |
| POST | `/chat/messages/:matchId` | Send a message. | `{ content }` | Rejects empty/whitespace content. |

### Message Requests
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| GET | `/message-request/pending` | List pending requests received. | – | Includes sender profile data. |
| POST | `/message-request` | Send a message request. | `{ recipientUid, content, imageUrl? }` | Validates 1–500 chars. |
| POST | `/message-request/:id/accept` | Accept a request. | – | Creates chat/match as service dictates. |
| POST | `/message-request/:id/reject` | Reject a request. | – | – |

### Reviews
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| POST | `/reviews` | Create a review. | `CreateReviewDto` | Reviewer inferred from auth. |
| GET | `/reviews/user/:uid` | List reviews about user. | – | – |
| GET | `/reviews/user/:uid/average` | Average rating for user. | – | 1 decimal or null. |
| GET | `/reviews/user/:uid/summary` | Average + count for user. | – | – |
| GET | `/reviews/me` | Reviews received by current user. | – | – |
| GET | `/reviews/sent/:uid` | Reviews authored by given user. | – | – |
| GET | `/reviews/summary/me` | Average, count, and weekly usage for current user. | – | Weekly usage returned as DTO. |
| GET | `/reviews/me/week-usage` | Weekly review usage. | – | – |
| GET | `/reviews/me/emergency-used` | Whether emergency review was used. | – | `{ used: boolean }`. |

### Reports
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| POST | `/reports/users/:targetUid` | Report a user. | `{ reason? }` | Idempotent; always 2xx. |
| POST | `/reports/content` | Report content. | `{ contentType, contentId, reason? }` | `contentType` in `message|photo|profile|other`. |

### Purchases
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| POST | `/purchases/verify` | Verify in-app purchase receipt. | `{ platform: "ios"|"android", receipt }` | Grants tokens/subscriptions. |
| POST | `/purchases/restore` | Restore subscriptions/consumables. | `{ platform, receipt }` | Uses storePurchaseIdentifier to restore after deletion. |

### Blocks
| Method | Path | Purpose | Body / Query | Notes |
| --- | --- | --- | --- | --- |
| POST | `/blocks/:targetUid` | Block a user. | – | Creates social block + persistent SafetyExclusion. |
| DELETE | `/blocks/:targetUid` | Unblock socially. | – | SafetyExclusion persists for abuse prevention. |

## Admin Endpoints (AdminGuard + audit)
All under `/admin`. Used by ops dashboards; never exposed to clients. Key groups:
*Auth options:* Default is bearer token validated against the `admins` table. You can bypass token auth from trusted IPs by setting `ADMIN_IP_WHITELIST` (or AWS Secrets Manager secret `admin-ip-whitelist`) to a comma-separated list; the guard checks `x-forwarded-for` first, then `req.ip`.

### Admin registry
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/admins` | List admin accounts. |
| POST | `/admin/admins` | Create admin (email + uid). |
| DELETE | `/admin/admins/:uid` | Remove admin. |

### Grants and user lookup
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/admin/grant` | Grant tokens/subscription via `GrantDto`. |
| GET | `/admin/users/:uid` | Get user details. |
| GET | `/admin/users/:uid/flags` | Get per-user override flags. |
| PATCH | `/admin/users/:uid/flags` | Update override flags (unlimited search/undo/message). |
| GET | `/admin/users` | Admin name search (partial, case-insensitive). |

### Reports moderation
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/reports` | List reports (filter by status). |
| GET | `/admin/reports/:id` | Get report. |
| PATCH | `/admin/reports/:id` | Update report (assignedTo, notes, status, evidence). |
| POST | `/admin/reports/:id/resolve` | Resolve report with notes. |

### Photos moderation
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/photos` | List photos (filter by status). |
| POST | `/admin/photos/:id/approve` | Approve photo (reason/confidence optional). |
| POST | `/admin/photos/:id/reject` | Reject photo (reason/confidence optional). |
| POST | `/admin/photos/bulk` | Bulk approve/reject photos. |
| POST | `/admin/photos/:id/requeue` | Requeue photo to vision/human queue. |
| DELETE | `/admin/photos/:id` | Delete photo (DB + S3). |

### Audit/logging
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/audit` | List admin audit events (limit/offset). |
| GET | `/admin/logs` | Log snapshots stub. |
| GET | `/admin/jobs` | Background jobs stub. |
| GET | `/admin/health` | Health info stub. |

### Reviews and strikes
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/reviews` | List reviews (filter by status/target/reviewer). |
| PATCH | `/admin/reviews/:id` | Update review moderation flags. |
| POST | `/admin/reviews/:id/strike` | Issue strike for review target. |
| DELETE | `/admin/reviews/:id/strike` | Remove strike for review target. |
| POST | `/admin/users/:uid/unblock-review-timeout` | Remove review timeout for user. |
| GET | `/admin/reviews/user/:uid` | Get reviews about user (admin view). |
| GET | `/admin/reviews/user/:uid/average` | Average rating (admin view). |
| GET | `/admin/reviews/sent/:uid` | Reviews sent by user (admin view). |

### Matches, chat oversight, and messaging
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/users/:uid/matches` | Get user matches. |
| POST | `/admin/matches/:matchId/unmatch` | Force unmatch. |
| GET | `/admin/matches/:matchId/messages` | View messages in match. |
| POST | `/admin/users/:uid/mute-chat` | Mute chat for user. |
| POST | `/admin/users/:uid/clear-message-tokens` | Clear message tokens. |

### User management
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/admin/users/:uid/impersonate` | Generate impersonation token/session. |
| PATCH | `/admin/users/:uid/pause` | Pause user. |
| PATCH | `/admin/users/:uid/unpause` | Unpause user. |
| DELETE | `/admin/users/:uid` | Delete user. |
| POST | `/admin/users/:uid/reset-review-timeout` | Reset review timeout. |
| POST | `/admin/users/:uid/reset-strikes` | Reset strikes. |
| POST | `/admin/users/:uid/revoke-sessions` | Revoke sessions. |
| PATCH | `/admin/users/:uid/role` | Set role (`user`/`admin`). |
| POST | `/admin/users/:uid/resend-verification` | Resend email verification. |
| GET | `/admin/users/:uid/strikes` | Get strike count. |
| GET | `/admin/users/stats` | User stats (total/active). |
| GET | `/admin/profiles/:uid` | Profile data for admin view. |
| POST | `/admin/users/:uid/export` | Start data export. |
| GET | `/admin/users/:uid/export/:jobId` | Check export status. |

### Tokens & subscription
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/users/:uid/tokens` | Get token balances (search/message/undo). |
| POST | `/admin/users/:uid/tokens/grant` | Grant tokens. |
| POST | `/admin/users/:uid/tokens/revoke` | Revoke tokens (consume). |
| PATCH | `/admin/users/:uid/subscription` | Update subscription flags/expiry. |

### Ban management
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/admin/users/:uid/ban` | Ban user (reason optional). |
| POST | `/admin/users/:uid/unban` | Unban user. |

### Rate limiting
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/rate-limit/buckets` | List rate-limit buckets. |
| DELETE | `/admin/rate-limit/buckets/:key` | Clear bucket. |
| POST | `/admin/rate-limit/whitelist` | Whitelist IP. |
| POST | `/admin/rate-limit/blacklist` | Blacklist IP. |

### Swipe queue debug
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/queue/:uid` | Inspect swipe/search queue for user. |
| POST | `/admin/queue/:uid/rebuild` | Rebuild queue. |

### Push/email tests
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/admin/users/:uid/test-push` | Send test push. |
| POST | `/admin/users/:uid/test-email` | Send test email. |
| GET | `/admin/users/:uid/push-log` | Fetch push log. |
