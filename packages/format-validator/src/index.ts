// Format detection (magic number)
export { detectFormat, validateExtension } from './detector';
export type { DetectedFormat } from './detector';

// Structural validation
export { validateFormat } from './validator';
export type { ValidationResult } from './validator';

// Format parser / pretty-printer
export { parseFormat, prettyPrintFormat } from './parser';
export type { FormatObject } from './parser';
