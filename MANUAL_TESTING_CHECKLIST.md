# Manual Testing Checklist - Pre-Launch QA

## Authentication & Account Lifecycle

### Happy Paths
- [ ] Sign up with phone number, receive SMS code, enter code, complete authentication - Expected: User authenticated, navigated to onboarding - Severity: P0
- [ ] Sign in with existing phone number, receive SMS code, enter code - Expected: User authenticated, navigated to app - Severity: P0
- [ ] Sign in with Google OAuth on Android device - Expected: User authenticated, navigated to onboarding or app - Severity: P0
- [ ] Sign in with Apple Sign-In on iOS device - Expected: User authenticated, navigated to onboarding or app - Severity: P0
- [ ] Sign out from settings screen - Expected: Tokens revoked server-side, Firebase signed out, navigated to login - Severity: P0
- [ ] Update email address in settings, save - Expected: Email updated in backend, reflected in UI - Severity: P0
- [ ] Pause account from settings, confirm - Expected: Profile marked as paused, hidden from discovery - Severity: P0
- [ ] Resume paused account from settings, confirm - Expected: Profile marked as active, visible in discovery - Severity: P0
- [ ] Delete account from settings, confirm deletion - Expected: Account deleted, all data removed, SafetyIdentity preserved, purchases soft-deleted, navigated to login - Severity: P0

### Edge Cases
- [ ] Sign up with phone number, enter incorrect SMS code 3 times - Expected: Error message displayed, option to resend code - Severity: P1
- [ ] Sign in with Google OAuth on iOS device - Expected: Error message displayed, fallback to phone auth suggested - Severity: P1
- [ ] Sign in with Apple Sign-In on Android device - Expected: Error message displayed, fallback to phone auth suggested - Severity: P1
- [ ] Attempt to sign in with revoked Firebase token - Expected: 401 error, user logged out, navigated to login - Severity: P0
- [ ] Update email with invalid format (no @ symbol) - Expected: Validation error, email not saved - Severity: P1
- [ ] Attempt to delete account while having active matches - Expected: Account deleted, matches removed, messages removed - Severity: P0
- [ ] Delete account, then sign up again with same phone number - Expected: New account created, SafetyIdentity linked, previous safety metadata preserved - Severity: P0
- [ ] Sign out on device A, verify tokens revoked, attempt to use app on device B with same account - Expected: Device B receives 401, forced to re-authenticate - Severity: P0

### Failure States
- [ ] Attempt sign up with phone number, SMS service unavailable - Expected: Error message displayed, retry option available - Severity: P0
- [ ] Attempt Google OAuth, network failure during token exchange - Expected: Error message displayed, navigation to login - Severity: P0
- [ ] Attempt Apple Sign-In, user cancels authentication - Expected: Navigation back to login screen, no error - Severity: P2
- [ ] Attempt to update email, backend returns 500 error - Expected: Error message displayed, email not updated - Severity: P1
- [ ] Attempt to pause account, backend unavailable - Expected: Error message displayed, account state unchanged - Severity: P1
- [ ] Attempt to delete account, backend returns error - Expected: Error message displayed, account not deleted - Severity: P0
- [ ] Sign out, network failure during token revocation - Expected: Client-side logout proceeds, error logged - Severity: P1

## Onboarding Flow

### Happy Paths
- [ ] Complete onboarding with all required fields (name, age, sex, sex preference, bio, photos, birthday, height, location) - Expected: Profile created, navigated to swipe screen - Severity: P0
- [ ] Complete onboarding with Google OAuth pre-filled name and email - Expected: Name and email pre-filled in forms - Severity: P1
- [ ] Complete onboarding with Apple Sign-In pre-filled name and email - Expected: Name and email pre-filled in forms - Severity: P1
- [ ] Upload multiple photos during onboarding (up to 6) - Expected: All photos uploaded to S3, moderation status pending - Severity: P0
- [ ] Skip optional fields during onboarding - Expected: Profile created with available data, navigated to swipe screen - Severity: P1

### Edge Cases
- [ ] Start onboarding, close app mid-flow, reopen app - Expected: Redirected to onboarding, previous progress lost - Severity: P1
- [ ] Upload photo during onboarding, photo fails moderation - Expected: Photo flagged, user notified, can upload replacement - Severity: P0
- [ ] Complete onboarding with minimum age (18) - Expected: Profile created successfully - Severity: P1
- [ ] Complete onboarding with maximum age (60) - Expected: Profile created successfully - Severity: P1
- [ ] Complete onboarding without providing location permission - Expected: Location permission requested, onboarding blocked until granted - Severity: P0
- [ ] Upload photo larger than maximum file size - Expected: Error message displayed, upload rejected - Severity: P1
- [ ] Upload photo with unsupported MIME type - Expected: Error message displayed, upload rejected - Severity: P1

### Failure States
- [ ] Submit onboarding form, backend returns 500 error - Expected: Error message displayed, form data preserved - Severity: P0
- [ ] Upload photo during onboarding, S3 service unavailable - Expected: Error message displayed, upload retry option - Severity: P0
- [ ] Complete onboarding, profile creation fails due to duplicate UID - Expected: Error message displayed, retry option - Severity: P0
- [ ] Submit onboarding with invalid date format - Expected: Validation error, submission blocked - Severity: P1

## Profile Creation & Editing

### Happy Paths
- [ ] View own profile from profile screen - Expected: All profile data displayed correctly - Severity: P1
- [ ] Edit profile, update bio and personal details - Expected: Changes saved, reflected immediately in UI - Severity: P1
- [ ] Add new photo to profile (not during onboarding) - Expected: Photo uploaded, added to profile, moderation status pending - Severity: P0
- [ ] Delete photo from profile by index - Expected: Photo removed from profile, deleted from S3 - Severity: P0
- [ ] Update profile location via location picker - Expected: Location updated in backend, distance calculations updated - Severity: P0
- [ ] View photo moderation statuses - Expected: Status displayed for each photo (approved/flagged/rejected) - Severity: P1

### Edge Cases
- [ ] Edit profile, update bio to maximum length - Expected: Bio saved successfully - Severity: P1
- [ ] Edit profile, update bio to empty string - Expected: Validation error or empty bio saved - Severity: P1
- [ ] Add 6th photo to profile (maximum) - Expected: Photo added, upload button disabled or hidden - Severity: P1
- [ ] Delete all photos from profile - Expected: Profile image set to default, no photos remaining - Severity: P1
- [ ] Update location to coordinates outside supported region - Expected: Location updated or validation error - Severity: P1
- [ ] View profile with all photos in moderation queue - Expected: Moderation status displayed for each photo - Severity: P1

### Failure States
- [ ] Attempt to edit profile, backend returns 401 - Expected: User logged out, navigated to login - Severity: P0
- [ ] Attempt to add photo, S3 presigned URL generation fails - Expected: Error message displayed, upload blocked - Severity: P0
- [ ] Attempt to delete photo, S3 delete fails - Expected: Error message displayed, photo may remain in UI - Severity: P1
- [ ] Update profile, network timeout - Expected: Error message displayed, changes not saved - Severity: P1

## Photo Uploads & Media Handling

### Happy Paths
- [ ] Upload photo via presigned URL, verify photo appears in profile - Expected: Photo uploaded to S3, URL stored in database, displayed in profile - Severity: P0
- [ ] View photo in profile, verify image loads correctly - Expected: Photo displayed from S3 URL - Severity: P1
- [ ] Upload photo, verify moderation status changes from pending to approved - Expected: Status updated after Google Vision API processing - Severity: P0
- [ ] Upload photo with adult content, verify moderation flags it - Expected: Photo flagged or rejected, user notified - Severity: P0

### Edge Cases
- [ ] Upload photo, immediately view profile before moderation completes - Expected: Photo displayed with pending status - Severity: P1
- [ ] Upload photo with file size exactly at maximum limit - Expected: Upload succeeds - Severity: P1
- [ ] Upload photo with file size one byte over maximum - Expected: Upload rejected with error - Severity: P1
- [ ] Upload photo, verify presigned URL expires after use - Expected: URL cannot be reused for second upload - Severity: P1
- [ ] Upload photo, delete photo before moderation completes - Expected: Photo deleted, moderation job may fail silently - Severity: P1
- [ ] Upload multiple photos rapidly in sequence - Expected: All uploads succeed, all photos appear in profile - Severity: P1

### Failure States
- [ ] Attempt to upload photo, S3 service unavailable - Expected: Error message displayed, upload fails - Severity: P0
- [ ] Attempt to upload photo, presigned URL generation fails - Expected: Error message displayed, upload blocked - Severity: P0
- [ ] Upload photo, Google Vision API unavailable - Expected: Photo approved by default with warning logged - Severity: P0
- [ ] Upload photo, network failure during upload - Expected: Error message displayed, upload retry option - Severity: P1
- [ ] View photo, S3 URL returns 403 or 404 - Expected: Default placeholder image displayed, error logged - Severity: P1

## Swipe / Discovery Logic

### Happy Paths
- [ ] Load swipe screen, verify queue populated with profiles - Expected: Profiles displayed, filtered by preferences - Severity: P0
- [ ] Swipe right (like) on profile - Expected: Profile removed from queue, like recorded, match modal if mutual - Severity: P0
- [ ] Swipe left (skip) on profile - Expected: Profile removed from queue, not shown again - Severity: P0
- [ ] Swipe through multiple profiles, verify queue advances correctly - Expected: Each swipe shows next profile, no duplicates - Severity: P0
- [ ] Use shuffle button to refresh queue - Expected: New profiles loaded, seen profiles reset - Severity: P1
- [ ] Swipe on profile, verify distance displayed correctly - Expected: Distance calculated using Haversine formula - Severity: P1
- [ ] Swipe on profile outside distance preference - Expected: Profile not shown (unless showOutsideRange enabled) - Severity: P0
- [ ] Swipe on profile outside age range - Expected: Profile not shown - Severity: P0
- [ ] Swipe on profile with mismatched sex preference - Expected: Profile not shown - Severity: P0

### Edge Cases
- [ ] Swipe through entire queue until empty - Expected: Empty state displayed, shuffle button available - Severity: P1
- [ ] Swipe on profile, immediately swipe again before animation completes - Expected: Second swipe ignored or queued - Severity: P1
- [ ] Swipe on profile with no photos - Expected: Default avatar displayed - Severity: P1
- [ ] Swipe on profile with all photos in moderation (pending) - Expected: Profile shown with available photos or default - Severity: P1
- [ ] Swipe on profile, verify compatibility score affects ordering - Expected: Higher compatibility profiles appear first - Severity: P1
- [ ] Swipe on profile outside hard filters but within soft preferences - Expected: Profile shown if queue is empty and showOutsideRange enabled - Severity: P1
- [ ] Swipe on profile, verify Redis cache invalidated after like - Expected: Queue refreshed on next load - Severity: P0
- [ ] Load swipe screen with stale Redis cache - Expected: Stale data served initially, refreshed on next request - Severity: P1
- [ ] Swipe on profile already liked by current user - Expected: Profile not shown in queue - Severity: P0
- [ ] Swipe on profile already matched with current user - Expected: Profile not shown in queue - Severity: P0
- [ ] Swipe on profile blocked by current user - Expected: Profile not shown in queue - Severity: P0
- [ ] Swipe on profile with active hide window (30 days) - Expected: Profile not shown in queue - Severity: P0
- [ ] Swipe on profile with expired match (14 days, no messages) - Expected: Profile not shown in queue - Severity: P0
- [ ] Swipe on profile with safety exclusion - Expected: Profile not shown in queue - Severity: P0

### Failure States
- [ ] Load swipe screen, backend returns 500 error - Expected: Error message displayed, retry option - Severity: P0
- [ ] Swipe right on profile, like API call fails - Expected: Error message displayed, profile may remain in queue - Severity: P0
- [ ] Load swipe screen, Redis unavailable - Expected: Queue loaded from database, slower response - Severity: P1
- [ ] Swipe on profile, location calculation fails - Expected: Distance not displayed or default value shown - Severity: P1
- [ ] Load swipe screen with no location set - Expected: Location permission requested, queue blocked until granted - Severity: P0

## Matching Logic

### Happy Paths
- [ ] Swipe right on profile that already liked current user - Expected: Match created immediately, match modal displayed - Severity: P0
- [ ] View matches screen, verify all matches displayed - Expected: All active matches shown with profile photos and names - Severity: P1
- [ ] Swipe right on profile, other user swipes right later - Expected: Match created when other user swipes, both users notified - Severity: P0
- [ ] View match details, verify match creation timestamp - Expected: Timestamp displayed correctly - Severity: P2
- [ ] Match created, verify 14-day expiration timer starts - Expected: Timer visible or expiration date displayed - Severity: P1
- [ ] Send first message in match, verify match expiration prevented - Expected: Match expiration extended, match remains active - Severity: P0
- [ ] Match expires after 14 days with no messages, verify match removed - Expected: Match no longer visible, users can match again - Severity: P0
- [ ] Send message to expired match, verify match restored - Expected: Match reactivated, visible in matches list - Severity: P0

### Edge Cases
- [ ] Create match, immediately check matches screen - Expected: Match appears in list - Severity: P1
- [ ] Create match, verify both users see same match - Expected: Match visible to both users - Severity: P0
- [ ] Create match with user who has safety exclusion - Expected: Match creation blocked, safety exclusion enforced - Severity: P0
- [ ] Create match, verify match ID consistent across both users - Expected: Same match ID for both users - Severity: P1
- [ ] Match expires, verify users can like each other again - Expected: New like creates new match - Severity: P1
- [ ] Create match, send message at 13 days 23 hours - Expected: Match expiration prevented, match remains active - Severity: P1
- [ ] Create match, send message at exactly 14 days - Expected: Match expiration prevented or match already expired - Severity: P1

### Failure States
- [ ] Swipe right on profile, match creation API fails - Expected: Error message displayed, match not created - Severity: P0
- [ ] Create match, backend database error during match creation - Expected: Error message displayed, match not created - Severity: P0
- [ ] View matches screen, backend returns 500 error - Expected: Error message displayed, matches not loaded - Severity: P1
- [ ] Match expiration cron job fails - Expected: Matches not expired, manual intervention required - Severity: P1

## Messaging & Realtime Updates

### Happy Paths
- [ ] Open chat with match, send message - Expected: Message sent, appears in chat immediately - Severity: P0
- [ ] Send message, verify other user receives via Socket.IO - Expected: Message appears in real-time on other device - Severity: P0
- [ ] Receive message from match, verify push notification sent - Expected: Push notification received on device - Severity: P0
- [ ] Open chat thread, verify message history loads - Expected: All previous messages displayed in chronological order - Severity: P1
- [ ] Send multiple messages rapidly - Expected: All messages sent and received in order - Severity: P1
- [ ] Open chat, verify auto-scroll to bottom on new messages - Expected: Chat scrolls to latest message - Severity: P2
- [ ] Send message in expired match, verify match restored - Expected: Match reactivated, message sent successfully - Severity: P0
- [ ] Create message request, other user accepts - Expected: Match created, thread created, both users can chat - Severity: P0
- [ ] Create message request, other user rejects - Expected: Request removed, 30-day hide window set - Severity: P0
- [ ] View messages screen, verify threads and pending requests displayed - Expected: All threads and requests shown correctly - Severity: P1

### Edge Cases
- [ ] Send message, immediately close chat before delivery - Expected: Message queued, sent when chat reopened - Severity: P1
- [ ] Send message, network disconnects during send - Expected: Message queued, sent when connection restored - Severity: P1
- [ ] Receive message while chat screen is open - Expected: Message appears immediately via Socket.IO - Severity: P0
- [ ] Receive message while chat screen is closed - Expected: Push notification received, message appears when chat opened - Severity: P0
- [ ] Send very long message (1000+ characters) - Expected: Message sent successfully, displayed correctly - Severity: P1
- [ ] Send message with special characters and emojis - Expected: Message sent and displayed correctly - Severity: P1
- [ ] Open chat with match, verify only matched users can access - Expected: Unauthorized users receive 403 error - Severity: P0
- [ ] Create message request, verify token consumed for non-subscribed user - Expected: Token decremented, request created - Severity: P0
- [ ] Create message request without sufficient tokens - Expected: Error message displayed, request not created - Severity: P0
- [ ] Create message request to user who already sent request - Expected: Auto-accept, match created immediately - Severity: P0
- [ ] Create message request to user who already liked current user - Expected: Auto-accept, match created immediately - Severity: P0
- [ ] Send message, verify Socket.IO reconnection on network restore - Expected: Connection restored, messages resume - Severity: P1

### Failure States
- [ ] Send message, backend returns 500 error - Expected: Error message displayed, message not sent - Severity: P0
- [ ] Send message, Socket.IO connection fails - Expected: Error message displayed, message queued for retry - Severity: P1
- [ ] Open chat, message history API fails - Expected: Error message displayed, chat empty or loading state - Severity: P1
- [ ] Receive push notification, notification service unavailable - Expected: Notification not sent, error logged - Severity: P1
- [ ] Create message request, backend validation fails - Expected: Error message displayed, request not created - Severity: P0
- [ ] Send message, Firebase token expired during send - Expected: 401 error, user logged out - Severity: P0

## Purchases, Tokens & Entitlements

### Happy Paths
- [ ] Complete in-app purchase for undo tokens (Apple) - Expected: Purchase recorded, tokens granted, receipt validated - Severity: P0
- [ ] Complete in-app purchase for undo tokens (Google) - Expected: Purchase recorded, tokens granted, receipt validated - Severity: P0
- [ ] Complete in-app purchase for search tokens - Expected: Purchase recorded, tokens granted - Severity: P0
- [ ] Complete in-app purchase for message request tokens - Expected: Purchase recorded, tokens granted - Severity: P0
- [ ] Subscribe to premium subscription - Expected: Subscription active, tokens granted monthly - Severity: P0
- [ ] Use undo token to undo last swipe - Expected: Token consumed, profile restored to queue - Severity: P0
- [ ] Use search token to search for user - Expected: Token consumed, search results displayed - Severity: P0
- [ ] Use message request token to send message request - Expected: Token consumed, request created - Severity: P0
- [ ] Receive monthly baseline grant of 5 undo tokens - Expected: Tokens added to account on monthly reset - Severity: P0
- [ ] Restore purchases after account deletion and re-signup - Expected: Previous purchases restored, tokens granted - Severity: P0
- [ ] View token balances in settings or profile - Expected: Current token counts displayed correctly - Severity: P1

### Edge Cases
- [ ] Attempt to use undo token without sufficient balance - Expected: Error message displayed, undo blocked - Severity: P0
- [ ] Attempt to use search token without sufficient balance - Expected: Error message displayed, search blocked - Severity: P0
- [ ] Attempt to use message request token without sufficient balance - Expected: Error message displayed, request blocked - Severity: P0
- [ ] Use undo token, verify token consumed with priority (baseline -> subscription -> purchase) - Expected: Correct token source consumed - Severity: P1
- [ ] Subscribe to premium, verify subscription tokens granted immediately - Expected: Tokens added on subscription activation - Severity: P0
- [ ] Subscription renews, verify monthly tokens granted - Expected: Tokens added on renewal date - Severity: P0
- [ ] Cancel subscription, verify subscription tokens stop - Expected: No new tokens granted, existing tokens remain - Severity: P0
- [ ] Complete purchase, immediately check token balance - Expected: Tokens updated immediately - Severity: P1
- [ ] Complete purchase, network failure during receipt validation - Expected: Purchase queued, validated on retry - Severity: P0
- [ ] Restore purchases, verify duplicate purchases not granted - Expected: Each purchase granted only once - Severity: P0
- [ ] Delete account with active subscription - Expected: Account deleted, subscription status preserved for restoration - Severity: P0

### Failure States
- [ ] Attempt in-app purchase, App Store/Play Store unavailable - Expected: Error message displayed, purchase not completed - Severity: P0
- [ ] Complete purchase, receipt validation fails - Expected: Error message displayed, purchase not recorded - Severity: P0
- [ ] Complete purchase, backend database error - Expected: Error message displayed, purchase not recorded - Severity: P0
- [ ] Use undo token, backend token validation fails - Expected: Error message displayed, undo blocked - Severity: P0
- [ ] Attempt to restore purchases, backend unavailable - Expected: Error message displayed, restoration fails - Severity: P1
- [ ] Subscription renewal fails, verify tokens not granted - Expected: No tokens added, error logged - Severity: P0
- [ ] Monthly baseline grant cron job fails - Expected: Tokens not granted, manual intervention required - Severity: P1

## Preferences & Filters

### Happy Paths
- [ ] Update age range preference (min and max) - Expected: Preference saved, queue filtered accordingly - Severity: P0
- [ ] Update distance preference (max miles) - Expected: Preference saved, queue filtered accordingly - Severity: P0
- [ ] Update height range preference (min and max) - Expected: Preference saved, queue filtered accordingly - Severity: P0
- [ ] Update discovery filters (race, religion, politics, education, activity level, drinking, smoking, marijuana) - Expected: Preferences saved, queue filtered accordingly - Severity: P0
- [ ] Clear all discovery filters - Expected: Preferences cleared, no filtering applied - Severity: P1
- [ ] Update preferences, verify queue refreshes automatically - Expected: Queue reloaded with new filters applied - Severity: P1

### Edge Cases
- [ ] Set age range to minimum (18-18) - Expected: Preference saved, only 18-year-olds shown - Severity: P1
- [ ] Set age range to maximum (60-60) - Expected: Preference saved, only 60-year-olds shown - Severity: P1
- [ ] Set distance to minimum (1 mile) - Expected: Preference saved, very limited results - Severity: P1
- [ ] Set distance to maximum (200 miles) - Expected: Preference saved, broad results - Severity: P1
- [ ] Select multiple values for multi-select filters (race, religion, etc.) - Expected: All selected values saved, filtering works correctly - Severity: P1
- [ ] Deselect all values for multi-select filter - Expected: Filter cleared, no filtering applied for that category - Severity: P1
- [ ] Update preferences, verify Redis cache invalidated - Expected: Stale queue data cleared, fresh data loaded - Severity: P0
- [ ] Set very restrictive filters, verify queue becomes empty - Expected: Empty state displayed, option to relax filters - Severity: P1
- [ ] Set restrictive filters with showOutsideRange enabled, verify soft preferences relaxed - Expected: Profiles shown even if outside soft preferences - Severity: P1

### Failure States
- [ ] Update preferences, backend returns 500 error - Expected: Error message displayed, preferences not saved - Severity: P1
- [ ] Update preferences, network timeout - Expected: Error message displayed, preferences not saved - Severity: P1
- [ ] Load preferences screen, backend unavailable - Expected: Error message displayed, default preferences shown - Severity: P1

## Blocking, Reporting & Safety

### Happy Paths
- [ ] Block user from profile view or chat - Expected: User blocked, SafetyExclusion created, user hidden from queue - Severity: P0
- [ ] Report user for inappropriate behavior - Expected: Report created, timestamp recorded - Severity: P0
- [ ] Report specific message for inappropriate content - Expected: Report created with message reference - Severity: P0
- [ ] Report specific photo for inappropriate content - Expected: Report created with photo reference - Severity: P0
- [ ] Block user, verify user cannot send message requests - Expected: Request creation blocked - Severity: P0
- [ ] Block user, verify existing match is not affected - Expected: Match remains, but user is blocked - Severity: P1
- [ ] Unblock user from settings - Expected: Block removed, SafetyExclusion preserved - Severity: P0
- [ ] Write normal review for user after chat - Expected: Review created, rating and comment saved - Severity: P1
- [ ] Write emergency review for user - Expected: Review created, marked as emergency, preserved indefinitely - Severity: P0
- [ ] Write report review for user - Expected: Review created, marked as report - Severity: P0
- [ ] View user reviews and rating summary - Expected: All reviews displayed, average rating calculated - Severity: P1
- [ ] Receive 3rd review strike, verify system penalty review issued - Expected: Strike recorded, penalty review created - Severity: P0

### Edge Cases
- [ ] Block user, delete account, sign up again with same phone - Expected: SafetyExclusion persists, user still blocked - Severity: P0
- [ ] Report same user multiple times - Expected: Report timestamp updated, duplicate prevented - Severity: P1
- [ ] Report user, verify report is idempotent - Expected: Single report record, timestamp updated on duplicate - Severity: P1
- [ ] Write review, verify weekly limit enforced (3 reviews/week) - Expected: 4th review blocked with error message - Severity: P0
- [ ] Write review without sufficient chat messages (less than 2 each) - Expected: Review blocked with error message - Severity: P0
- [ ] Write review with prohibited keywords - Expected: Review blocked or flagged, strike issued - Severity: P0
- [ ] Write emergency review, verify it bypasses normal limits - Expected: Review created regardless of weekly limit - Severity: P0
- [ ] Write review, receive strike for violation - Expected: Strike recorded, user notified - Severity: P0
- [ ] Receive 3 strikes, verify account restrictions applied - Expected: System penalty review issued, additional restrictions - Severity: P0
- [ ] Block user who has already blocked current user - Expected: Block created, mutual block in effect - Severity: P1
- [ ] View safety screen, verify all hotlines and resources displayed - Expected: All safety information accessible - Severity: P1
- [ ] Tap emergency hotline (911) from safety screen - Expected: Phone dialer opens with 911 - Severity: P1
- [ ] Tap national hotline from safety screen - Expected: Phone dialer opens with correct number - Severity: P1

### Failure States
- [ ] Attempt to block user, backend returns 500 error - Expected: Error message displayed, block not created - Severity: P0
- [ ] Attempt to report user, backend unavailable - Expected: Error message displayed, report not created - Severity: P0
- [ ] Write review, backend validation fails - Expected: Error message displayed, review not created - Severity: P0
- [ ] Write review, keyword moderation service unavailable - Expected: Review created with warning, moderation skipped - Severity: P1
- [ ] Block user, SafetyExclusion creation fails - Expected: Error message displayed, block may not persist - Severity: P0

## Notifications (Push / In-App if present)

### Happy Paths
- [ ] Receive push notification for new message - Expected: Notification received, tapping opens chat - Severity: P0
- [ ] Receive push notification for message request - Expected: Notification received, tapping opens messages screen - Severity: P0
- [ ] Receive push notification for message request acceptance - Expected: Notification received, tapping opens chat - Severity: P0
- [ ] Grant notification permissions on first launch - Expected: Permissions granted, notifications enabled - Severity: P0
- [ ] Update push token when app reinstalled - Expected: New token registered, notifications resume - Severity: P1

### Edge Cases
- [ ] Receive notification while app is in foreground - Expected: In-app notification or badge update - Severity: P1
- [ ] Receive notification while app is in background - Expected: Push notification displayed - Severity: P0
- [ ] Receive notification while app is closed - Expected: Push notification displayed, app opens on tap - Severity: P0
- [ ] Deny notification permissions, verify app still functions - Expected: App works, no notifications sent - Severity: P1
- [ ] Receive multiple notifications rapidly - Expected: All notifications received and displayed - Severity: P1
- [ ] Update push token, verify old token invalidated - Expected: Notifications sent to new token only - Severity: P1

### Failure States
- [ ] Attempt to send notification, Expo Push API unavailable - Expected: Notification not sent, error logged - Severity: P1
- [ ] Update push token, backend database error - Expected: Error logged, token may not update - Severity: P1
- [ ] Receive notification with invalid payload - Expected: Notification ignored or error handled gracefully - Severity: P1

## Caching & Data Consistency

### Happy Paths
- [ ] Load swipe queue, verify Redis cache hit - Expected: Fast response, queue loaded from cache - Severity: P1
- [ ] Like profile, verify Redis cache invalidated - Expected: Cache cleared, next queue load is fresh - Severity: P0
- [ ] Update preferences, verify Redis cache invalidated - Expected: Cache cleared, queue refreshed - Severity: P0
- [ ] Block user, verify Redis cache invalidated - Expected: Cache cleared, blocked user removed from queue - Severity: P0
- [ ] Load profile data, verify Zustand cache used - Expected: Instant UI update, background refresh - Severity: P1

### Edge Cases
- [ ] Load swipe queue with stale Redis cache (TTL expired) - Expected: Cache miss, fresh data loaded from database - Severity: P1
- [ ] Like profile, immediately load queue before cache invalidation - Expected: Stale data may be served, refreshed on next request - Severity: P1
- [ ] Update preferences, verify cache invalidation happens before queue reload - Expected: Fresh data loaded, not stale cache - Severity: P0
- [ ] Load queue with Redis unavailable, verify fallback to database - Expected: Queue loaded from database, slower but functional - Severity: P1
- [ ] Multiple users like same profile simultaneously - Expected: Cache invalidation handled correctly, no race conditions - Severity: P1
- [ ] View profile with cached data, verify background refresh updates UI - Expected: UI updates when fresh data arrives - Severity: P1

### Failure States
- [ ] Load queue, Redis connection fails - Expected: Fallback to database, error logged - Severity: P1
- [ ] Invalidate cache, Redis unavailable - Expected: Error logged, cache may remain stale - Severity: P1
- [ ] Load queue, Redis returns corrupted data - Expected: Fallback to database, error logged - Severity: P1

## Error Handling & Recovery

### Happy Paths
- [ ] Encounter network error, verify error message displayed - Expected: User-friendly error message, retry option - Severity: P1
- [ ] Encounter 401 error, verify automatic logout - Expected: User logged out, navigated to login - Severity: P0
- [ ] Encounter 403 error, verify appropriate message displayed - Expected: Error message indicates permission issue - Severity: P1
- [ ] Encounter 500 error, verify error logged and user notified - Expected: Error message displayed, issue logged - Severity: P1
- [ ] Retry failed request, verify retry succeeds - Expected: Request retried, operation completes - Severity: P1

### Edge Cases
- [ ] Encounter rate limit error (429) - Expected: Error message displayed, retry after delay - Severity: P1
- [ ] Encounter timeout error, verify retry mechanism - Expected: Request retried, or error displayed - Severity: P1
- [ ] Encounter multiple errors in sequence - Expected: Each error handled appropriately, no crash - Severity: P1
- [ ] Encounter error during critical operation (purchase, account deletion) - Expected: Operation rolled back or error clearly communicated - Severity: P0
- [ ] Encounter error with malformed API response - Expected: Error handled gracefully, app does not crash - Severity: P0

### Failure States
- [ ] Encounter unhandled exception - Expected: Error caught, logged, app does not crash - Severity: P0
- [ ] Encounter error in background process (cron job) - Expected: Error logged, process continues or retries - Severity: P1
- [ ] Encounter database connection error - Expected: Error logged, retry mechanism or graceful degradation - Severity: P0

## Platform-Specific Behavior (iOS / Android)

### Happy Paths
- [ ] Test Google OAuth on Android device - Expected: OAuth flow works correctly - Severity: P0
- [ ] Test Google OAuth on iOS device - Expected: Error message displayed, fallback suggested - Severity: P1
- [ ] Test Apple Sign-In on iOS device - Expected: Sign-In flow works correctly - Severity: P0
- [ ] Test Apple Sign-In on Android device - Expected: Error message displayed, fallback suggested - Severity: P1
- [ ] Test in-app purchases on iOS device - Expected: Apple App Store purchase flow works - Severity: P0
- [ ] Test in-app purchases on Android device - Expected: Google Play Store purchase flow works - Severity: P0
- [ ] Test push notifications on iOS device - Expected: Notifications received via APNs - Severity: P0
- [ ] Test push notifications on Android device - Expected: Notifications received via FCM - Severity: P0
- [ ] Test location permissions on iOS device - Expected: Permission request works, location accessed - Severity: P0
- [ ] Test location permissions on Android device - Expected: Permission request works, location accessed - Severity: P0

### Edge Cases
- [ ] Test app on iOS device with iOS version below minimum - Expected: App does not install or error displayed - Severity: P1
- [ ] Test app on Android device with Android version below minimum - Expected: App does not install or error displayed - Severity: P1
- [ ] Test app on tablet device (iPad/Android tablet) - Expected: App functions correctly, UI adapts if needed - Severity: P1
- [ ] Test app in landscape orientation - Expected: UI adapts correctly or locked to portrait - Severity: P2
- [ ] Test app with different screen sizes and densities - Expected: UI scales correctly, no layout issues - Severity: P1
- [ ] Test app with system dark mode enabled - Expected: App theme adapts or uses app setting - Severity: P1
- [ ] Test app with system language set to non-English - Expected: App functions correctly, text may be in English - Severity: P2

### Failure States
- [ ] Test app on iOS device with restricted permissions - Expected: App requests permissions, functions with limited features - Severity: P1
- [ ] Test app on Android device with restricted permissions - Expected: App requests permissions, functions with limited features - Severity: P1
- [ ] Test app on device with low storage space - Expected: App functions, may warn about storage - Severity: P1
- [ ] Test app on device with poor network connection - Expected: App handles slow network, shows loading states - Severity: P1

## Performance & Resource Usage

### Happy Paths
- [ ] Load app, verify initial load time under 3 seconds - Expected: App loads quickly, no excessive wait - Severity: P1
- [ ] Navigate between screens, verify smooth transitions - Expected: No lag or jank during navigation - Severity: P1
- [ ] Load swipe queue with 100+ profiles, verify performance - Expected: Queue loads in reasonable time, scrolling smooth - Severity: P1
- [ ] Load chat with 100+ messages, verify performance - Expected: Messages load quickly, scrolling smooth - Severity: P1
- [ ] Upload photo, verify upload completes in reasonable time - Expected: Upload progress shown, completes successfully - Severity: P1
- [ ] Prefetch profile photos, verify images load quickly - Expected: Photos cached, instant display on swipe - Severity: P1

### Edge Cases
- [ ] Load app on device with limited RAM - Expected: App functions, may be slower but does not crash - Severity: P1
- [ ] Load app on device with slow CPU - Expected: App functions, may be slower but does not crash - Severity: P1
- [ ] Load queue with very large number of profiles (1000+) - Expected: Queue loads, pagination or limiting applied - Severity: P1
- [ ] Send message while app is in background - Expected: Message sent, notification received - Severity: P1
- [ ] Load app after extended period of inactivity - Expected: App refreshes data, functions correctly - Severity: P1

### Failure States
- [ ] Load app with no network connection - Expected: Error message displayed, offline mode if available - Severity: P1
- [ ] Load app with very slow network connection - Expected: Loading states displayed, timeouts handled - Severity: P1
- [ ] Load app with high network latency - Expected: Requests complete eventually, timeouts handled - Severity: P1

## App Store / Play Store Compliance

### Happy Paths
- [ ] Verify app has privacy policy link accessible from login - Expected: Privacy policy accessible, opens correctly - Severity: P0
- [ ] Verify app has terms of service link accessible from login - Expected: Terms accessible, opens correctly - Severity: P0
- [ ] Verify app has cookie policy link accessible from login - Expected: Cookie policy accessible, opens correctly - Severity: P0
- [ ] Verify in-app purchases have proper descriptions and pricing - Expected: All purchase options clearly described - Severity: P0
- [ ] Verify subscription terms and cancellation policy displayed - Expected: Terms visible, cancellation process clear - Severity: P0
- [ ] Verify app requests only necessary permissions - Expected: No excessive permissions requested - Severity: P0
- [ ] Verify app handles account deletion properly - Expected: Deletion process clear, data removed - Severity: P0
- [ ] Verify app has age rating appropriate for dating app - Expected: Rating set correctly (likely 17+ or 18+) - Severity: P0
- [ ] Verify app does not collect unnecessary user data - Expected: Only required data collected - Severity: P0
- [ ] Verify app has proper content moderation - Expected: Photo moderation active, inappropriate content blocked - Severity: P0

### Edge Cases
- [ ] Verify privacy policy is accessible without account - Expected: Policy viewable before signup - Severity: P0
- [ ] Verify terms of service is accessible without account - Expected: Terms viewable before signup - Severity: P0
- [ ] Verify app handles subscription cancellation according to store policies - Expected: Cancellation works via store, not in-app - Severity: P0
- [ ] Verify app handles refund requests according to store policies - Expected: Refunds processed via store, not in-app - Severity: P0
- [ ] Verify app does not bypass store payment systems - Expected: All purchases go through store - Severity: P0

### Failure States
- [ ] Verify app handles store purchase verification failures - Expected: Error message displayed, purchase not granted - Severity: P0
- [ ] Verify app handles store API unavailability - Expected: Error message displayed, purchases disabled - Severity: P0

## Admin / Internal Tools

### Happy Paths
- [ ] Access admin dashboard with correct admin code (000000) - Expected: Dashboard opens, admin features accessible - Severity: P0
- [ ] Search for user by name in admin dashboard - Expected: Search results displayed with user profiles - Severity: P0
- [ ] View user details in admin dashboard - Expected: All user information displayed (UID, email, role, tokens) - Severity: P0
- [ ] Grant tokens to user (search, message, undo) - Expected: Tokens updated, user balance reflects change - Severity: P0
- [ ] Toggle user subscription status - Expected: Subscription status updated, tokens granted if activated - Severity: P0
- [ ] Set subscription expiration date - Expected: Expiration date saved, displayed correctly - Severity: P0
- [ ] View photo moderation queue - Expected: All photos with pending/flagged status displayed - Severity: P0
- [ ] Approve photo from moderation queue - Expected: Photo status updated to approved - Severity: P0
- [ ] Reject photo from moderation queue - Expected: Photo status updated to rejected, user notified - Severity: P0
- [ ] Use admin developer tools to grant tokens (admin role only) - Expected: Tokens granted successfully - Severity: P1

### Edge Cases
- [ ] Access admin dashboard with incorrect admin code - Expected: Error message displayed, dashboard not accessible - Severity: P0
- [ ] Search for user with no results - Expected: "No users found" message displayed - Severity: P1
- [ ] Grant negative tokens to user - Expected: Tokens decremented, balance cannot go below zero - Severity: P1
- [ ] Grant very large number of tokens - Expected: Tokens added, balance updated correctly - Severity: P1
- [ ] Set subscription expiration in the past - Expected: Validation error or expiration set correctly - Severity: P1
- [ ] View moderation queue with no pending photos - Expected: Empty state displayed - Severity: P1
- [ ] Approve photo that was already approved - Expected: Status remains approved, no error - Severity: P1
- [ ] Access admin features with non-admin user account - Expected: Access denied, 403 error - Severity: P0

### Failure States
- [ ] Attempt admin search, backend returns 500 error - Expected: Error message displayed, search fails - Severity: P1
- [ ] Attempt to grant tokens, backend validation fails - Expected: Error message displayed, tokens not granted - Severity: P0
- [ ] Attempt to approve photo, backend unavailable - Expected: Error message displayed, approval fails - Severity: P1
- [ ] Access admin dashboard, Firebase token expired - Expected: 401 error, user logged out - Severity: P0

## Launch Blockers

### Critical Issues
- [ ] **Implementation Risk**: Receipt validation for in-app purchases appears to be a stub - Expected: Full validation implemented for Apple App Store and Google Play Store - Severity: P0
- [ ] **Implementation Risk**: Rate limiting uses in-memory store, will not work across multiple server instances - Expected: Redis-backed rate limiting implemented for production scale - Severity: P0
- [ ] **Security Risk**: Admin code is hardcoded as "000000" in SettingsScreen - Expected: Admin code stored securely, not in client code - Severity: P0
- [ ] **Security Risk**: Admin role assignment uses placeholder phone number and UID - Expected: Proper admin assignment mechanism implemented - Severity: P0
- [ ] **Data Risk**: Google Vision API failure defaults to approving photos - Expected: Proper error handling, photos held in moderation queue until API available - Severity: P0
- [ ] **Privacy Risk**: Phone numbers are hashed but admin assignment still uses phone number check - Expected: Admin assignment uses secure method, not phone number - Severity: P0
- [ ] **Compliance Risk**: App may not handle GDPR data deletion requests properly - Expected: Full account deletion tested and verified - Severity: P0
- [ ] **Compliance Risk**: App may not have proper age verification for 18+ content - Expected: Age verification implemented and tested - Severity: P0
- [ ] **Infrastructure Risk**: Redis cache invalidation may have race conditions with multiple server instances - Expected: Distributed cache invalidation implemented - Severity: P0
- [ ] **Infrastructure Risk**: Database migrations may not be tested in production-like environment - Expected: All migrations tested, rollback procedures documented - Severity: P0
- [ ] **Feature Risk**: Match expiration cron job failure may leave expired matches active - Expected: Monitoring and alerting for cron job failures - Severity: P0
- [ ] **Feature Risk**: Monthly token grant cron job failure may leave users without baseline tokens - Expected: Monitoring and alerting for cron job failures - Severity: P0
- [ ] **Feature Risk**: Hide window cleanup cron job failure may leave expired hide windows active - Expected: Monitoring and alerting for cron job failures - Severity: P0
- [ ] **Testing Risk**: End-to-end tests may not cover all critical user flows - Expected: Comprehensive E2E test suite covering auth, purchases, messaging - Severity: P0
- [ ] **Performance Risk**: Swipe queue generation with large user base may be slow - Expected: Performance tested with production-like data volumes - Severity: P0
- [ ] **Security Risk**: Firebase token refresh may hit quota limits under high load - Expected: Token caching and refresh strategy optimized - Severity: P0
- [ ] **Compliance Risk**: App may not meet App Store/Play Store requirements for dating apps - Expected: All store requirements verified and met - Severity: P0
- [ ] **Data Risk**: Account deletion may not properly clean up all related data in edge cases - Expected: Deletion tested with all data combinations - Severity: P0
- [ ] **Feature Risk**: Socket.IO reconnection may not properly restore message delivery after network issues - Expected: Reconnection and message queuing tested thoroughly - Severity: P0
- [ ] **Infrastructure Risk**: S3 photo deletion may fail silently during account deletion - Expected: Proper error handling and retry logic for S3 operations - Severity: P0

