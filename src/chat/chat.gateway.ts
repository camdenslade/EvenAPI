//********************************************************************
//
// ChatGateway Class
//
// WebSocket gateway for real-time chat functionality. Handles socket
// connections with Cognito authentication, thread joining, and real-time
// message broadcasting. Implements Socket.IO for bidirectional communication.
//
// Return Value
// ------------
// None (NestJS gateway class)
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
// server        Server          Socket.IO server instance
// chatService   ChatService     Chat service for business logic
//
//*******************************************************************

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";

import { Server, Socket } from "socket.io";
import { sanitizeForLogging } from "../utils/log-sanitizer";
import { verifyCognitoAccessToken } from "../auth/guards/cognito-auth.guard";

import { ChatService } from "./chat.service";

export type AuthedSocket = Socket & {
  userId: string;
};

const MESSAGE_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const MESSAGE_RATE_LIMIT_MAX = 60; // max messages per window per user

@WebSocketGateway({ cors: { origin: "*" } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly chatService: ChatService) {}

  private messageRate = new Map<
    string,
    { count: number; windowStart: number }
  >();

  private sanitizeContent(content: string): string {
    // Remove control chars, trim, and cap length
    const cleaned = Array.from(content || "")
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join("")
      .trim();
    return cleaned.slice(0, 500);
  }

  //********************************************************************
  //
  // handleConnection Method
  //
  // Handles WebSocket connection. Validates Cognito token from
  // handshake auth and attaches uid to socket. Disconnects if
  // authentication fails.
  //
  // Return Value
  // ------------
  // Promise<void>
  //
  // Value Parameters
  // ----------------
  // client    AuthedSocket    Socket client with userId property
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // token     string|undefined    Cognito access token from handshake
  // decoded   JWTPayload          Decoded and verified token
  //
  //*******************************************************************
  async handleConnection(client: AuthedSocket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) return client.disconnect();

      const decoded = await verifyCognitoAccessToken(token);
      const sub = decoded.sub ?? "";
      if (!sub) return client.disconnect();
      client.userId = sub;

      // Join user-specific room for match notifications
      await client.join(`user:${sub}`);
    } catch (error: unknown) {
      // Sanitize errors
      this.server.emit(
        "error",
        "Authentication failed", // do not leak details to client
      );
      client.disconnect();
      const msg =
        error instanceof Error
          ? error.message
          : sanitizeForLogging(String(error));
      // Log sanitized auth failure
      console.warn(`Socket auth failed: ${sanitizeForLogging(msg)}`);
    }
  }

  //********************************************************************
  //
  // handleDisconnect Method
  //
  // Handles WebSocket disconnection. Optional: track presence or last
  // online timestamp.
  //
  // Return Value
  // ------------
  // void
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
  handleDisconnect(): void {
    // optional: track presence or last online timestamp
  }

  //********************************************************************
  //
  // joinMatch Method
  //
  // WebSocket message handler for 'joinMatch' event. Allows a user to
  // join a chat room representing a Thread. Validates access before
  // joining.
  //
  // Return Value
  // ------------
  // Promise<Object>    Response object with joined thread ID or error
  //
  // Value Parameters
  // ----------------
  // client    AuthedSocket        Authenticated socket client
  // data      Object              Message body
  //   matchId   string                Match ID to join
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // uid       string        User's Cognito sub from socket data
  // matchId   string        Match ID from message body
  // thread    Thread        Thread entity
  // canAccess boolean       Whether user can access the thread
  //
  //*******************************************************************
  @SubscribeMessage("joinMatch")
  async joinMatch(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { matchId: string },
  ) {
    const uid = client.userId;
    if (!uid) return { error: "Unauthenticated" };
    const matchId = data.matchId;

    const thread = await this.chatService.findOrCreateThread(matchId);

    const canAccess = await this.chatService.userCanAccessThread(
      uid,
      thread.id,
    );
    if (!canAccess) return { error: "Access denied" };

    await client.join(thread.id);
    return { joined: thread.id };
  }

  //********************************************************************
  //
  // joinThread Method (frontend compatibility)
  //
  // Allows joining by threadId (used by current mobile client). Validates
  // access via userCanAccessThread.
  //
  //********************************************************************
  @SubscribeMessage("joinThread")
  async joinThread(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { threadId: string },
  ) {
    const uid = client.userId;
    if (!uid) return { error: "Unauthenticated" };
    const threadId = data.threadId;
    if (!threadId) return { error: "Invalid threadId" };

    const canAccess = await this.chatService.userCanAccessThread(uid, threadId);
    if (!canAccess) return { error: "Access denied" };

    await client.join(threadId);
    return { joined: threadId };
  }

  //********************************************************************
  //
  // sendMessage Method
  //
  // WebSocket message handler for 'sendMessage' event. Validates access,
  // saves the message via ChatService, and broadcasts it to all clients
  // in the thread room.
  //
  // Return Value
  // ------------
  // Promise<Message>    Saved message entity
  //
  // Value Parameters
  // ----------------
  // client    AuthedSocket        Authenticated socket client
  // data      Object              Message body
  //   matchId   string                Match ID
  //   content   string                Message text content
  //
  // Reference Parameters
  // --------------------
  // None
  //
  // Local Variables
  // ---------------
  // uid       string        User's Cognito sub from socket data
  // matchId   string        Match ID from message body
  // content   string        Message content from message body
  // message   Message       Saved message entity
  // thread    Thread        Thread entity for broadcasting
  //
  //*******************************************************************
  @SubscribeMessage("sendMessage")
  async sendMessage(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    data: {
      matchId?: string;
      threadId?: string;
      content?: string;
      text?: string;
    },
  ) {
    const uid = client.userId;
    if (!uid) return { error: "Unauthenticated" };
    let { matchId } = data;
    const threadId = data.threadId;
    const content = data.content ?? data.text ?? "";

    if (!matchId && threadId) {
      const fromThread = await this.chatService.getMatchIdFromThread(threadId);
      matchId = fromThread ?? undefined;
    }

    if (!matchId || typeof matchId !== "string") {
      return { error: "Invalid matchId" };
    }

    // Rate limiting per user
    const now = Date.now();
    const existing = this.messageRate.get(uid);
    if (
      !existing ||
      now - existing.windowStart > MESSAGE_RATE_LIMIT_WINDOW_MS
    ) {
      this.messageRate.set(uid, { count: 1, windowStart: now });
    } else {
      existing.count += 1;
      this.messageRate.set(uid, existing);
      if (existing.count > MESSAGE_RATE_LIMIT_MAX) {
        return { error: "Rate limit exceeded" };
      }
    }

    const safeContent = this.sanitizeContent(content ?? "");
    if (!safeContent) {
      return { error: "Message content required" };
    }

    const message = await this.chatService.sendMessage(
      matchId,
      uid,
      safeContent,
    );

    const thread = await this.chatService.findOrCreateThread(matchId);
    const roomId = threadId || thread.id;

    // Get match to find recipient for user room broadcasting
    const match = await this.chatService.getMatchForBroadcast(matchId);
    const recipientUid = match
      ? match.userAUid === uid
        ? match.userBUid
        : match.userAUid
      : null;

    const messageWithThread = {
      ...message,
      threadId: thread.id,
    };

    // Broadcast to thread room (for users actively in chat)
    this.server.to(roomId).emit("newMessage", messageWithThread);

    // Also emit to user room for offline/background delivery and thread list updates
    if (recipientUid) {
      this.server
        .to(`user:${recipientUid}`)
        .emit("newMessage", messageWithThread);
      // Emit threadUpdated for thread list refresh
      this.server.to(`user:${recipientUid}`).emit("threadUpdated", {
        threadId: thread.id,
        matchId,
      });
    }

    return message;
  }
}
