//********************************************************************
//
// Chat Type Definitions (Backend)
//
// Type definitions for chat messages and threads. Matches backend
// message shape from ChatService + Message entity, and thread preview
// shapes returned by GET /chat/threads. Expired threads are filtered
// out server-side.
//
// Backend message shape:
//   {
//     id: string,
//     threadId: string,
//     senderId: string,
//     text: string,
//     imageUrl: string | null,
//     createdAt: string
//   }
//
// Backend thread preview shapes:
//   1. Active or restored thread:
//      {
//        status: "active" | "restored",
//        threadId: string,
//        matchId: string,
//        user: { uid, name, profileImageUrl },
//        lastMessage: string | null,
//        lastTimestamp: number
//      }
//
//   2. Pending message request:
//      {
//        status: "pending",
//        requestId: string,
//        user: { uid, name, profileImageUrl },
//        lastMessage: string | null,
//        lastTimestamp: number
//      }
//
//*******************************************************************

//********************************************************************
//
// MatchUser Interface
//
// Represents user information in a match or thread context.
//
// Value Parameters
// ----------------
// uid              string    Firebase UID
// name             string    User's display name
// profileImageUrl  string    First photo URL or empty string
//
//*******************************************************************
export interface MatchUser {
  uid: string; // Firebase UID
  name: string;
  profileImageUrl: string; // first photo or ""
}

//********************************************************************
//
// MatchThread Type (Discriminated Union)
//
// Represents either an active/restored thread or a pending message
// request. Matches what MessagesScreen expects and what backend returns.
//
// Value Parameters (Active/Restored Thread)
// ------------------------------------------
// status          "active"|"restored"    Thread status
// threadId        string                 Thread ID
// matchId         string                 Match ID
// user            MatchUser              Other user in the thread
// lastMessage     string|null            Last message text or null
// lastTimestamp   number                 Last message timestamp
// lastMessageSenderId string|null        Firebase UID of last message sender
//
// Value Parameters (Pending Request)
// ----------------------------------
// status          "pending"              Request status
// requestId       string                 Request ID
// user            MatchUser              User who sent the request
// lastMessage     string|null            Last message text or null
// lastTimestamp   number                 Last message timestamp
//
//*******************************************************************
export type MatchThread =
  | {
      status: "active" | "restored";
      threadId: string;
      matchId: string;
      user: MatchUser;
      lastMessage: string | null;
      lastTimestamp: number;
      lastMessageSenderId: string | null;
    }
  | {
      status: "pending";
      requestId: string;
      user: MatchUser;
      lastMessage: string | null;
      lastTimestamp: number;
    };

//********************************************************************
//
// ChatMessage Interface
//
// Backend canonical message shape.
//
// Value Parameters
// ----------------
// id          string          Message ID
// threadId    string          Thread ID this message belongs to
// senderId    string          Firebase UID of sender
// text        string          Message text (may be empty string)
// imageUrl    string|null     Image URL if message contains image
// createdAt   string          ISO timestamp
//
//*******************************************************************
export interface ChatMessage {
  id: string; // message ID
  threadId: string;
  senderId: string; // Firebase UID of sender
  text: string; // may be ""
  imageUrl: string | null;
  createdAt: string; // ISO timestamp
}
