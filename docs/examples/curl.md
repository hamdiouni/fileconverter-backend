# cURL Examples

All examples use `https://api.fileconverterpro.com/v1` as the base URL.
Replace `$TOKEN` with your JWT access token.

## Authentication

```bash
# Register
curl -s -X POST https://api.fileconverterpro.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Str0ngP@ss!"}' | jq .

# Login
curl -s -X POST https://api.fileconverterpro.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Str0ngP@ss!"}' | jq .

# Refresh token
curl -s -X POST https://api.fileconverterpro.com/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<your-refresh-token>"}' | jq .
```

## Upload a File

```bash
# Step 1: request presigned URL
UPLOAD=$(curl -s -X POST https://api.fileconverterpro.com/v1/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"photo.jpg","contentType":"image/jpeg","size":204800}')

UPLOAD_ID=$(echo $UPLOAD | jq -r '.uploadId')
PRESIGNED=$(echo $UPLOAD | jq -r '.presignedUrl')

# Step 2: upload file directly to storage
curl -s -X POST "$PRESIGNED" \
  -F "file=@photo.jpg;type=image/jpeg"

# Step 3: confirm upload
curl -s -X POST "https://api.fileconverterpro.com/v1/uploads/$UPLOAD_ID/complete" \
  -H "Authorization: Bearer $TOKEN"
```

## Submit and Poll a Conversion

```bash
# Submit
JOB=$(curl -s -X POST https://api.fileconverterpro.com/v1/conversions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sourceFileId\":\"$UPLOAD_ID\",\"targetFormat\":\"webp\",\"options\":{\"quality\":85}}")

JOB_ID=$(echo $JOB | jq -r '.jobId')
echo "Job submitted: $JOB_ID"

# Poll status
curl -s "https://api.fileconverterpro.com/v1/conversions/$JOB_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

## Manage API Keys

```bash
# Create API key
curl -s -X POST https://api.fileconverterpro.com/v1/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-app","permissions":["conversions:write"]}' | jq .

# List API keys
curl -s https://api.fileconverterpro.com/v1/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" | jq .

# Revoke API key
curl -s -X DELETE "https://api.fileconverterpro.com/v1/auth/api-keys/<key-id>" \
  -H "Authorization: Bearer $TOKEN"
```

## Error Response Format

All errors follow this structure:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Monthly conversion quota exceeded",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2024-03-15T10:30:00Z"
  }
}
```

## Rate Limit Headers

Every response includes:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |

When rate-limited, the response is `HTTP 429` with a `Retry-After` header.
