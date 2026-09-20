# Python Examples

Uses the `requests` library. Install with `pip install requests`.

## Authentication

```python
import requests

BASE = "https://api.fileconverterpro.com/v1"

# Register
r = requests.post(f"{BASE}/auth/register", json={
    "email": "you@example.com",
    "password": "Str0ngP@ss!"
})
token = r.json()["accessToken"]

# Login
r = requests.post(f"{BASE}/auth/login", json={
    "email": "you@example.com",
    "password": "Str0ngP@ss!"
})
token = r.json()["accessToken"]

headers = {"Authorization": f"Bearer {token}"}
```

## Upload a File

```python
import os

# Step 1: request presigned URL
filepath = "document.pdf"
file_size = os.path.getsize(filepath)

r = requests.post(f"{BASE}/uploads", headers=headers, json={
    "filename": os.path.basename(filepath),
    "contentType": "application/pdf",
    "size": file_size,
})
data = r.json()
upload_id   = data["uploadId"]
presigned_url = data["presignedUrl"]
fields      = data.get("fields", {})

# Step 2: upload to S3 presigned URL
with open(filepath, "rb") as f:
    files = {"file": (os.path.basename(filepath), f, "application/pdf")}
    requests.post(presigned_url, data=fields, files=files)

# Step 3: confirm upload
requests.post(f"{BASE}/uploads/{upload_id}/complete", headers=headers)
```

## Submit and Poll a Conversion

```python
import time

# Submit
r = requests.post(f"{BASE}/conversions", headers=headers, json={
    "sourceFileId": upload_id,
    "targetFormat": "docx",
    "options": {"preserveMetadata": True},
})
job_id = r.json()["jobId"]

# Poll
def poll(job_id, timeout=60):
    start = time.time()
    while time.time() - start < timeout:
        r = requests.get(f"{BASE}/conversions/{job_id}", headers=headers)
        job = r.json()
        if job["status"] == "completed":
            return job["resultFileId"]
        if job["status"] == "failed":
            raise RuntimeError(job["errorMessage"])
        time.sleep(2)
    raise TimeoutError("Conversion timed out")

result_file_id = poll(job_id)
print("Result:", result_file_id)
```

## Using an API Key

```python
# Use API key instead of Bearer token
api_key_headers = {"Authorization": f"Bearer {your_api_key}"}

r = requests.post(f"{BASE}/conversions", headers=api_key_headers, json={
    "sourceFileId": upload_id,
    "targetFormat": "png",
})
```
