import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

/** Same image as local development (infra/compose/compose.dev.yaml). */
const MAILPIT_IMAGE = 'axllent/mailpit:v1.32.0';

export interface Email {
  subject: string;
  text: string;
}

interface MessageSummary {
  ID: string;
  Subject: string;
}

/** A real Mailpit server in Docker; tests read the emails the API actually sent. */
export class TestMailpit {
  private constructor(private readonly container: StartedTestContainer) {}

  static async start(): Promise<TestMailpit> {
    const container = await new GenericContainer(MAILPIT_IMAGE)
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/livez', 8025))
      .start();
    return new TestMailpit(container);
  }

  get smtpConfig(): Record<string, string> {
    return {
      SMTP_HOST: this.container.getHost(),
      SMTP_PORT: String(this.container.getMappedPort(1025)),
    };
  }

  private get api(): string {
    return `http://${this.container.getHost()}:${this.container.getMappedPort(8025)}/api/v1`;
  }

  /** All emails sent to `to`, newest first. */
  async messagesTo(to: string): Promise<Email[]> {
    const query = encodeURIComponent(`to:"${to}"`);
    const res = await fetch(`${this.api}/search?query=${query}`);
    const { messages } = (await res.json()) as { messages: MessageSummary[] };
    return Promise.all(
      messages.map(async (m) => {
        const full = (await (await fetch(`${this.api}/message/${m.ID}`)).json()) as {
          Text: string;
        };
        return { subject: m.Subject, text: full.Text };
      }),
    );
  }

  /** Waits (polling an explicit condition, max 10 s) for an email whose subject contains `subject`. */
  async waitFor(to: string, subject: string): Promise<Email> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = (await this.messagesTo(to)).find((m) => m.subject.includes(subject));
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No email to ${to} with subject containing "${subject}" within 10 s`);
  }

  async count(to: string, subject: string): Promise<number> {
    return (await this.messagesTo(to)).filter((m) => m.subject.includes(subject)).length;
  }

  async stop(): Promise<void> {
    await this.container.stop();
  }
}

/** Extracts the `token` query parameter from the first link in an email body. */
export function tokenFrom(email: Email): string {
  const url = email.text.match(/https?:\/\/\S+/)?.[0];
  const token = url ? new URL(url).searchParams.get('token') : null;
  if (!token) throw new Error(`No token link in email "${email.subject}"`);
  return token;
}
