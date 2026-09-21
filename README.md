# ⚙️ FileConverter Pro — Backend Microservices Architecture

A resilient, scalable Dockerized microservices architecture supporting **2,021 file conversion pairs** across 11 format categories.

---

## 📐 Microservices Architecture

```text
backend/
├── services/                 # TypeScript / Node.js 20 Fastify Microservices
│   ├── api-gateway/          # Nginx API Gateway (Port :80)
│   ├── auth-service/         # JWT / OAuth Authentication (Port :3000)
│   ├── user-service/         # User Profiles & Quotas (Port :3001)
│   ├── upload-service/       # Uploads & Virus Scanning (Port :3002)
│   ├── orchestrator-service/ # Conversion Job Orchestrator (Port :3003)
│   ├── billing-service/      # Stripe Billing Integration (Port :3004)
│   ├── notification-service/ # Webhooks & Email Notifications (Port :3005)
│   └── admin-service/        # Admin Analytics API (Port :3006)
├── workers/                  # Python 3.11 Conversion Workers
│   ├── image-worker/         # ImageMagick, libvips, Pillow (JPG, PNG, WEBP, AVIF, RAW)
│   ├── video-worker/         # FFmpeg (MP4, AVI, MOV, WEBM, MKV)
│   ├── audio-worker/         # FFmpeg (MP3, WAV, FLAC, AAC, OGG)
│   ├── document-worker/      # LibreOffice, Pandoc, pdf2image (DOCX, PDF, ODT, HTML, MD)
│   ├── archive-worker/       # 7-Zip, unar (ZIP, RAR, 7Z, TAR, GZ)
│   └── cad-font-worker/      # FreeCAD, FontForge (DWG, DXF, TTF, OTF, WOFF)
└── infrastructure/           # Monitoring Stack (Grafana, Prometheus, Loki, Alertmanager)
```

---

## 🛠️ Technology Stack

| Component | Technology |
|---|---|
| **API Services** | TypeScript / Node.js 20 / Fastify |
| **Workers** | Python 3.11 / FFmpeg / LibreOffice / ImageMagick |
| **Database** | PostgreSQL 16 + Prisma ORM |
| **Caching & Streams** | Redis 7 |
| **Object Storage** | MinIO (local) / AWS S3 / Cloudflare R2 |
| **API Gateway** | Nginx |
| **Monitoring** | Grafana 10 + Prometheus + Loki |

---

## 🎁 Guest Mode & Anonymous Conversions

- **Automatic Session Resolution**: Requests lacking `Authorization: Bearer` tokens generate guest identities (`guest_<client_ip>`).
- **20 Daily Conversions**: Anonymous users get **20 free file conversions per day** tracked via Redis (`guest_daily_uploads:<ip>:<date>`).
- **PostgreSQL Auto-Upsert**: Ensures foreign key constraints pass seamlessly without forced registration.

---

## 🚀 Local Development Setup

### 1. Configure Environment Variables

```bash
cd backend
cp .env.example .env
```

### 2. Start Stack in Docker

```bash
docker compose up -d --build
```

### 3. Apply Database Schema

```bash
docker exec -it fc_upload_service ./node_modules/.bin/prisma db push --schema=./prisma/schema.prisma
```

### 4. Service Endpoints

| Service | Host Port | Purpose |
|---|---|---|
| **API Gateway** | `http://localhost:80` | Single entry point for all API routes (`/api/v1/*`) |
| **MinIO Console** | `http://localhost:9001` | S3 Object Storage Management (`minioadmin` / `minioadmin_dev`) |
| **Grafana Dashboards** | `http://localhost:3100` | Operational monitoring (`admin` / `admin`) |
| **Prometheus** | `http://localhost:9090` | Service metrics collection |
| **MailHog Web UI** | `http://localhost:8025` | Development email inbox |

---

## ☁️ Cloud Deployment

The backend services are designed for deployment on free cloud providers:
- **Database**: Supabase PostgreSQL (Free 500MB tier)
- **Redis**: Upstash Redis (10,000 req/day free)
- **S3 Storage**: Cloudflare R2 (10 GB free storage/month)
- **Services**: Render Docker Web Services

For complete step-by-step cloud deployment instructions, see [`DEPLOYMENT.md`](../DEPLOYMENT.md).

---

## 📚 Related Repositories

- 🌐 **Frontend Web Application**: [hamdiouni/fileconverter-frontend](https://github.com/hamdiouni/fileconverter-frontend)
- ⚙️ **Backend Microservices**: [hamdiouni/fileconverter-backend](https://github.com/hamdiouni/fileconverter-backend)
