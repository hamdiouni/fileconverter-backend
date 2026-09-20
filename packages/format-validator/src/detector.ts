/**
 * Format detector — reads magic-number bytes to identify the real file type.
 *
 * Supports: PNG, JPEG, GIF, PDF, ZIP, MP4, MP3, DOCX/XLSX/PPTX (Office Open XML).
 *
 * Requirements: 24.1, 24.2
 */

export type DetectedFormat =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'pdf'
  | 'zip'
  | 'mp4'
  | 'mp3'
  | 'docx'
  | null;

interface Signature {
  format: DetectedFormat;
  offset: number;
  bytes: number[];
}

/** Ordered from most specific to least specific */
const SIGNATURES: Signature[] = [
  // PNG: 8-byte signature
  { format: 'png',  offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // GIF: GIF87a or GIF89a
  { format: 'gif',  offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  // JPEG: FF D8 FF (JFIF / Exif / arbitrary JPEG)
  { format: 'jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  // PDF: %PDF
  { format: 'pdf',  offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  // MP3: ID3 tag header
  { format: 'mp3',  offset: 0, bytes: [0x49, 0x44, 0x33] },
  // MP3: sync word (MPEG frame without ID3) — FF FB / FF FA / FF F3
  { format: 'mp3',  offset: 0, bytes: [0xff, 0xfb] },
  // ZIP / DOCX / XLSX etc: PK\x03\x04
  { format: 'zip',  offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  // MP4: ftyp box at offset 4 (bytes 0-3 = box size, bytes 4-7 = 'ftyp')
  { format: 'mp4',  offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
];

/**
 * Detect the real format of a file by inspecting its magic-number header bytes.
 *
 * @param buffer  Raw bytes of the file (needs at least the first 12 bytes)
 * @returns The detected format name, or `null` if unrecognised
 */
export function detectFormat(buffer: Uint8Array | Buffer): DetectedFormat {
  for (const sig of SIGNATURES) {
    if (buffer.length < sig.offset + sig.bytes.length) continue;

    const matches = sig.bytes.every(
      (byte, i) => buffer[sig.offset + i] === byte,
    );

    if (matches) {
      // ZIP containers can contain Office Open XML — check for DOCX specifically
      if (sig.format === 'zip') {
        return detectOoxmlVariant(buffer);
      }
      return sig.format;
    }
  }

  return null;
}

/**
 * Attempt to distinguish DOCX (Office Open XML) from a plain ZIP.
 * A true DOCX must contain a `[Content_Types].xml` entry right at the start
 * of the central directory. We check for the presence of the well-known
 * `word/` directory marker bytes.
 *
 * For the purpose of magic-number detection we return 'docx' only when we
 * find the `word/` prefix inside the local file-entry names; otherwise we
 * keep the generic 'zip' classification.
 */
function detectOoxmlVariant(buffer: Uint8Array | Buffer): 'docx' | 'zip' {
  // Look for "word/" text inside the buffer (cheap heuristic)
  const needle = [0x77, 0x6f, 0x72, 0x64, 0x2f]; // "word/"
  for (let i = 0; i < buffer.length - needle.length; i++) {
    if (needle.every((b, j) => buffer[i + j] === b)) return 'docx';
  }
  return 'zip';
}

/**
 * Validate that the declared file extension is consistent with the detected
 * magic-number format.  Returns `true` when they match, `false` when there is
 * a mismatch.
 *
 * @param buffer     Raw bytes of the file
 * @param extension  Extension WITHOUT the leading dot, e.g. `"png"`, `"jpg"`
 */
export function validateExtension(
  buffer: Uint8Array | Buffer,
  extension: string,
): boolean {
  const detected = detectFormat(buffer);
  if (detected === null) return false; // unknown format — cannot validate

  const ext = extension.toLowerCase();

  const ALIASES: Record<DetectedFormat & string, string[]> = {
    png:  ['png'],
    jpeg: ['jpg', 'jpeg', 'jfif'],
    gif:  ['gif'],
    pdf:  ['pdf'],
    zip:  ['zip'],
    mp4:  ['mp4', 'm4v', 'm4a'],
    mp3:  ['mp3'],
    docx: ['docx', 'xlsx', 'pptx', 'odt', 'ods'],
  };

  return (ALIASES[detected] ?? []).includes(ext);
}
