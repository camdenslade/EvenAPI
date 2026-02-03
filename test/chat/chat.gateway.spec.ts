import { ChatGateway } from "../../src/chat/chat.gateway";
import { ChatService } from "../../src/chat/chat.service";
import { mockAuthUser } from "../helpers/auth.mock";
import { verifyCognitoAccessToken } from "../../src/auth/guards/cognito-auth.guard";

jest.mock("../../src/auth/guards/cognito-auth.guard", () => ({
  verifyCognitoAccessToken: jest.fn(),
}));

describe("ChatGateway", () => {
  let gateway: ChatGateway;
  let chatService: ChatService;
  let warnSpy: jest.SpyInstance;

  let authUsers: Map<string, any>;

  let mockSocket: any;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    authUsers = new Map();

    const mockVerify = verifyCognitoAccessToken as jest.Mock;
    mockVerify.mockImplementation((token: string) => {
      if (!token || typeof token !== "string") {
        throw new Error("Invalid token");
      }
      if (token.includes("revoked")) {
        throw new Error("Token revoked");
      }
      const uid = token.startsWith("token-")
        ? token.replace("token-", "")
        : token;
      if (!authUsers.has(uid)) {
        throw new Error("Invalid token");
      }
      return {
        sub: uid,
        email: null,
        phoneNumber: null,
        appleSub: null,
        tokenUse: "access",
      };
    });

    mockSocket = {
      handshake: {
        auth: {},
      },
      userId: undefined,
      disconnect: jest.fn(),
      join: jest.fn(),
      emit: jest.fn(),
    };

    chatService = {
      findOrCreateThread: jest.fn(),
      userCanAccessThread: jest.fn(),
      sendMessage: jest.fn(),
      getMatchForBroadcast: jest.fn(),
    } as any;

    gateway = new ChatGateway(chatService);

    gateway.server = {
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
      emit: jest.fn(), // Add emit method for error handling
    } as any;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe("handleConnection", () => {
    it("should authenticate valid token and attach userId", async () => {
      const uid = "test-user-123";
      authUsers.set(uid, mockAuthUser(uid, "test@example.com", null));

      mockSocket.handshake.auth.token = `token-${uid}`;

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.userId).toBe(uid);

      expect(mockSocket.disconnect).not.toHaveBeenCalled();
    });

    it("should disconnect on missing token", async () => {
      mockSocket.handshake.auth.token = undefined;

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalled();

      expect(mockSocket.userId).toBeUndefined();
    });

    it("should disconnect on invalid token", async () => {
      mockSocket.handshake.auth.token = "invalid-token";

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalled();

      expect(mockSocket.userId).toBeUndefined();
    });

    it("should disconnect on revoked token", async () => {
      const uid = "test-user-revoked";
      authUsers.set(uid, mockAuthUser(uid, "test@example.com", null));

      mockSocket.handshake.auth.token = `token-${uid}-revoked`;

      await gateway.handleConnection(mockSocket);

      expect(mockSocket.disconnect).toHaveBeenCalled();

      expect(mockSocket.userId).toBeUndefined();
    });
  });

  describe("joinMatch", () => {
    it("should allow joining thread when user has access", async () => {
      const uid = "test-user-123";
      const matchId = "match-456";
      const threadId = "thread-789";

      mockSocket.userId = uid;
      (chatService.findOrCreateThread as jest.Mock).mockResolvedValue({
        id: threadId,
      });
      (chatService.userCanAccessThread as jest.Mock).mockResolvedValue(true);

      const result = await gateway.joinMatch(mockSocket, { matchId });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(chatService.findOrCreateThread).toHaveBeenCalledWith(matchId);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(chatService.userCanAccessThread).toHaveBeenCalledWith(
        uid,
        threadId,
      );

      expect(mockSocket.join).toHaveBeenCalledWith(threadId);
      expect(result).toEqual({ joined: threadId });
    });

    it("should deny access when user cannot access thread", async () => {
      const uid = "test-user-123";
      const matchId = "match-456";
      const threadId = "thread-789";

      mockSocket.userId = uid;
      (chatService.findOrCreateThread as jest.Mock).mockResolvedValue({
        id: threadId,
      });
      (chatService.userCanAccessThread as jest.Mock).mockResolvedValue(false);

      const result = await gateway.joinMatch(mockSocket, { matchId });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(chatService.userCanAccessThread).toHaveBeenCalledWith(
        uid,
        threadId,
      );

      expect(mockSocket.join).not.toHaveBeenCalled();
      expect(result).toEqual({ error: "Access denied" });
    });
  });

  describe("sendMessage", () => {
    it("should send message and broadcast to thread", async () => {
      const uid = "test-user-123";
      const matchId = "match-456";
      const threadId = "thread-789";
      const content = "Hello, world!";
      const message = {
        id: "msg-123",
        content,
        senderUid: uid,
        threadId,
        createdAt: new Date(),
      };

      mockSocket.userId = uid;
      (chatService.findOrCreateThread as jest.Mock).mockResolvedValue({
        id: threadId,
      });
      (chatService.sendMessage as jest.Mock).mockResolvedValue(message);
      (chatService.getMatchForBroadcast as jest.Mock).mockResolvedValue({
        id: matchId,
        userAUid: uid,
        userBUid: "recipient-uid",
      });

      const result = await gateway.sendMessage(mockSocket, {
        matchId,
        content,
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(chatService.sendMessage).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(gateway.server.to).toHaveBeenCalledWith(threadId);
      expect(result).toEqual(message);
    });

    it("should not leak PII in socket events", async () => {
      const uid = "test-user-123";
      const matchId = "match-456";
      const threadId = "thread-789";
      const content = "Hello, world!";
      const message = {
        id: "msg-123",
        content,
        senderUid: uid,
        threadId,
        createdAt: new Date(),
      };

      mockSocket.userId = uid;
      (chatService.findOrCreateThread as jest.Mock).mockResolvedValue({
        id: threadId,
      });
      (chatService.sendMessage as jest.Mock).mockResolvedValue(message);
      (chatService.getMatchForBroadcast as jest.Mock).mockResolvedValue({
        id: matchId,
        userAUid: uid,
        userBUid: "recipient-uid",
      });

      await gateway.sendMessage(mockSocket, { matchId, content });

      // Verify message does not contain phone numbers or other PII

      const emitCall = (gateway.server.to(threadId) as any).emit;

      expect(emitCall).toHaveBeenCalledWith("newMessage", message);

      const emittedMessage = (emitCall as jest.Mock).mock.calls[0][1];
      expect(emittedMessage).not.toHaveProperty("phone");
      expect(emittedMessage).not.toHaveProperty("phoneNumber");
      expect(JSON.stringify(emittedMessage)).not.toMatch(/\+?\d{10,}/);
    });
  });

  describe("SafetyExcluded users", () => {
    it("should fail message send for SafetyExcluded users", async () => {
      const uid = "test-user-123";
      const matchId = "match-456";
      const content = "Hello, world!";

      mockSocket.userId = uid;
      (chatService.sendMessage as jest.Mock).mockRejectedValue(
        new Error("Safety exclusion"),
      );

      await expect(
        gateway.sendMessage(mockSocket, { matchId, content }),
      ).rejects.toThrow("Safety exclusion");
    });
  });
});
