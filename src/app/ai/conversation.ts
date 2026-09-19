import { createId } from "../../core/ids";

export type DirectorMessageRole = "user" | "assistant" | "system";

export interface DirectorMessage {
  id: string;
  role: DirectorMessageRole;
  text: string;
  createdAt: number;
}

export interface DirectorConversation {
  id: string;
  messages: DirectorMessage[];
}

export function createDirectorConversation(): DirectorConversation {
  return {
    id: createId("conv"),
    messages: [],
  };
}

export function appendDirectorMessage(
  conversation: DirectorConversation,
  role: DirectorMessageRole,
  text: string,
  createdAt = Date.now(),
): DirectorConversation {
  const message: DirectorMessage = {
    id: createId("msg"),
    role,
    text,
    createdAt,
  };
  return {
    ...conversation,
    messages: [...conversation.messages, message],
  };
}

/** Deterministic offline reply. No network. No project mutation. */
export const DIRECTOR_MOCK_REPLY =
  "Director (mock): I received your message. No project changes were made.";

export function mockDirectorReply(userText: string): string {
  const trimmed = userText.trim();
  if (!trimmed) return DIRECTOR_MOCK_REPLY;
  return `${DIRECTOR_MOCK_REPLY} (${trimmed.length} characters)`;
}
