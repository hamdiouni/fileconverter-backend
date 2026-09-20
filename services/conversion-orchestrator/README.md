# Conversion Orchestrator Service

The Conversion Orchestrator service manages file conversion jobs, routing them to appropriate worker queues, tracking job status, and implementing result caching.

## Features

### Cache Key Generation

The service implements intelligent cache key generation for conversion results:

- **Consistent Hashing**: Identical conversion requests produce identical cache keys using SHA-256 hashing
- **Personalization Exclusion**: Requests with user-specific options (watermarks, user metadata) are automatically excluded from caching
- **Case-Insensitive Format Matching**: Target formats are normalized to lowercase
- **Order-Independent Options**: Option key ordering doesn't affect cache keys

#### Usage

```typescript
import { generateCacheKey, isCacheable } from './utils/cache-key';

const request = {
  sourceFileId: '123e4567-e89b-12d3-a456-426614174000',
  targetFormat: 'pdf',
  options: {
    quality: 90,
    width: 1920
  }
};

// Check if request is cacheable
if (isCacheable(request)) {
  const cacheKey = generateCacheKey(request);
  // Use cache key to lookup or store cached results
  console.log('Cache key:', cacheKey);
} else {
  // Process without caching
  console.log('Request contains personalization - not cacheable');
}
```

#### Personalization Detection

The following option keys are considered personalization and prevent caching:

- `watermark` - User-specific watermarks
- `userMetadata` - User-specific metadata
- `personalizedText` - Custom text overlays
- `userId`, `userName`, `userEmail` - User identifiers
- `customWatermark`, `ownerStamp` - Owner identifiers

## Testing

### Property-Based Tests

The cache key generation is validated with property-based tests using fast-check:

```bash
# Run all tests
npm test

# Run only property tests
npm run test:properties
```

**Properties Validated**:
1. **Consistency**: Identical requests always produce identical cache keys (100 iterations)
2. **Uniqueness**: Different requests produce different cache keys (100 iterations)
3. **Personalization Exclusion**: Personalized requests return null (100 iterations)
4. **Case Insensitivity**: Target format case doesn't affect cache keys (100 iterations)
5. **Order Independence**: Option key order doesn't affect cache keys (100 iterations)

### Requirements Validated

- **Requirement 26.1**: Compute hash of source file and target format parameters
- **Requirement 26.6**: Exclude personalized conversions from caching

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run type checking
npm run typecheck

# Build service
npm run build

# Start service
npm start
```

## Implementation Details

### Cache Key Algorithm

1. Check if request contains personalization options
   - If yes, return `null` (not cacheable)
2. Normalize target format to lowercase
3. Create sorted options object (excluding null/undefined values and personalization keys)
4. Create canonical JSON representation
5. Compute SHA-256 hash of canonical representation
6. Return 64-character hex hash string

### Example Cache Keys

```typescript
// Same source, same format, same options → same key
generateCacheKey({
  sourceFileId: 'abc-123',
  targetFormat: 'jpg',
  options: { quality: 80 }
})
// → "7d4e3f2a1b9c8e5d6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"

// Different format → different key
generateCacheKey({
  sourceFileId: 'abc-123',
  targetFormat: 'png',
  options: { quality: 80 }
})
// → "9f1e2d3c4b5a6e7d8c9b0a1f2e3d4c5b6a7e8d9c0b1a2e3f4d5c6b7a8e9d0f1e2a3b"

// With watermark → null (not cacheable)
generateCacheKey({
  sourceFileId: 'abc-123',
  targetFormat: 'jpg',
  options: { quality: 80, watermark: '© 2024' }
})
// → null
```

## Architecture

This service is part of the FileConverter Pro microservices architecture:

- **Language**: TypeScript/Node.js
- **Framework**: Fastify
- **Testing**: Jest + fast-check for property-based testing
- **Hashing**: Node.js crypto (SHA-256)

## Future Enhancements

- [ ] Implement cache lookup and storage logic
- [ ] Add Redis integration for cache storage
- [ ] Implement cache invalidation on engine version changes
- [ ] Add cache hit rate metrics
- [ ] Implement job queue integration with BullMQ
