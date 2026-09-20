/**
 * Unit + Property tests for format parser/pretty-printer
 *
 * Property 3: Round-trip preservation — parse(print(obj)) deepEquals obj
 * Requirements: 24.6, 24.7
 */
import * as fc from 'fast-check';
import { parseFormat, prettyPrintFormat } from '../parser';

// ─── Unit tests ──────────────────────────────────────────────────────────────

describe('parseFormat', () => {
  it('parses a simple format string', () => {
    expect(parseFormat('image/png')).toEqual({
      family: 'image', name: 'png', variant: null, options: [],
    });
  });

  it('parses format with variant', () => {
    expect(parseFormat('image/jpeg:progressive')).toEqual({
      family: 'image', name: 'jpeg', variant: 'progressive', options: [],
    });
  });

  it('parses format with options', () => {
    expect(parseFormat('video/mp4:h264+aac+hls')).toEqual({
      family: 'video', name: 'mp4', variant: 'h264', options: ['aac', 'hls'],
    });
  });

  it('normalises to lowercase', () => {
    const result = parseFormat('IMAGE/PNG');
    expect(result.family).toBe('image');
    expect(result.name).toBe('png');
  });

  it('handles document formats', () => {
    expect(parseFormat('document/pdf:1.7')).toEqual({
      family: 'document', name: 'pdf', variant: '1.7', options: [],
    });
  });

  it('throws on missing slash', () => {
    expect(() => parseFormat('noslash')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => parseFormat('')).toThrow();
  });

  it('throws when family is empty', () => {
    expect(() => parseFormat('/png')).toThrow();
  });

  it('throws when name is empty', () => {
    expect(() => parseFormat('image/')).toThrow();
  });
});

describe('prettyPrintFormat', () => {
  it('serialises a simple object', () => {
    expect(prettyPrintFormat({ family: 'image', name: 'png', variant: null, options: [] }))
      .toBe('image/png');
  });

  it('includes variant when set', () => {
    expect(prettyPrintFormat({ family: 'image', name: 'jpeg', variant: 'progressive', options: [] }))
      .toBe('image/jpeg:progressive');
  });

  it('includes options', () => {
    expect(prettyPrintFormat({ family: 'video', name: 'mp4', variant: 'h264', options: ['aac', 'hls'] }))
      .toBe('video/mp4:h264+aac+hls');
  });

  it('omits variant when null', () => {
    const s = prettyPrintFormat({ family: 'audio', name: 'mp3', variant: null, options: [] });
    expect(s).not.toContain(':');
  });

  it('omits options when empty array', () => {
    const s = prettyPrintFormat({ family: 'audio', name: 'flac', variant: null, options: [] });
    expect(s).not.toContain('+');
  });
});

// ─── Property 3: Round-trip ───────────────────────────────────────────────────

describe('Property 3: Format Parser Round-Trip Preservation', () => {
  const identifier = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/);
  const optionList = fc.array(identifier, { minLength: 0, maxLength: 4 });

  const formatObject = fc.record({
    family:  identifier,
    name:    identifier,
    variant: fc.oneof(fc.constant(null), identifier),
    options: optionList,
  });

  it('parse(print(obj)) produces an object deepEqual to obj (100 iterations)', () => {
    fc.assert(
      fc.property(formatObject, (obj) => {
        const printed  = prettyPrintFormat(obj);
        const reparsed = parseFormat(printed);
        expect(reparsed).toEqual(obj);
      }),
      { numRuns: 100 },
    );
  });

  it('print(parse(str)) produces the same string for canonical strings (100 iterations)', () => {
    // Build arbitrary canonical strings directly from the FormatObject generator
    fc.assert(
      fc.property(formatObject, (obj) => {
        const canonical = prettyPrintFormat(obj);
        const reprinted = prettyPrintFormat(parseFormat(canonical));
        expect(reprinted).toBe(canonical);
      }),
      { numRuns: 100 },
    );
  });
});
