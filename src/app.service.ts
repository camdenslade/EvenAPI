//********************************************************************
//
// AppService Class
//
// Basic application service. Provides a simple test endpoint method
// used when verifying the server is running. Not used in production
// business logic.
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
// None
//
//*******************************************************************

import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  //********************************************************************
  //
  // getHello Method
  //
  // Basic test endpoint method. Returns a simple greeting string.
  // Used for server health checks and testing.
  //
  // Return Value
  // ------------
  // string    "Hello World!" greeting string
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
  getHello(): string {
    return "Hello World!";
  }
}
