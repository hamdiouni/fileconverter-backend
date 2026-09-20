/**
 * Property-Based Tests for Cache Key Generation
 * 
 * Feature: backend-microservices-architecture
 * Property 5: Cache Key Consistency and Personalization Exclusion
 * Validates: Requirements 26.1, 26.6
 */

import * as fc from 'fast-check';
import { generateCacheKey, isCacheable, ConversionRequest } from '../../utils/cache-key';

describe('Property 5: Cache Key Consistency and Personalization Exclusion', () => {
  // Arbitrary generators for conversion requests
  
  /**
   * Generate arbitrary source file IDs (UUIDs or similar identifiers)
   */
  const arbSourceFileId = fc.uuid();

  /**
   * Generate arbitrary target formats
   */
  const arbTargetFormat = fc.oneof(
    fc.constantFrom('jpg', 'png', 'pdf', 'docx', 'mp4', 'mp3', 'webp', 'svg'),
    fc.string({ minLength: 1, maxLength: 10 }).map(s => s.toLowerCase())
  );

  /**
   * Generate arbitrary non-personalized conversion options
   */
  const arbNonPersonalizedOptions = fc.record({
    quality: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    width: fc.option(fc.integer({ min: 100, max: 10000 }), { nil: undefined }),
    height: fc.option(fc.integer({ min: 100, max: 10000 }), { nil: undefined }),
    preserveMetadata: fc.option(fc.boolean(), { nil: undefined }),
    codec: fc.option(fc.constantFrom('h264', 'h265', 'vp9', 'av1'), { nil: undefined }),
    bitrate: fc.option(fc.constantFrom('128k', '256k', '320k', '512k'), { nil: undefined }),
    pages: fc.option(fc.constantFrom('1-5', 'all', '1,3,5'), { nil: undefined })
  }, { requiredKeys: [] });

  /**
   * Generate arbitrary personalized conversion options
   */
  const arbPersonalizedOptions = fc.record({
    watermark: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
    userMetadata: fc.option(fc.dictionary(fc.string(), fc.anything())),
    personalizedText: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
    quality: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined })
  });

  /**
   * Generate arbitrary conversion request without personalization
   */
  const arbConversionRequest = fc.record({
    sourceFileId: arbSourceFileId,
    targetFormat: arbTargetFormat,
    options: fc.option(arbNonPersonalizedOptions, { nil: undefined })
  });

  /**
   * Generate arbitrary conversion request with personalization
   */
  const arbConversionRequestWithPersonalization = fc.record({
    sourceFileId: arbSourceFileId,
    targetFormat: arbTargetFormat,
    options: arbPersonalizedOptions
  });

  /**
   * Property 1: Consistency - identical requests produce identical cache keys
   * 
   * For any conversion request, calling generateCacheKey twice should
   * return the exact same cache key.
   */
  test.concurrent('Property 1: Identical requests produce identical cache keys', () => {
    fc.assert(
      fc.property(arbConversionRequest, (request) => {
        const key1 = generateCacheKey(request);
        const key2 = generateCacheKey(request);
        
        // Same input must produce same output
        return key1 === key2;
      }),
      { numRuns: 100, verbose: true }
    );
  });

  /**
   * Property 2: Uniqueness - different requests produce different cache keys
   * 
   * For any two different conversion requests, the cache keys should be different
   * with very high probability (unless there's a hash collision, which is extremely rare).
   */
  test.concurrent('Property 2: Different requests produce different cache keys', () => {
    fc.assert(
      fc.property(arbConversionRequest, arbConversionRequest, (request1, request2) => {
        // Pre-condition: requests must be genuinely different
        const areRequestsDifferent = 
          request1.sourceFileId !== request2.sourceFileId ||
          request1.targetFormat.toLowerCase() !== request2.targetFormat.toLowerCase() ||
          JSON.stringify(request1.options || {}) !== JSON.stringify(request2.options || {});

        // Skip if requests are identical
        if (!areRequestsDifferent) {
          return true;
        }

        const key1 = generateCacheKey(request1);
        const key2 = generateCacheKey(request2);
        
        // Different inputs should produce different keys
        // (hash collisions are theoretically possible but extremely rare with SHA-256)
        return key1 !== key2;
      }),
      { numRuns: 100, verbose: true }
    );
  });

  /**
   * Property 3: Personalization Exclusion - personalized requests return null
   * 
   * Any conversion request with personalization options (watermark, userMetadata, etc.)
   * should return null from generateCacheKey, indicating it's not cacheable.
   */
  test.concurrent('Property 3: Personalized requests return null (not cacheable)', () => {
    fc.assert(
      fc.property(arbConversionRequestWithPersonalization, (request) => {
        // Check if request has any non-null/undefined personalization options
        const hasPersonalization = request.options && (
          (request.options.watermark !== null && request.options.watermark !== undefined) ||
          (request.options.userMetadata !== null && request.options.userMetadata !== undefined) ||
          (request.options.personalizedText !== null && request.options.personalizedText !== undefined)
        );

        if (!hasPersonalization) {
          // If no personalization, should be cacheable
          return true;
        }

        const cacheKey = generateCacheKey(request);
        const cacheable = isCacheable(request);
        
        // Personalized requests must return null and be marked as not cacheable
        return cacheKey === null && cacheable === false;
      }),
      { numRuns: 100, verbose: true }
    );
  });

  /**
   * Property 4: Case insensitivity for target format
   * 
   * Target format should be normalized (case-insensitive), so "JPG", "jpg", and "Jpg"
   * should all produce the same cache key for the same source file and options.
   */
  test.concurrent('Property 4: Target format is case-insensitive', () => {
    fc.assert(
      fc.property(arbSourceFileId, arbTargetFormat, arbNonPersonalizedOptions, 
        (sourceFileId, targetFormat, options) => {
          const request1: ConversionRequest = {
            sourceFileId,
            targetFormat: targetFormat.toLowerCase(),
            options
          };

          const request2: ConversionRequest = {
            sourceFileId,
            targetFormat: targetFormat.toUpperCase(),
            options
          };

          const request3: ConversionRequest = {
            sourceFileId,
            targetFormat: targetFormat.charAt(0).toUpperCase() + targetFormat.slice(1).toLowerCase(),
            options
          };

          const key1 = generateCacheKey(request1);
          const key2 = generateCacheKey(request2);
          const key3 = generateCacheKey(request3);

          // All should produce the same key
          return key1 === key2 && key2 === key3;
        }
      ),
      { numRuns: 100, verbose: true }
    );
  });

  /**
   * Property 5: Options ordering independence
   * 
   * The order of options keys should not affect the cache key.
   * { quality: 80, width: 100 } should produce the same key as { width: 100, quality: 80 }
   */
  test.concurrent('Property 5: Options key order does not affect cache key', () => {
    fc.assert(
      fc.property(arbSourceFileId, arbTargetFormat, (sourceFileId, targetFormat) => {
        // Create two requests with same options in different order
        const request1: ConversionRequest = {
          sourceFileId,
          targetFormat,
          options: { quality: 80, width: 1920, height: 1080 }
        };

        const request2: ConversionRequest = {
          sourceFileId,
          targetFormat,
          options: { height: 1080, quality: 80, width: 1920 }
        };

        const key1 = generateCacheKey(request1);
        const key2 = generateCacheKey(request2);

        // Should produce identical keys
        return key1 === key2;
      }),
      { numRuns: 100, verbose: true }
    );
  });

  /**
   * Additional edge case tests (not property-based but important)
   */
  describe('Edge cases', () => {
    test('Empty options should produce valid cache key', () => {
      const request: ConversionRequest = {
        sourceFileId: '123e4567-e89b-12d3-a456-426614174000',
        targetFormat: 'pdf',
        options: {}
      };

      const key = generateCacheKey(request);
      expect(key).not.toBeNull();
      expect(typeof key).toBe('string');
      expect(key).toHaveLength(64); // SHA-256 produces 64 hex characters
    });

    test('Undefined options should produce valid cache key', () => {
      const request: ConversionRequest = {
        sourceFileId: '123e4567-e89b-12d3-a456-426614174000',
        targetFormat: 'pdf'
      };

      const key = generateCacheKey(request);
      expect(key).not.toBeNull();
      expect(typeof key).toBe('string');
      expect(key).toHaveLength(64);
    });

    test('Request with watermark should return null', () => {
      const request: ConversionRequest = {
        sourceFileId: '123e4567-e89b-12d3-a456-426614174000',
        targetFormat: 'pdf',
        options: {
          watermark: 'Copyright 2024',
          quality: 90
        }
      };

      const key = generateCacheKey(request);
      expect(key).toBeNull();
    });

    test('Request with userMetadata should return null', () => {
      const request: ConversionRequest = {
        sourceFileId: '123e4567-e89b-12d3-a456-426614174000',
        targetFormat: 'pdf',
        options: {
          userMetadata: { userId: 'user123', name: 'John Doe' }
        }
      };

      const key = generateCacheKey(request);
      expect(key).toBeNull();
    });

    test('Same request generates same 64-character hex hash', () => {
      const request: ConversionRequest = {
        sourceFileId: '123e4567-e89b-12d3-a456-426614174000',
        targetFormat: 'jpg',
        options: { quality: 85 }
      };

      const key1 = generateCacheKey(request);
      const key2 = generateCacheKey(request);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
