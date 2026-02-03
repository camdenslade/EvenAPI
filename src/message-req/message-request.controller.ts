//********************************************************************
//
// MessageRequestController Class
//
// Controller for message request endpoints. Handles POST /message-request
// to send requests, POST /message-request/:id/accept to accept requests,
// and POST /message-request/:id/reject to reject requests.
//
// Return Value
// ------------
// None (NestJS controller class)
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
// service    MessageRequestService    Injected message request service
//
//*******************************************************************

import { Controller, Post, Body, Param, Get } from "@nestjs/common";
import { AuthUser } from "../auth/auth-user.decorator";

import { MessageRequestService } from "./message-request.service";
import { CreateMessageRequestDto } from "./dto/message-request.dto";

@Controller("message-request")
export class MessageRequestController {
  constructor(private readonly service: MessageRequestService) {}

  //********************************************************************
  //
  // getPending Method
  //
  // GET /message-request/pending endpoint. Returns all pending message
  // requests received by the authenticated user with sender profile data.
  //
  // Return Value
  // ------------
  // Promise<Array<Object>>    Array of pending request objects, each containing:
  //                           id (string), content (string), createdAt (string ISO),
  //                           and sender (object with uid, firstName, photos) or null
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
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
  @Get("pending")
  async getPending(@AuthUser() user: { uid: string }) {
    return this.service.getPendingRequests(user.uid);
  }

  //********************************************************************
  //
  // send Method
  //
  // POST /message-request endpoint. Sends a message request from the
  // authenticated user to a recipient.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with request status and IDs
  //
  // Value Parameters
  // ----------------
  // user    Object                    Authenticated Firebase user from decorator
  //   uid     string                      Firebase UID
  // dto     CreateMessageRequestDto   Message request data
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
  @Post()
  async send(
    @AuthUser() user: { uid: string },
    @Body() dto: CreateMessageRequestDto,
  ) {
    return this.service.createRequest(user.uid, dto);
  }

  //********************************************************************
  //
  // accept Method
  //
  // POST /message-request/:id/accept endpoint. Accepts a pending message
  // request.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with accepted status and IDs
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
  // id      string    Message request ID from route parameter
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
  @Post(":id/accept")
  async accept(@AuthUser() user: { uid: string }, @Param("id") id: string) {
    return this.service.acceptRequest(user.uid, id);
  }

  //********************************************************************
  //
  // reject Method
  //
  // POST /message-request/:id/reject endpoint. Rejects a pending message
  // request.
  //
  // Return Value
  // ------------
  // Promise<Object>    Result object with rejected status
  //
  // Value Parameters
  // ----------------
  // user    Object    Authenticated Firebase user from decorator
  //   uid     string        Firebase UID
  // id      string    Message request ID from route parameter
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
  @Post(":id/reject")
  async reject(@AuthUser() user: { uid: string }, @Param("id") id: string) {
    return this.service.rejectRequest(user.uid, id);
  }
}
