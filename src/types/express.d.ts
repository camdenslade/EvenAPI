//********************************************************************
//
// Express Request User Extension
//
// Extends Express.Request with a `user` object injected by
// FirebaseAuthGuard. This allows strong typing throughout the backend
// where `req.user` is used.
//
// Return Value
// ------------
// None (TypeScript declaration file)
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

import "express";

declare module "express" {
  interface Request {
    user?: {
      uid: string;
      email: string | null;
      phone: string | null;
    };
  }
}
