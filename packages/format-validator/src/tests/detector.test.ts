/**
 * Unit tests for format detector (Task 23.6)
 * Requirements: 24.1, 24.2
 */
import { detectFormat, validateExtension } from '../detector';

// ─── Helpers: build minimal valid magic-byte buffers ─────────────────────────

function pngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function jpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
}

function gifBuffer(): Buffer {
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]); // GIF89a
}

function pdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4 ...rest', 'ascii');
}

function zipBuffer(): Buffer {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
}

function mp4Buffer(): Buffer {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(12, 0);           // box size
  buf.write('ftyp', 4, 'ascii');      // box type
  buf.write('isom', 8, 'ascii');      // brand
  return buf;
}

function mp3Buffer(): Buffer {
  return Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]); // ID3v2.4
}

function unknownBuffer(): Buffer {
  return Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
}

// ─── detectFormat ────────────────────────────────────────────────────────────

describe('detectFormat', () => {
  it('detects PNG from valid PNG header', () => {
    expect(detectFormat(pngBuffer())).toBe('png');
  });

  it('detects JPEG from FF D8 FF marker', () => {
    expect(detectFormat(jpegBuffer())).toBe('jpeg');
  });

  it('detects GIF89a', () => {
    expect(detectFormat(gifBuffer())).toBe('gif');
  });

  it('detects GIF87a', () => {
    const buf = Buffer.from('GIF87a\x01\x00', 'binary');
    expect(detectFormat(buf)).toBe('gif');
  });

  it('detects PDF from %PDF header', () => {
    expect(detectFormat(pdfBuffer())).toBe('pdf');
  });

  it('detects ZIP from PK header', () => {
    expect(detectFormat(zipBuffer())).toBe('zip');
  });

  it('detects MP4 from ftyp box at offset 4', () => {
    expect(detectFormat(mp4Buffer())).toBe('mp4');
  });

  it('detects MP3 from ID3 header', () => {
    expect(detectFormat(mp3Buffer())).toBe('mp3');
  });

  it('returns null for empty buffer', () => {
    expect(detectFormat(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for unknown bytes', () => {
    expect(detectFormat(unknownBuffer())).toBeNull();
  });

  it('detects DOCX (ZIP with word/ content)', () => {
    // Build a fake ZIP with "word/" in its content
    const zipSig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const content = Buffer.from('word/document.xml', 'ascii');
    expect(detectFormat(Buffer.concat([zipSig, content]))).toBe('docx');
  });
});

// ─── validateExtension ───────────────────────────────────────────────────────

describe('validateExtension', () => {
  it('accepts "png" extension for PNG buffer', () => {
    expect(validateExtension(pngBuffer(), 'png')).toBe(true);
  });

  it('accepts "jpg" extension for JPEG buffer', () => {
    expect(validateExtension(jpegBuffer(), 'jpg')).toBe(true);
  });

  it('accepts "jpeg" extension for JPEG buffer', () => {
    expect(validateExtension(jpegBuffer(), 'jpeg')).toBe(true);
  });

  it('rejects "png" extension for JPEG buffer', () => {
    expect(validateExtension(jpegBuffer(), 'png')).toBe(false);
  });

  it('rejects "jpg" extension for PNG buffer', () => {
    expect(validateExtension(pngBuffer(), 'jpg')).toBe(false);
  });

  it('accepts "gif" extension for GIF buffer', () => {
    expect(validateExtension(gifBuffer(), 'gif')).toBe(true);
  });

  it('accepts "pdf" extension for PDF buffer', () => {
    expect(validateExtension(pdfBuffer(), 'pdf')).toBe(true);
  });

  it('accepts "zip" extension for ZIP buffer', () => {
    expect(validateExtension(zipBuffer(), 'zip')).toBe(true);
  });

  it('accepts "mp4" extension for MP4 buffer', () => {
    expect(validateExtension(mp4Buffer(), 'mp4')).toBe(true);
  });

  it('accepts "mp3" extension for MP3 buffer', () => {
    expect(validateExtension(mp3Buffer(), 'mp3')).toBe(true);
  });

  it('rejects unknown buffer regardless of extension', () => {
    expect(validateExtension(unknownBuffer(), 'png')).toBe(false);
  });

  it('is case-insensitive for extensions', () => {
    expect(validateExtension(pngBuffer(), 'PNG')).toBe(true);
    expect(validateExtension(jpegBuffer(), 'JPG')).toBe(true);
  });
});
