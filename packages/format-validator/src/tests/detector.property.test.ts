/**
 * Property 1: Format Detection Accuracy
 * Requirements: 24.1, 24.2
 *
 * Uses fast-check to verify that detectFormat() returns the correct format
 * based on magic bytes (content), regardless of arbitrary trailing bytes.
 */
import * as fc from 'fast-check';
import { detectFormat } from '../detector';

// ─── Signature factories ─────────────────────────────────────────────────────

const PNG_SIG  = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];
const GIF89_SIG = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const PDF_SIG  = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]; // %PDF-1.
const ZIP_SIG  = [0x50, 0x4b, 0x03, 0x04];
const ID3_SIG  = [0x49, 0x44, 0x33];

function makeBuffer(sig: number[], trailing: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(sig), Buffer.from(trailing)]);
}

function makeMP4Buffer(trailing: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(12, 0);
  header.write('ftyp', 4, 'ascii');
  return Buffer.concat([header, Buffer.from(trailing)]);
}

// ─── Property tests ──────────────────────────────────────────────────────────

describe('Property 1: Format Detection Accuracy', () => {
  // Arbitrary trailing byte array (0–100 bytes of any content)
  const trailing = fc.uint8Array({ minLength: 0, maxLength: 100 });

  it('P1a: buffers starting with PNG signature always detect as "png"', () => {
    fc.assert(
      fc.property(trailing, (t) => {
        expect(detectFormat(makeBuffer(PNG_SIG, t))).toBe('png');
      }),
      { numRuns: 200 },
    );
  });

  it('P1b: buffers starting with JPEG signature always detect as "jpeg"', () => {
    fc.assert(
      fc.property(trailing, (t) => {
        expect(detectFormat(makeBuffer(JPEG_SIG, t))).toBe('jpeg');
      }),
      { numRuns: 200 },
    );
  });

  it('P1c: buffers starting with GIF89a signature always detect as "gif"', () => {
    fc.assert(
      fc.property(trailing, (t) => {
        expect(detectFormat(makeBuffer(GIF89_SIG, t))).toBe('gif');
      }),
      { numRuns: 200 },
    );
  });

  it('P1d: buffers starting with %PDF-1. signature always detect as "pdf"', () => {
    fc.assert(
      fc.property(trailing, (t) => {
        expect(detectFormat(makeBuffer(PDF_SIG, t))).toBe('pdf');
      }),
      { numRuns: 200 },
    );
  });

  it('P1e: buffers starting with ZIP signature and no "word/" detect as "zip"', () => {
    // Make trailing bytes that do not contain the sequence for "word/"
    const noWordTrailing = fc.uint8Array({ minLength: 0, maxLength: 50 }).filter((arr) => {
      const s = Buffer.from(arr).toString('ascii');
      return !s.includes('word/');
    });

    fc.assert(
      fc.property(noWordTrailing, (t) => {
        expect(detectFormat(makeBuffer(ZIP_SIG, t))).toBe('zip');
      }),
      { numRuns: 200 },
    );
  });

  it('P1f: buffers with ID3 header always detect as "mp3"', () => {
    fc.assert(
      fc.property(trailing, (t) => {
        expect(detectFormat(makeBuffer(ID3_SIG, t))).toBe('mp3');
      }),
      { numRuns: 200 },
    );
  });

  it('P1g: MP4 ftyp-box buffers always detect as "mp4"', () => {
    fc.assert(
      fc.property(trailing, (t) => {
        expect(detectFormat(makeMP4Buffer(t))).toBe('mp4');
      }),
      { numRuns: 200 },
    );
  });

  it('P1h: buffers starting with NULL bytes never match a known format', () => {
    const nullBytes = fc.uint8Array({ minLength: 4, maxLength: 20 }).map((arr) => {
      arr.fill(0);
      return arr;
    });
    fc.assert(
      fc.property(nullBytes, (t) => {
        expect(detectFormat(t)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
