//********************************************************************
//
// ChatController Class
//
// Controller for chat endpoints. Handles GET /chat/threads to retrieve
// thread previews, GET /chat/messages/:threadId to get messages, and
// POST /chat/messages/:matchId to send messages.
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
// chat    ChatService    Injected chat service
//
//*******************************************************************

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";

import { ChatService } from "./chat.service";
import { AuthUser } from "../auth/auth-user.decorator";

//********************************************************************
//
// SendMessageDto Class
//
// DTO for sending messages.
//
// Value Parameters
// ----------------
// content    string    Message text content
//
//*******************************************************************
class SendMessageDto {
  content!: string;
}

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  //********************************************************************
  //
  // getThreads Method
  //
  // GET /chat/threads endpoint. Returns all thread previews for the
  // authenticated user.
  //
  // Return Value
  // ------------
  // Promise<MatchThread[]>    Array of thread preview objects
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
  @Get("threads")
  async getThreads(@AuthUser() user: { uid: string }) {
    return this.chat.getUserThreads(user.uid);
  }

  //********************************************************************
  //
  // getMessages Method
  //
  // GET /chat/messages/:threadId endpoint. Returns all messages for a
  // thread. Validates user access before returning messages.
  //
  // Return Value
  // ------------
  // Promise<Message[]>    Array of message entities
  //
  // Value Parameters
  // ----------------
  // user      Object    Authenticated Firebase user from decorator
  //   uid       string        Firebase UID
  // threadId  string    Thread ID from route parameter
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // allowed    boolean    Whether user can access the thread
  //
  //*******************************************************************
  @Get("messages/:threadId")
  async getMessages(
    @AuthUser() user: { uid: string },
    @Param("threadId") threadId: string,
  ) {
    const allowed = await this.chat.userCanAccessThread(user.uid, threadId);
    if (!allowed) throw new ForbiddenException("Access denied");

    return this.chat.getMessagesForThread(threadId);
  }

  //********************************************************************
  //
  // sendMessage Method
  //
  // POST /chat/messages/:matchId endpoint. Sends a message in a match
  // thread. Validates message content is not empty.
  //
  // Return Value
  // ------------
  // Promise<Message>    Saved message entity
  //
  // Value Parameters
  // ----------------
  // user      Object            Authenticated Firebase user from decorator
  //   uid       string              Firebase UID
  // matchId   string            Match ID from route parameter
  // body      SendMessageDto    Message content
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // content    string    Trimmed message content
  //
  //*******************************************************************
  @Post("messages/:matchId")
  async sendMessage(
    @AuthUser() user: { uid: string },
    @Param("matchId") matchId: string,
    @Body() body: SendMessageDto,
  ) {
    const { content } = body;

    if (!content.trim()) {
      throw new BadRequestException("Message content is required");
    }

    return this.chat.sendMessage(matchId, user.uid, content.trim());
  }
}
