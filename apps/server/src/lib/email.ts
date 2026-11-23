export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Email delivery seam (ADR-015). Postmark arrives with T-303; dev logs, tests capture. */
export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export class MemoryEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

/** Development only (config refuses it in production): prints the message, including the sign-in link. */
export class ConsoleEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<void> {
    console.info(`\n[dev email] to=${message.to} subject="${message.subject}"\n${message.text}\n`);
  }
}
