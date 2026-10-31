import type { Mode, Turn } from './turns';

/**
 * One Connect chat for the widget.  POST /api/chat/start starts the contact in
 * a mode and answers the participant's details; chatjs connects with them and
 * carries the messages.  The participant token stays in this object.
 * Client-side metrics are off: the site's content security policy blocks
 * them.  chatjs loads only when a chat starts, so a page that never opens the
 * chat never fetches it.
 */

const REGION = 'us-east-1';

export interface Incoming {
  id: string;
  text: string;
}

interface ChatItem {
  Id?: string;
  Type?: string;
  ContentType?: string;
  Content?: string;
  ParticipantRole?: string;
}

interface Session {
  onMessage(cb: (event: { data: ChatItem }) => void): void;
  onEnded(cb: () => void): void;
  connect(): Promise<unknown>;
  sendMessage(args: { contentType: string; message: string }): Promise<unknown>;
  disconnectParticipant(): Promise<unknown>;
}

let chatjs: Promise<{ create(args: object): Session }> | null = null;
const loadChatjs = () => {
  // The bundle sets window.connect when it runs and exports nothing.
  chatjs ??= import('amazon-connect-chatjs').then(
    () => (globalThis as unknown as { connect: { ChatSession: { create(args: object): Session } } }).connect.ChatSession,
  );
  chatjs.catch(() => (chatjs = null));
  return chatjs;
};

export class ChatSession {
  private session: Session | null = null;
  private readonly seen = new Set<string>();
  ended = false;
  /** Whether the canvas's greeting has come; the chat takes questions after it. */
  greeted = false;

  private constructor(readonly contact: string, readonly mode: Mode) {}

  static async start(
    mode: Mode,
    onReply: (chat: ChatSession, m: Incoming) => void,
    onEnded: (chat: ChatSession) => void,
  ): Promise<ChatSession> {
    const response = await fetch('/api/chat/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!response.ok) throw new Error(`chat start answered ${response.status}`);
    const details = await response.json();
    const chat = new ChatSession(details.contactId, mode);
    const ChatSessionApi = await loadChatjs();
    const session = ChatSessionApi.create({
      chatDetails: { contactId: details.contactId, participantId: details.participantId, participantToken: details.participantToken },
      type: 'CUSTOMER',
      disableCSM: true,
      options: { region: REGION },
    });
    session.onMessage(({ data }) => {
      if (!data?.Id || chat.seen.has(data.Id)) return;
      chat.seen.add(data.Id);
      if (data.Type === 'MESSAGE' && data.ParticipantRole !== 'CUSTOMER') onReply(chat, { id: data.Id, text: data.Content ?? '' });
      if (data.Type === 'EVENT' && data.ContentType?.endsWith('chat.ended')) chat.close(() => onEnded(chat));
    });
    session.onEnded(() => chat.close(() => onEnded(chat)));
    chat.session = session;
    await session.connect();
    return chat;
  }

  async send(text: string): Promise<void> {
    await this.session?.sendMessage({ contentType: 'text/plain', message: text });
  }

  /** Every turn of this chat that the agent recorded. */
  async turns(): Promise<Turn[]> {
    const response = await fetch(`/api/chat/turns/${this.contact}`);
    return response.ok ? response.json() : [];
  }

  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    try {
      await this.session?.disconnectParticipant();
    } catch {
      // already gone
    }
  }

  private close(onEnded: () => void): void {
    if (this.ended) return;
    this.ended = true;
    onEnded();
  }
}
