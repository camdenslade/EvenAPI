//********************************************************************
//
// UserResponseDto Class
//
// DTO for user API responses. Excludes sensitive data like phone numbers.
// Phone numbers are never returned in API responses - only stored as
// hashes in SafetyIdentity for internal fraud prevention.
//
// Return Value
// ------------
// None (NestJS DTO class)
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
// id                      string              Primary key UUID
// uid                     string              Firebase UID
// email                   string|null         User's email address
// latitude                number|null         Location latitude
// longitude               number|null         Location longitude
// lastLocationUpdate      Date|null           Last location update timestamp
// reviewTimeoutExpiresAt  Date|null           Review timeout expiration timestamp
// isSubscribed            boolean             Subscription status
// searchTokens            number              Search tokens count
// messageTokens           number              Message tokens count
// undoTokens              number              Undo tokens count
// pushToken               string|null         Expo push notification token
// subscriptionExpiresAt   Date|null           Subscription expiration timestamp
// lastBaselineGrantAt     Date|null           Last monthly baseline grant timestamp
// paymentFlags            Object              Global payment feature flags
// userFlags               Object              Per-user unlimited override flags
//
//*******************************************************************

export class UserResponseDto {
  id: string;
  uid: string;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  lastLocationUpdate: Date | null;
  reviewTimeoutExpiresAt: Date | null;
  isSubscribed: boolean;
  searchTokens: number;
  messageTokens: number;
  undoTokens: number;
  pushToken: string | null;
  subscriptionExpiresAt: Date | null;
  lastBaselineGrantAt: Date | null;
  safetyIdentityId: string | null;
  schoolEmailVerified: boolean;
  schoolEmailVerifiedAt: Date | null;
  requireSchoolEmailGate: boolean;
  paymentFlags: {
    enablePayments: boolean;
    enableSearchTokens: boolean;
    enableUndoTokens: boolean;
    enableMessageReqTokens: boolean;
  };
  userFlags: {
    unlimitedSearch: boolean;
    unlimitedUndo: boolean;
    unlimitedMessageReq: boolean;
  };
}
