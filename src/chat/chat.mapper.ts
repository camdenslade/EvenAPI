//********************************************************************
//
// mapMessage Function
//
// Maps a Message entity into a standardized response object for clients.
// Adds `isMine` boolean for frontend chat UX to determine message alignment.
//
// Return Value
// ------------
// Object    Mapped message object with isMine flag
//
// Value Parameters
// ----------------
// msg    Message    Message entity to map
// uid    string     Firebase UID of the current user
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

import { Message } from "../database/entities/message.entity";

export const mapMessage = (msg: Message, uid: string) => {
  const senderUid = msg.senderProfile.userUid;

  return {
    id: msg.id,
    text: msg.text,
    imageUrl: msg.imageUrl || null,
    senderId: senderUid, // Firebase UID for API compatibility
    isMine: senderUid === uid,
    createdAt: msg.createdAt,
  };
};
