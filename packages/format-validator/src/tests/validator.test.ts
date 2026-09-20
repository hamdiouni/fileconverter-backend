/**
 * Unit tests for structural format validator (Task 23.3)
 * Requirements: 24.4, 24.5
 */
import { validateFormat } from '../validator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validPng(): Buffer {
  const buf = Buffer.alloc(33);
  // Signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  // IHDR chunk: length=13
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(100, 16); // width
  buf.writeUInt32BE(100, 20); // height
  buf[24] = 8;  // bit depth
  buf[25] = 2;  // colour type
  return buf;
}

function validJpeg(): Buffer {
  // Start + some content + EOI
  const start = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const end   = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([start, Buffer.alloc(10), end]);
}

function validPdf(): Buffer {
  return Buffer.from('%PDF-1.4\n...some content...\n%%EOF\n', 'ascii');
}

function validZip(): Buffer {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
}

function validGif(): Buffer {
  const buf = Buffer.alloc(20);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(10, 6);  // width
  buf.writeUInt16LE(10, 8);  // height
  return buf;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validateFormat - PNG', () => {
  it('accepts a valid PNG buffer', () => {
    expect(validateFormat(validPng(), 'png').valid).toBe(true);
  });

  it('rejects buffer that is too small', () => {
    const res = validateFormat(Buffer.alloc(5), 'png');
    expect(res.valid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('rejects PNG with wrong signature', () => {
    const buf = validPng();
    buf[0] = 0x00;
    const res = validateFormat(buf, 'png');
    expect(res.valid).toBe(false);
  });

  it('rejects PNG with wrong IHDR type', () => {
    const buf = validPng();
    buf.write('XXXX', 12, 'ascii');
    const res = validateFormat(buf, 'png');
    expect(res.valid).toBe(false);
  });

  it('rejects PNG with zero width', () => {
    const buf = validPng();
    buf.writeUInt32BE(0, 16);
    const res = validateFormat(buf, 'png');
    expect(res.valid).toBe(false);
  });

  it('rejects PNG with invalid bit depth', () => {
    const buf = validPng();
    buf[24] = 7; // invalid
    const res = validateFormat(buf, 'png');
    expect(res.valid).toBe(false);
    expect(res.location).toBeDefined();
  });
});

describe('validateFormat - JPEG', () => {
  it('accepts a valid JPEG buffer', () => {
    expect(validateFormat(validJpeg(), 'jpeg').valid).toBe(true);
  });

  it('accepts "jpg" alias', () => {
    expect(validateFormat(validJpeg(), 'jpg').valid).toBe(true);
  });

  it('rejects buffer too small', () => {
    expect(validateFormat(Buffer.alloc(2), 'jpeg').valid).toBe(false);
  });

  it('rejects JPEG missing SOI marker', () => {
    const buf = validJpeg();
    buf[0] = 0x00;
    expect(validateFormat(buf, 'jpeg').valid).toBe(false);
  });

  it('rejects JPEG missing EOI marker', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10)]);
    expect(validateFormat(buf, 'jpeg').valid).toBe(false);
  });
});

describe('validateFormat - PDF', () => {
  it('accepts a valid PDF buffer', () => {
    expect(validateFormat(validPdf(), 'pdf').valid).toBe(true);
  });

  it('rejects PDF missing %PDF- header', () => {
    expect(validateFormat(Buffer.from('not a pdf', 'ascii'), 'pdf').valid).toBe(false);
  });

  it('rejects PDF missing %%EOF marker', () => {
    const buf = Buffer.from('%PDF-1.4\nsome content', 'ascii');
    expect(validateFormat(buf, 'pdf').valid).toBe(false);
  });
});

describe('validateFormat - ZIP', () => {
  it('accepts a valid ZIP buffer', () => {
    expect(validateFormat(validZip(), 'zip').valid).toBe(true);
  });

  it('rejects ZIP with wrong signature', () => {
    expect(validateFormat(Buffer.from([0x00, 0x00, 0x00, 0x00]), 'zip').valid).toBe(false);
  });
});

describe('validateFormat - GIF', () => {
  it('accepts a valid GIF89a buffer', () => {
    expect(validateFormat(validGif(), 'gif').valid).toBe(true);
  });

  it('accepts GIF87a', () => {
    const buf = Buffer.alloc(20);
    buf.write('GIF87a', 0, 'ascii');
    expect(validateFormat(buf, 'gif').valid).toBe(true);
  });

  it('rejects invalid GIF header', () => {
    const buf = Buffer.from('NOTGIF89a', 'ascii');
    expect(validateFormat(buf, 'gif').valid).toBe(false);
  });
});

describe('validateFormat - unknown format', () => {
  it('returns valid=false for unsupported format', () => {
    const res = validateFormat(Buffer.alloc(10), 'xyz');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/No validator/i);
  });
});
