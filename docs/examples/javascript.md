# JavaScript / Node.js Examples

> Content paraphrased and adapted for FileConverter Pro. All examples use the `fetch` API (Node 18+).

## Authentication

```js
// ── Register ──────────────────────────────────────────────────────────────
const res = await fetch('https://api.fileconverterpro.com/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'you@example.com', password: 'Str0ngP@ss!' }),
});
const { accessToken } = await res.json();

// ── Login ─────────────────────────────────────────────────────────────────
const loginRes = await fetch('https://api.fileconverterpro.com/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'you@example.com', password: 'Str0ngP@ss!' }),
});
const { accessToken: token } = await loginRes.json();
```

## Upload a File

```js
// Step 1: request presigned URL
const uploadReq = await fetch('https://api.fileconverterpro.com/v1/uploads', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ filename: 'photo.jpg', contentType: 'image/jpeg', size: 204800 }),
});
const { uploadId, presignedUrl, fields } = await uploadReq.json();

// Step 2: upload directly to storage (PUT/POST to presignedUrl)
const formData = new FormData();
Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
formData.append('file', fileBlob, 'photo.jpg');
await fetch(presignedUrl, { method: 'POST', body: formData });

// Step 3: confirm upload
await fetch(`https://api.fileconverterpro.com/v1/uploads/${uploadId}/complete`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
});
```

## Submit and Poll a Conversion

```js
// Submit conversion job
const convertRes = await fetch('https://api.fileconverterpro.com/v1/conversions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({
    sourceFileId: uploadId,
    targetFormat: 'webp',
    options: { quality: 85 },
  }),
});
const { jobId } = await convertRes.json();

// Poll until complete
async function pollUntilDone(jobId, token, intervalMs = 2000, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const r = await fetch(`https://api.fileconverterpro.com/v1/conversions/${jobId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const job = await r.json();
    if (job.status === 'completed') return job.resultFileId;
    if (job.status === 'failed') throw new Error(job.errorMessage);
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error('Timed out waiting for conversion');
}

const resultFileId = await pollUntilDone(jobId, token);
console.log('Result file:', resultFileId);
```

## Generate an API Key

```js
const keyRes = await fetch('https://api.fileconverterpro.com/v1/auth/api-keys', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ name: 'production-key', permissions: ['conversions:write'] }),
});
const { key, id } = await keyRes.json();
// key is shown only once — store it securely
console.log('API Key:', key);
```
