import net from 'net';
import axios from 'axios';
import { getEnv } from '../config/env';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  text?: string;
}

export class EmailService {
  /**
   * Send email using SendGrid API (if SENDGRID_API_KEY is configured)
   * or direct SMTP socket (if SMTP_HOST is configured)
   * or fallback to simulated delivery in development/test.
   */
  async send(options: EmailOptions): Promise<{ success: boolean; messageId?: string }> {
    const env = getEnv();
    const from = options.from || env.FROM_EMAIL || 'noreply@fileconverter.pro';

    // 1. SendGrid API (when a valid SendGrid key is provided)
    if (env.SENDGRID_API_KEY && env.SENDGRID_API_KEY.startsWith('SG.')) {
      return this.sendViaSendGrid(options, from, env.SENDGRID_API_KEY);
    }

    // 2. SMTP Transport (Mailhog in dev, or production SMTP relay)
    if (env.SMTP_HOST) {
      return this.sendViaSmtp(options, from, env.SMTP_HOST, env.SMTP_PORT, env.SMTP_USER, env.SMTP_PASS);
    }

    // 3. Fallback for testing/development when no mail host is configured
    return { success: true, messageId: `mock-${Date.now()}` };
  }

  async sendViaSendGrid(
    options: EmailOptions,
    from: string,
    apiKey: string,
  ): Promise<{ success: boolean; messageId?: string }> {
    const response = await axios.post(
      'https://api.sendgrid.com/v3/mail/send',
      {
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: from },
        subject: options.subject,
        content: [{ type: 'text/html', value: options.html }],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );
    const msgId = (response.headers['x-message-id'] as string) || `sg-${Date.now()}`;
    return { success: response.status >= 200 && response.status < 300, messageId: msgId };
  }

  async sendViaSmtp(
    options: EmailOptions,
    from: string,
    host: string,
    port: number,
    user?: string,
    pass?: string,
  ): Promise<{ success: boolean; messageId?: string }> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(10000);

      let step = 0;
      let buffer = '';

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      socket.on('error', (err) => {
        cleanup();
        reject(err);
      });

      socket.on('timeout', () => {
        cleanup();
        reject(new Error('SMTP connection timed out'));
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes('\n')) {
          const lineEnd = buffer.indexOf('\n');
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);

          const code = parseInt(line.slice(0, 3), 10);
          if (isNaN(code)) continue;

          // Multi-line replies in SMTP have a hyphen after the code (e.g. 250-SIZE)
          if (line.charAt(3) === '-') continue;

          if (step === 0 && code === 220) {
            // Server greeting received -> send EHLO
            step = 1;
            socket.write(`EHLO fileconverter.pro\r\n`);
          } else if (step === 1 && code === 250) {
            if (user && pass) {
              step = 2; // Auth login
              socket.write(`AUTH LOGIN\r\n`);
            } else {
              step = 5; // Skip auth -> MAIL FROM
              socket.write(`MAIL FROM:<${from}>\r\n`);
            }
          } else if (step === 2 && code === 334) {
            // Send base64 username
            step = 3;
            socket.write(`${Buffer.from(user!).toString('base64')}\r\n`);
          } else if (step === 3 && code === 334) {
            // Send base64 password
            step = 4;
            socket.write(`${Buffer.from(pass!).toString('base64')}\r\n`);
          } else if (step === 4 && code === 235) {
            // Auth success -> MAIL FROM
            step = 5;
            socket.write(`MAIL FROM:<${from}>\r\n`);
          } else if (step === 5 && code === 250) {
            // RCPT TO
            step = 6;
            socket.write(`RCPT TO:<${options.to}>\r\n`);
          } else if (step === 6 && code === 250) {
            // DATA
            step = 7;
            socket.write(`DATA\r\n`);
          } else if (step === 7 && code === 354) {
            // Send headers + body + .
            step = 8;
            const message = [
              `From: ${from}`,
              `To: ${options.to}`,
              `Subject: ${options.subject}`,
              `MIME-Version: 1.0`,
              `Content-Type: text/html; charset=UTF-8`,
              ``,
              options.html,
              `.`,
              ``,
            ].join('\r\n');
            socket.write(message);
          } else if (step === 8 && code === 250) {
            // Message accepted -> QUIT
            step = 9;
            socket.write(`QUIT\r\n`);
            cleanup();
            resolve({ success: true, messageId: `smtp-${Date.now()}` });
            return;
          } else if (code >= 400) {
            cleanup();
            reject(new Error(`SMTP error (${code}): ${line}`));
            return;
          }
        }
      });
    });
  }
}
