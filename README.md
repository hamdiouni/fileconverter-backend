# FileConverter Pro – Backend Microservices

A Dockerized microservices architecture for FileConverter Pro, supporting 2,000+ file conversion types across 12 format categories.

## Architecture Overview

```
backend/
├── services/          # TypeScript/Node.js API services (Fastify)
│   ├── api-gateway/       # Nginx – single entry point, routing, rate limiting
│   ├── auth-service/      # JWT/OAuth authentication (port 3000)
│   ├── user-service/      # User profiles and quota management (port 3001)
│   ├── upload-service/    # File uploads and virus scanning (port 3002)
│   ├── orchestrator-service/ # Conversion job orchestration (port 3003)
│   ├── billing-service/   # Stripe billing integration (port 3004)
│   ├── notification-service/ # Webhooks and email (port 3005)
│   └── admin-service/     # Admin dashboards (port 3006)
├── workers/           # Python 3.11 conversion workers
│   ├── image-worker/      # JPG, PNG, WEBP, TIFF, SVG, RAW (ImageMagick/Pillow)
│   ├── video-worker/      # MP4, AVI, MOV, MKV, WEBM (FFmpeg)
│   ├── audio-worker/      # MP3, WAV, FLAC, AAC, OGG (FFmpeg)
│   ├── document-worker/   # PDF, DOCX, ODT, HTML, MD (LibreOffice/Pandoc)
│   ├── archive-worker/    # ZIP, RAR, 7Z, TAR (7zip/unar)
│   └── cad-worker/        # DWG/DXF + TTF/OTF/WOFF fonts (FreeCAD/FontForge)
├── packages/          # Shared npm packages (monorepo)
│   ├── types/             # @fileconverter/types – shared TypeScript interfaces
│   ├── utils/             # @fileconverter/utils – JWT, logging, error helpers
│   └── prisma/            # @fileconverter/prisma – Prisma schema and migrations
├── infrastructure/    # Infrastructure configuration
│   ├── nginx/             # API Gateway Nginx config
│   ├── monitoring/        # Prometheus, Grafana, Loki configuration
│   └── kubernetes/        # Kubernetes manifests (production)
├── docker-compose.yml       # Development environment
├── docker-compose.prod.yml  # Production overrides (resource limits, replicas)
├── .env.example             # Environment variable template
├── Makefile                 # Developer command shortcuts
└── package.json             # npm workspaces root
```

## Technology Stack

| Layer | Technology |
|---|---|
| API Services | TypeScript / Node.js 20 / Fastify |
| Workers | Python 3.11 / Pydantic |
| Database | PostgreSQL 16 + Prisma ORM |
| Job Queues | Redis 7 + BullMQ |
| Object Storage | MinIO (local) / AWS S3 (production) |
| API Gateway | Nginx |
| Containerisation | Docker + Docker Compose |
| Monitoring | Prometheus + Grafana + Loki |

## Quick Start

### Prerequisites

- Docker 24+ and Docker Compose v2
- Node.js 20+ and npm 10+ (for local development without Docker)
- GNU Make

### 1. Configure environment

```bash
cp .env.example .env
# Review and update .env values – defaults work for local development
```

### 2. Start all services

```bash
make up
```

This builds all Docker images and starts:
- **PostgreSQL** on port 5432
- **Redis** on port 6379
- **MinIO** on port 9000 (console: 9001)
- **Mailhog** on port 8025 (email testing UI)
- **ClamAV** on port 3310
- All API services and conversion workers

### 3. Run database migrations

```bash
make migrate
```

### 4. Seed development data

```bash
make seed
```

### 5. Access services

| Service | URL |
|---|---|
| API Gateway | http://localhost |
| MinIO Console | http://localhost:9001 |
| Mailhog UI | http://localhost:8025 |
| Auth Service | http://localhost:3000 |
| User Service | http://localhost:3001 |
| Upload Service | http://localhost:3002 |
| Orchestrator | http://localhost:3003 |

## Common Commands

```bash
make up            # Start all services
make down          # Stop all services
make logs          # Tail all logs
make migrate       # Apply database migrations
make seed          # Seed development data
make test          # Run all tests
make typecheck     # TypeScript type check
make lint          # Run ESLint
make clean         # Remove containers and volumes (destructive)
make help          # Show all available commands
```

## Development

### Running a single service locally (without Docker)

```bash
cd services/auth-service
npm install
npm run dev
```

Requires PostgreSQL and Redis running locally or via `make infra-up`.

### Logs for a specific service

```bash
make logs-service SERVICE=auth-service
```

### Open a shell in a container

```bash
make shell SERVICE=auth-service
```

### Prisma Studio (database GUI)

```bash
make prisma-studio
# Opens on http://localhost:5555
```

## Environment Variables

All configuration is managed through environment variables. See [.env.example](.env.example) for the full list with documentation.

Required in production (no defaults):
- `DATABASE_URL` / `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `S3_SECRET_ACCESS_KEY`
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `SMTP_PASSWORD` (or `SENDGRID_API_KEY`)

## Production Deployment

```bash
# Copy and update production environment
cp .env.example .env
# ... fill in production values

# Start with production resource limits and replica counts
make up-prod
```

The production compose file (`docker-compose.prod.yml`) adds:
- CPU and memory resource limits per service
- Multiple replicas for stateless services
- Stricter health check thresholds
- Rolling update and rollback configuration
- JSON log driver with rotation

## Contributing

1. Run `make infra-up` to start just the infrastructure services
2. Develop services locally with hot-reload
3. Run `make test` before committing
4. Ensure `make typecheck` and `make lint` pass
