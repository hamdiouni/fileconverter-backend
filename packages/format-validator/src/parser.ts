/**
 * Format parser and pretty-printer.
 *
 * Defines the canonical internal representation of a "format string" and
 * provides parse → print round-trip guarantees.
 *
 * A format string has the shape:  family/name[:variant][+options...]
 * Examples:
 *   "image/png"
 *   "image/jpeg:progressive"
 *   "video/mp4:h264+aac"
 *   "document/pdf:1.7"
 *
 * Requirements: 24.6, 24.7
 */

export interface FormatObject {
  family: string;
  name: string;
  variant: string | null;
  options: string[];
}

/**
 * Parse a canonical format string into a structured FormatObject.
 *
 * Throws if the string is not a valid format string.
 */
export function parseFormat(formatStr: string): FormatObject {
  if (!formatStr || typeof formatStr !== 'string') {
    throw new Error(`Invalid format string: ${String(formatStr)}`);
  }

  const trimmed = formatStr.trim();

  // Must contain at least one slash
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(`Format string must be "family/name[...]", got: "${trimmed}"`);
  }

  const family = trimmed.slice(0, slashIdx).toLowerCase();
  if (!family) throw new Error(`Format family cannot be empty in: "${trimmed}"`);

  const rest = trimmed.slice(slashIdx + 1);

  // Split off options (after '+')
  const [nameAndVariant, ...optionParts] = rest.split('+');
  const options = optionParts.map((o) => o.toLowerCase());

  // Split off variant (after ':')
  const colonIdx = (nameAndVariant ?? '').indexOf(':');
  let name: string;
  let variant: string | null;

  if (colonIdx === -1) {
    name = (nameAndVariant ?? '').toLowerCase();
    variant = null;
  } else {
    name = (nameAndVariant ?? '').slice(0, colonIdx).toLowerCase();
    variant = (nameAndVariant ?? '').slice(colonIdx + 1).toLowerCase() || null;
  }

  if (!name) throw new Error(`Format name cannot be empty in: "${trimmed}"`);

  return { family, name, variant, options };
}

/**
 * Serialise a FormatObject back to its canonical string representation.
 *
 * This is the inverse of `parseFormat`.  The guarantee:
 *   parseFormat(prettyPrintFormat(obj))  deepEquals  obj
 */
export function prettyPrintFormat(fmt: FormatObject): string {
  let result = `${fmt.family}/${fmt.name}`;

  if (fmt.variant) {
    result += `:${fmt.variant}`;
  }

  if (fmt.options.length > 0) {
    result += `+${fmt.options.join('+')}`;
  }

  return result;
}
