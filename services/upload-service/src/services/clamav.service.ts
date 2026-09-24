import net from 'net';
import type { Readable } from 'stream';

export interface ClamAVScanResult {
  isInfected: boolean;
  virusName?: string;
  rawResponse?: string;
}

export class ClamAVService {
  constructor(
    private host: string = 'localhost',
    private port: number = 3310,
    private timeoutMs: number = 10000,
  ) {}

  /**
   * Ping ClamAV daemon. Returns true if responsive.
   */
  async ping(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setTimeout(3000);
      socket.on('connect', () => {
        socket.write('PING\n');
      });
      socket.on('data', (data) => {
        socket.destroy();
        resolve(data.toString().trim() === 'PONG');
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Stream data chunks to ClamAV via the zINSTREAM protocol.
   */
  async scanStream(stream: Readable): Promise<ClamAVScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let responseData = '';
      let isDone = false;

      socket.setTimeout(this.timeoutMs);

      const cleanup = () => {
        isDone = true;
        socket.removeAllListeners();
        socket.destroy();
      };

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');

        stream.on('data', (chunk: Buffer | string) => {
          if (isDone) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const lengthBuf = Buffer.alloc(4);
          lengthBuf.writeUInt32BE(buf.length, 0);
          socket.write(lengthBuf);
          socket.write(buf);
        });

        stream.on('end', () => {
          if (isDone) return;
          const zeroLength = Buffer.alloc(4);
          zeroLength.writeUInt32BE(0, 0);
          socket.write(zeroLength);
        });

        stream.on('error', (err) => {
          cleanup();
          reject(err);
        });
      });

      socket.on('data', (data) => {
        responseData += data.toString();
      });

      socket.on('end', () => {
        cleanup();
        const trimmed = responseData.trim();
        if (trimmed.endsWith('FOUND')) {
          const match = trimmed.match(/stream:\s+(.+)\s+FOUND/);
          resolve({
            isInfected: true,
            virusName: match ? match[1] : 'Threat Detected',
            rawResponse: trimmed,
          });
        } else if (trimmed.endsWith('OK')) {
          resolve({
            isInfected: false,
            rawResponse: trimmed,
          });
        } else {
          resolve({
            isInfected: false,
            rawResponse: trimmed,
          });
        }
      });

      socket.on('error', (err) => {
        cleanup();
        reject(err);
      });

      socket.on('timeout', () => {
        cleanup();
        reject(new Error('ClamAV scan connection timed out'));
      });
    });
  }
}
