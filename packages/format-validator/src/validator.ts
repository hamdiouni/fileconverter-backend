/**
 * Format structural validator.
 *
 * Validates that a buffer's internal structure conforms to the expected
 * format's specification — beyond just magic-number detection.
 *
 * Requirements: 24.4, 24.5
 */

export interface ValidationResult {
  valid: boolean;
  format: string;
  error?: string;
  location?: string;
}

// ─── PNG ────────────────────────────────────────────────────────────────────

function validatePng(buf: Buffer): ValidationResult {
  // Minimum: 8 byte signature + 25 bytes IHDR chunk
  if (buf.length < 33) {
    return { valid: false, format: 'png', error: 'File too small for valid PNG', location: 'offset 0' };
  }

  // Verify signature
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < SIG.length; i++) {
    if (buf[i] !== SIG[i]) {
      return { valid: false, format: 'png', error: `Invalid PNG signature at byte ${i}`, location: `offset ${i}` };
    }
  }

  // First chunk must be IHDR
  const ihdrLength = buf.readUInt32BE(8);
  if (ihdrLength !== 13) {
    return { valid: false, format: 'png', error: `IHDR chunk length must be 13, got ${ihdrLength}`, location: 'offset 8' };
  }

  const ihdrType = buf.slice(12, 16).toString('ascii');
  if (ihdrType !== 'IHDR') {
    return { valid: false, format: 'png', error: `Expected IHDR chunk, got ${ihdrType}`, location: 'offset 12' };
  }

  // Width and height must be > 0
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) {
    return { valid: false, format: 'png', error: 'PNG width/height cannot be zero', location: 'offset 16' };
  }

  // Bit depth must be one of: 1, 2, 4, 8, 16
  const bitDepth = buf[24];
  if (![1, 2, 4, 8, 16].includes(bitDepth!)) {
    return { valid: false, format: 'png', error: `Invalid bit depth: ${bitDepth}`, location: 'offset 24' };
  }

  return { valid: true, format: 'png' };
}

// ─── JPEG ───────────────────────────────────────────────────────────────────

function validateJpeg(buf: Buffer): ValidationResult {
  if (buf.length < 4) {
    return { valid: false, format: 'jpeg', error: 'File too small for valid JPEG', location: 'offset 0' };
  }

  // Must start with FF D8 FF
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return { valid: false, format: 'jpeg', error: 'Invalid JPEG SOI marker', location: 'offset 0' };
  }

  // Must end with FF D9 (EOI marker)
  const last2 = buf.slice(-2);
  if (last2[0] !== 0xff || last2[1] !== 0xd9) {
    return { valid: false, format: 'jpeg', error: 'Missing JPEG EOI marker', location: `offset ${buf.length - 2}` };
  }

  return { valid: true, format: 'jpeg' };
}

// ─── PDF ────────────────────────────────────────────────────────────────────

function validatePdf(buf: Buffer): ValidationResult {
  if (buf.length < 8) {
    return { valid: false, format: 'pdf', error: 'File too small for valid PDF', location: 'offset 0' };
  }

  const header = buf.slice(0, 7).toString('ascii');
  if (!header.startsWith('%PDF-')) {
    return { valid: false, format: 'pdf', error: 'Missing %PDF- header', location: 'offset 0' };
  }

  // Version must be a digit
  const version = header[5];
  if (!version || !/\d/.test(version)) {
    return { valid: false, format: 'pdf', error: 'Invalid PDF version number', location: 'offset 5' };
  }

  // Check for %%EOF near end of file
  const tail = buf.slice(Math.max(0, buf.length - 1024)).toString('ascii');
  if (!tail.includes('%%EOF')) {
    return { valid: false, format: 'pdf', error: 'Missing %%EOF marker', location: `near end of file` };
  }

  return { valid: true, format: 'pdf' };
}

// ─── ZIP ────────────────────────────────────────────────────────────────────

function validateZip(buf: Buffer): ValidationResult {
  if (buf.length < 4) {
    return { valid: false, format: 'zip', error: 'File too small for valid ZIP', location: 'offset 0' };
  }

  // Local file header signature: PK\x03\x04
  if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    return { valid: false, format: 'zip', error: 'Invalid ZIP local file header signature', location: 'offset 0' };
  }

  return { valid: true, format: 'zip' };
}

// ─── GIF ────────────────────────────────────────────────────────────────────

function validateGif(buf: Buffer): ValidationResult {
  if (buf.length < 13) {
    return { valid: false, format: 'gif', error: 'File too small for valid GIF', location: 'offset 0' };
  }

  const header = buf.slice(0, 6).toString('ascii');
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    return { valid: false, format: 'gif', error: `Invalid GIF header: ${header}`, location: 'offset 0' };
  }

  return { valid: true, format: 'gif' };
}

// ─── Public API ─────────────────────────────────────────────────────────────

const VALIDATORS: Record<string, (buf: Buffer) => ValidationResult> = {
  png:  validatePng,
  jpeg: validateJpeg,
  jpg:  validateJpeg,
  pdf:  validatePdf,
  zip:  validateZip,
  docx: validateZip, // DOCX is a ZIP — validate the container
  gif:  validateGif,
};

/**
 * Validate the structural correctness of a file buffer for a given format.
 *
 * @param buffer  Raw file bytes
 * @param format  Expected format (e.g. `"png"`, `"pdf"`)
 */
export function validateFormat(buffer: Buffer, format: string): ValidationResult {
  const fn = VALIDATORS[format.toLowerCase()];
  if (!fn) {
    return { valid: false, format, error: `No validator available for format: ${format}` };
  }
  return fn(buffer);
}
