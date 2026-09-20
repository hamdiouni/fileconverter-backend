/**
 * Canonical intermediate formats per format family.
 * Requirements: 25.1
 */

export type FormatFamily = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'cad' | 'font';

/** Canonical (hub) format for each family used as the intermediate in multi-step conversions */
export const CANONICAL_FORMAT: Record<FormatFamily, string> = {
  image:    'png',
  video:    'mp4',
  audio:    'mp3',
  document: 'pdf',
  archive:  'zip',
  cad:      'svg',
  font:     'ttf',
};

/** All formats grouped by family */
export const FORMAT_FAMILIES: Record<FormatFamily, string[]> = {
  image:    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'svg', 'raw'],
  video:    ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'],
  audio:    ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
  document: ['pdf', 'doc', 'docx', 'txt', 'html', 'md', 'odt', 'rtf'],
  archive:  ['zip', 'rar', '7z', 'tar', 'gz'],
  cad:      ['dwg', 'dxf', 'svg', 'pdf'],
  font:     ['ttf', 'otf', 'woff', 'woff2', 'eot'],
};

/** Reverse lookup: format → family */
export function getFamilyForFormat(format: string): FormatFamily | null {
  const f = format.toLowerCase();
  for (const [family, formats] of Object.entries(FORMAT_FAMILIES)) {
    if (formats.includes(f)) return family as FormatFamily;
  }
  return null;
}

/** Get the canonical format for a given source format, or null if no family found */
export function getCanonicalFormat(format: string): string | null {
  const family = getFamilyForFormat(format);
  if (!family) return null;
  return CANONICAL_FORMAT[family];
}
