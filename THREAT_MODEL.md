# Threat Model

This document outlines the security threats considered in the application design and the mitigations implemented.

## Authentication Bypass Attempts

### Threat: Invalid or Forged Tokens

**Attack Vector:**
- Attacker attempts to access API endpoints with invalid, expired, or forged Firebase ID tokens
- Attacker tries to bypass authentication by omitting Authorization header
- Attacker attempts to use tokens from other applications

**Mitigations:**
- Global `FirebaseAuthGuard` enforces authentication on all endpoints
- Token verification uses Firebase Admin SDK with revocation check (`verifyIdToken(token, true)`)
- Missing or invalid tokens result in `401 Unauthorized` response
- No endpoints are publicly accessible without authentication
- Token validation occurs on every request (no caching of auth state)

### Threat: Token Replay Attacks

**Attack Vector:**
- Attacker intercepts valid token and attempts to reuse it after revocation
- Attacker uses stolen token to impersonate user

**Mitigations:**
- Token verification includes revocation check (`true` parameter)
- Tokens are short-lived (Firebase default TTL)
- No token storage in backend - tokens are validated fresh on each request
- WebSocket connections re-verify token on connection establishment

### Threat: Admin Privilege Escalation

**Attack Vector:**
- Regular user attempts to access admin endpoints
- User attempts to modify role field directly

**Mitigations:**
- Admin endpoints protected by `AdminGuard` in addition to `FirebaseAuthGuard`
- Admin role assignment is server-side only (not user-modifiable)
- Role field in User entity is not exposed in update endpoints
- Admin operations require explicit admin role check

## Enumeration Risks

### Threat: User Enumeration via API Responses

**Attack Vector:**
- Attacker attempts to enumerate valid user UIDs by probing endpoints
- Attacker tries to determine if email/phone exists in system
- Attacker attempts to discover user relationships through API responses

**Mitigations:**
- Generic error messages for authentication failures (no distinction between invalid user vs invalid password)
- User lookup endpoints return generic "not found" errors
- Phone numbers are never returned in API responses
- Email addresses are only returned to authenticated user for their own account
- Profile endpoints validate user access before returning data
- No public user search by email or phone number

### Threat: Profile Enumeration

**Attack Vector:**
- Attacker attempts to enumerate all user profiles
- Attacker tries to discover user relationships (matches, likes)

**Mitigations:**
- Profile endpoints require authentication
- Users can only access profiles they have permission to view (matches, message requests)
- Search endpoints require authentication and apply distance/like filtering
- No public profile listing endpoints
- Pagination limits prevent bulk enumeration

## Abuse / Ban Evasion Mitigation (SafetyIdentity)

### Threat: Account Recreation After Ban

**Attack Vector:**
- Banned user deletes account and creates new account with same phone number
- User attempts to reset strikes by deleting and recreating account
- User attempts to reuse emergency review by recreating account

**Mitigations:**
- `SafetyIdentity` entity persists indefinitely, even after account deletion
- SafetyIdentity is tied to phone number hash (not user account)
- Phone number hashing prevents direct lookup but enables fraud detection
- SafetyIdentity tracks: `emergencyUsed`, `strikes`, `lastReviewTimeout`, `deletedCount`
- SafetyExclusion records persist across account deletion (ON DELETE RESTRICT)
- Account deletion does not reset SafetyIdentity metadata
- New accounts with same phone hash inherit previous SafetyIdentity state

### Threat: Strike Reset Manipulation

**Attack Vector:**
- User attempts to reset review strikes by deleting account
- User tries to bypass review timeout by recreating account

**Mitigations:**
- Review strikes are tracked in SafetyIdentity (persists across deletions)
- Review timeout is stored in SafetyIdentity (`lastReviewTimeout`)
- Account deletion does not clear SafetyIdentity strike count
- New accounts inherit existing strikes and timeouts from SafetyIdentity

### Threat: Emergency Review Abuse

**Attack Vector:**
- User attempts to use emergency review multiple times by recreating account
- User tries to bypass emergency review restrictions

**Mitigations:**
- Emergency review usage tracked in SafetyIdentity (`emergencyUsed` flag)
- Flag persists across account deletion
- New accounts with same phone hash cannot use emergency review if already used
- Emergency review requires verified phone number (SafetyIdentity must exist)

### Threat: Rapid Account Creation/Deletion

**Attack Vector:**
- User rapidly creates and deletes accounts to reset state
- User attempts to bypass rate limits by creating multiple accounts

**Mitigations:**
- SafetyIdentity tracks `deletedCount` to detect abuse patterns
- Phone number hashing prevents easy account recreation
- Rate limiting applies per endpoint (not per account)
- Account creation requires Firebase authentication (not easily automated)

## File Upload / MIME Surface

### Threat: Malicious File Uploads

**Attack Vector:**
- Attacker uploads executable files disguised as images
- Attacker attempts to upload files with dangerous MIME types
- Attacker tries to upload oversized files to cause DoS

**Mitigations:**
- **MIME Type Allow-List:** Only `image/jpeg`, `image/jpg`, `image/png`, `image/webp` are allowed
- MIME type validation occurs before presigned URL generation
- Content type must be specified and validated at upload request time
- **File Size Limit:** Maximum 10 MB per file
- File size validation occurs before presigned URL generation
- S3 bucket policies restrict uploads to allowed content types

### Threat: Presigned URL Abuse

**Attack Vector:**
- Attacker attempts to use presigned URLs for unauthorized uploads
- Attacker tries to upload files to arbitrary S3 paths
- Attacker attempts to overwrite other users' files

**Mitigations:**
- Presigned URLs are generated with unique keys (UUID-based)
- URLs are time-limited (default S3 presigned URL expiration)
- File keys are not predictable (UUID generation)
- S3 bucket policies restrict upload operations to specific paths
- HTTPS-only presigned URLs enforced

### Threat: Content-Type Spoofing

**Attack Vector:**
- Attacker uploads malicious file but claims it's an image
- Attacker attempts to bypass MIME type validation

**Mitigations:**
- MIME type must be validated before presigned URL generation
- S3 presigned URL includes `ContentType` parameter (enforced by S3)
- Client must upload with matching Content-Type header
- S3 bucket policies can enforce Content-Type matching

## Defensive Assumptions

### Assumption: Frontend Cannot Be Trusted

**Defensive Measures:**
- All authentication occurs backend-only
- All authorization checks occur server-side
- Input validation occurs on backend (DTO validation)
- Business logic is enforced server-side
- Frontend is treated as a presentation layer only

### Assumption: Network Traffic Can Be Intercepted

**Defensive Measures:**
- All API communication uses HTTPS
- Firebase tokens are short-lived
- No long-lived session tokens
- Presigned URLs are time-limited
- Sensitive data is never transmitted in URLs or query parameters

### Assumption: Database Can Be Compromised

**Defensive Measures:**
- Phone numbers are hashed (not reversible without salt)
- Passwords are not stored (Firebase handles authentication)
- Sensitive data is encrypted at rest (database encryption)
- PII is minimized in database schema
- SafetyIdentity records persist for fraud detection even if user data is deleted

### Assumption: Secrets May Leak

**Defensive Measures:**
- Secrets stored in AWS Secrets Manager (not in code or environment files)
- Secrets are rotated regularly
- IAM roles used for AWS access (no hardcoded credentials)
- Environment variables validated at startup (fail fast if missing)
- No secrets in logs (sanitization applied)

### Assumption: Rate Limiting Can Be Bypassed

**Defensive Measures:**
- Rate limiting applied at middleware level (before request processing)
- Multiple rate limit tiers (auth, reports, blocks, default)
- Rate limit headers included in responses
- Future: Redis-backed rate limiting for distributed deployments
- Monitoring and alerting for rate limit violations

### Assumption: Error Messages May Leak Information

**Defensive Measures:**
- Generic error messages in production responses
- Stack traces never included in production
- PII sanitization in all error responses
- Detailed errors logged server-side only
- Error responses include minimal information (status, generic message, path)

### Assumption: Users May Attempt to Abuse Features

**Defensive Measures:**
- Review system with strike tracking
- Emergency review one-time use enforcement
- Message request limits and validation
- Like expiration and hiding mechanisms
- Match expiration and revival rules
- SafetyExclusion for persistent blocking

