import crypto from 'crypto';

/**
 * Conversion request interface for cache key generation
 */
export interface ConversionRequest {
  sourceFileId: string;
  targetFormat: string;
  options?: ConversionOptions;
}

/**
 * Conversion options that may affect caching
 */
export interface ConversionOptions {
  quality?: number | null;
  width?: number | null;
  height?: number | null;
  preserveMetadata?: boolean | null;
  codec?: string | null;
  bitrate?: string | null;
  pages?: string | null;
  // Personalization options that prevent caching
  watermark?: string | null;
  userMetadata?: Record<string, any> | null;
  personalizedText?: string | null;
  [key: string]: any;
}

/**
 * Personalization option keys that prevent caching
 */
const PERSONALIZATION_KEYS = [
  'watermark',
  'userMetadata',
  'personalizedText',
  'userId',
  'userName',
  'userEmail',
  'customWatermark',
  'ownerStamp'
];

/**
 * Check if a conversion request is cacheable.
 * Returns false if the request contains personalization options.
 * 
 * **Validates: Requirements 26.6**
 * 
 * @param request - The conversion request to check
 * @returns true if cacheable, false if personalized
 */
export function isCacheable(request: ConversionRequest): boolean {
  if (!request.options) {
    return true;
  }

  // Check if any personalization keys are present
  for (const key of PERSONALIZATION_KEYS) {
    if (key in request.options && request.options[key] !== null && request.options[key] !== undefined) {
      return false;
    }
  }

  return true;
}

/**
 * Generate a consistent cache key for a conversion request.
 * Returns null if the request contains personalization options (not cacheable).
 * 
 * **Validates: Requirements 26.1, 26.6**
 * 
 * Cache key is computed as SHA-256 hash of:
 * - source file ID
 * - target format (normalized to lowercase)
 * - sorted conversion options (excluding personalization keys)
 * 
 * @param request - The conversion request
 * @returns Cache key string or null if not cacheable
 */
export function generateCacheKey(request: ConversionRequest): string | null {
  // Check if request is cacheable
  if (!isCacheable(request)) {
    return null;
  }

  // Normalize target format to lowercase
  const normalizedFormat = request.targetFormat.toLowerCase().trim();

  // Create a normalized options object by sorting keys
  const normalizedOptions: Record<string, any> = {};
  
  if (request.options) {
    // Sort keys to ensure consistent ordering
    const sortedKeys = Object.keys(request.options).sort();
    
    for (const key of sortedKeys) {
      const value = request.options[key];
      // Skip undefined, null values, and personalization keys
      if (value !== undefined && value !== null && !PERSONALIZATION_KEYS.includes(key)) {
        normalizedOptions[key] = value;
      }
    }
  }

  // Create a canonical string representation
  const canonical = JSON.stringify({
    sourceFileId: request.sourceFileId,
    targetFormat: normalizedFormat,
    options: normalizedOptions
  });

  // Compute SHA-256 hash
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');

  return hash;
}
