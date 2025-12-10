# SecureWatch3 System Architecture

## Overview

SecureWatch3 is a real-time video surveillance system with AI-powered object detection. The system consists of three main components: a Next.js frontend, a Node.js API backend, and a Python detection engine.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LOCAL MACHINE                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Next.js Frontend (Port 3000)                     │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────┐  │    │
│  │  │SocketManager│  │DetectionTicker│  │CameraToggles│  │EpisodeList│  │    │
│  │  └──────┬──────┘  └──────────────┘  └─────────────┘  └───────────┘  │    │
│  │         │                                                            │    │
│  │  ┌──────▼──────┐                                                     │    │
│  │  │Zustand Store│  ← Real-time state: detections[], episodes{}        │    │
│  │  └─────────────┘                                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ WebSocket + HTTP
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GCE SERVER (34.57.79.207)                             │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Node.js API (Port 4000)                          │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │    │
│  │  │ Express REST │  │  Socket.IO   │  │ Live Episode Aggregator  │   │    │
│  │  │   /api/*     │  │   Server     │  │  (10s timeout → close)   │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘   │    │
│  │                           │                                          │    │
│  │  ┌────────────────────────▼─────────────────────────────────────┐   │    │
│  │  │                    SQLite Database                            │   │    │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │   │    │
│  │  │  │  detections  │  │   episodes   │  │      videos        │  │   │    │
│  │  │  └──────────────┘  └──────────────┘  └────────────────────┘  │   │    │
│  │  └──────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                     ▲                                        │
│                                     │ Internal Socket.IO                     │
│  ┌─────────────────────────────────┴───────────────────────────────────┐    │
│  │                   Python Detection Engine                            │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │    │
│  │  │  YOLO 11n    │  │ RTSP Capture │  │   Socket.IO Client       │   │    │
│  │  │  (Ultralytics)│  │  (OpenCV)    │  │   → detection events     │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                     ▲                                        │
│                                     │ RTSP                                   │
│  ┌─────────────────────────────────┴───────────────────────────────────┐    │
│  │                         MediaMTX (RTSP Server)                       │    │
│  │         rtsp://127.0.0.1:8554/{front_door,camera_2,...}              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Frontend (securewatch3-ui)

**Location:** `/Users/dd/Claude/securewatch3-ui`
**Port:** 3000 (local development)
**Tech:** Next.js 14, TypeScript, Tailwind CSS, Zustand, Socket.IO Client

#### Key Files

| File | Purpose |
|------|---------|
| `components/SocketManager.tsx` | Singleton WebSocket connection to backend |
| `components/DetectionTicker.tsx` | Real-time detection feed (latest 7 items) |
| `components/CameraToggles.tsx` | Camera on/off controls |
| `components/EpisodeList.tsx` | Episode cards with threat assessment |
| `lib/store.ts` | Zustand state store for detections & episodes |
| `.env.local` | API base URL configuration |

#### State Management (Zustand)

```typescript
interface SecurityStore {
  detections: Detection[];     // Latest raw detections (max 20)
  episodes: Record<string, Episode>;  // Episode map by ID
  isSocketConnected: boolean;

  addDetection(det: Detection): void;
  addEpisode(ep: Episode): void;
  updateEpisode(id: string, data: Partial<Episode>): void;
}
```

#### Socket Events (Client)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `detection:v2` | Server → Client | Raw detection with image URL |
| `episode:new` | Server → Client | New episode started |
| `episode:analyzed` | Server → Client | Episode analysis complete |

### 2. Backend API (server.js)

**Location:** `~/securewatch3/server.js` (on GCE)
**Port:** 4000
**Tech:** Node.js, Express, Socket.IO, better-sqlite3

#### REST Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/videos` | GET | List all videos |
| `/api/detections` | GET | Query detections (limit, offset) |
| `/api/episodes` | GET | Query episodes |
| `/api/monitor/status` | GET | Camera monitoring status |
| `/api/monitor/start` | POST | Start detection on camera |
| `/api/monitor/stop` | POST | Stop detection on camera |
| `/api/monitor/stop-all` | POST | Stop all cameras |
| `/api/upload` | POST | Upload video file |

#### Live Episode Aggregation

The backend aggregates detections into episodes:

1. **Episode Start**: First detection on a camera creates a new episode
2. **Episode Update**: Subsequent detections within 10 seconds extend the episode
3. **Episode Close**: After 10 seconds of inactivity:
   - Save final state to database
   - Trigger Gemini analysis (if enabled)
   - Emit `episode:analyzed` event

```javascript
// Episode lifecycle
liveEpisodes[cameraId] = {
  episode: { id, camera_id, start_time, detections: [] },
  timer: null  // 10-second close timer
};
```

### 3. Detection Engine (Python)

**Location:** `~/securewatch3/detect_engine.py` (on GCE)
**Model:** YOLO 11n (yolo11n.pt)
**Tech:** Ultralytics, OpenCV, Socket.IO Client

#### Detection Flow

1. Connect to RTSP stream via OpenCV
2. Run YOLO inference on frames (LIVE_FRAME_SKIP=5)
3. For each detection:
   - Save snapshot to `/detections/` directory
   - Emit detection via Socket.IO to server
4. Server aggregates into episodes

#### Configuration

| Variable | Value | Purpose |
|----------|-------|---------|
| `LIVE_FRAME_SKIP` | 5 | Process every 5th frame |
| `CONFIDENCE_THRESHOLD` | 0.5 | Minimum detection confidence |
| `MODEL` | yolo11n | YOLO model variant |

### 4. Database Schema (SQLite)

**Location:** `~/securewatch3/securewatch.db`

#### Tables

```sql
-- Raw detections from YOLO
CREATE TABLE detections (
  id INTEGER PRIMARY KEY,
  video_id TEXT,
  camera_id TEXT,
  episode_id TEXT,
  frame_number INTEGER,
  timestamp TEXT,
  label TEXT NOT NULL,
  confidence REAL,
  bbox TEXT,  -- JSON: [x1, y1, x2, y2]
  image_path TEXT,
  track_id TEXT,
  engine TEXT
);

-- Aggregated episodes
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  camera_id TEXT,
  start_time TEXT,
  end_time TEXT,
  thumbnail_url TEXT,
  detection_count INTEGER,
  best_confidence REAL,
  primary_class TEXT,
  threat_level TEXT,
  analysis_json TEXT,  -- Gemini analysis result
  source TEXT  -- 'live' or 'upload'
);
```

## Data Flow

### Real-time Detection Stream

```
Camera → RTSP → detect_engine.py → Socket.IO → server.js → Socket.IO → Frontend
                     │                              │
                     ▼                              ▼
              Save snapshot              Aggregate to episode
                                                    │
                                                    ▼
                                           Save to SQLite
```

### Episode Analysis Flow

```
Episode closes (10s timeout)
        │
        ▼
  Gemini API call (if enabled)
        │
        ▼
  Parse threat assessment
        │
        ▼
  Update episode in DB
        │
        ▼
  Emit episode:analyzed
        │
        ▼
  Frontend updates UI
```

## Configuration

### Frontend (.env.local)

```env
# Remote GCE server:
NEXT_PUBLIC_API_BASE=http://34.57.79.207:4000

# Local development:
# NEXT_PUBLIC_API_BASE=http://localhost:4000
```

### Backend (PM2)

```bash
# Start with port 4000
PORT=4000 pm2 start server.js --name securewatch-api

# View logs
pm2 logs securewatch-api
```

### Cameras

Configured in `CameraToggles.tsx`:

| ID | Label | RTSP URL |
|----|-------|----------|
| front_door | Front Door | rtsp://127.0.0.1:8554/front_door |
| camera_2 | Front Yard | rtsp://127.0.0.1:8554/camera_2 |
| camera_3 | Backyard | rtsp://127.0.0.1:8554/camera_3 |
| camera_4 | Camera 4 | rtsp://127.0.0.1:8554/camera_4 |
| camera_5 | Camera 5 | rtsp://127.0.0.1:8554/camera_5 |
| simulation | Simulation | rtsp://127.0.0.1:8554/simulation |

## Ports Summary

| Service | Port | Host |
|---------|------|------|
| Next.js Frontend | 3000 | localhost |
| Backend API + Socket.IO | 4000 | 34.57.79.207 |
| MediaMTX RTSP | 8554 | 127.0.0.1 (GCE internal) |

## Process Management

### GCE Server (PM2)

```bash
pm2 status                    # View all processes
pm2 logs securewatch-api      # API logs
pm2 restart securewatch-api   # Restart API
```

### Detection Workers

Started via `/api/monitor/start` endpoint, spawns Python detection process per camera.

## Known Issues

1. **Event Loop Blocking**: Synchronous SQLite writes (`db.detections.insert()`) can block the Node.js event loop under high detection load, causing the server to become unresponsive. Restart with `pm2 restart securewatch-api` to recover. Future fix: batch writes or use async SQLite.

2. **Episode State**: Episodes are persisted immediately with PROCESSING status to survive page refreshes.

3. **Detection Throttling**: LIVE_FRAME_SKIP=5 prevents CPU starvation on continuous streams.

## Troubleshooting

### Server Not Responding
If curl to port 4000 hangs but `pm2 status` shows "online":
```bash
# Server is frozen from DB write overload
gcloud compute ssh dd@securewatch-server --zone=us-central1-a \
  --command='PORT=4000 pm2 restart securewatch-api --update-env'
```

### WebSocket Timeout
Check server responsiveness first:
```bash
curl -s http://34.57.79.207:4000/api/health
```
If no response, restart the server (see above).

---

## Recovery Runbook (Phase 2.5 Hybrid Architecture)

*Last updated: 2025-12-03*

This section documents the current stable "Hybrid Bridge" architecture achieved in Phase 2.5. **Do not make changes unless you have a backup.**

### Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     GCE SERVER (136.119.129.106)                │
│                                                                  │
│  ┌──────────────────── HOST (Native) ────────────────────────┐  │
│  │                                                            │  │
│  │  Node.js API (server.js)         PM2 Managed Vision        │  │
│  │  └── Port 4000                   └── vision_simulation     │  │
│  │  └── REDIS_PORT=16379               └── REDIS_HOST=127.0.0.1│ │
│  │                                      └── REDIS_PORT=16379   │  │
│  │                                      └── MINIO_ENDPOINT=    │  │
│  │                                          127.0.0.1:19000    │  │
│  │                                                            │  │
│  │  MediaMTX (RTSP Server)                                    │  │
│  │  └── RTSP: 8554                                            │  │
│  │  └── HLS: 8888                                             │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ Redis Pub/Sub (port 16379)        │
│                              ▼                                    │
│  ┌──────────────────── DOCKER ─────────────────────────────────┐ │
│  │                                                              │ │
│  │  Redis Container                MinIO Container              │ │
│  │  └── Host: 16379 → 6379        └── Host: 19000 → 9000       │ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Service Ports (Current Stable)

| Service | Port | Protocol | Notes |
|---------|------|----------|-------|
| API Server | 4000 | HTTP/WS | Main API + Socket.IO |
| Redis (Docker) | 16379 | TCP | Mapped from container:6379 |
| MinIO (Docker) | 19000 | HTTP | Mapped from container:9000 |
| MediaMTX RTSP | 8554 | RTSP | Internal only |
| MediaMTX HLS | 8888 | HTTP | Video streaming |

### Critical Environment Variables

The API **must** be started with these environment variables:

```bash
REDIS_PORT=16379  # Docker Redis is on 16379, not default 6379
```

### Recovery Steps

#### 1. Check System Health
```bash
# Quick health check
curl -s http://136.119.129.106:4000/api/health

# Full status
gcloud compute ssh dd@securewatch-server --zone=us-central1-a --command='
  echo "=== UPTIME ===" && uptime
  echo "=== DOCKER ===" && docker ps --format "{{.Names}}: {{.Status}}"
  echo "=== PM2 ===" && pm2 list
  echo "=== API ===" && curl -s http://localhost:4000/api/health
'
```

#### 2. Restart API Server (if unresponsive)
```bash
gcloud compute ssh dd@securewatch-server --zone=us-central1-a --command='
  # Kill existing API process
  pkill -f "node server.js" 2>/dev/null

  # Start with correct environment
  cd ~/securewatch3
  REDIS_PORT=16379 nohup node server.js > /tmp/api.log 2>&1 &

  # Verify
  sleep 3 && curl -s http://localhost:4000/api/health
'
```

#### 3. Start Vision Worker (if needed)
```bash
gcloud compute ssh dd@securewatch-server --zone=us-central1-a --command='
  cd ~/securewatch3
  pm2 start ecosystem.vision.config.cjs
  pm2 list
'
```

#### 4. Start Docker Services (if Redis/MinIO down)
```bash
gcloud compute ssh dd@securewatch-server --zone=us-central1-a --command='
  # Start Redis on port 16379
  docker run -d --name redis-sw -p 16379:6379 redis:alpine

  # Start MinIO on port 19000
  docker run -d --name minio-sw \
    -p 19000:9000 \
    -e MINIO_ROOT_USER=minioadmin \
    -e MINIO_ROOT_PASSWORD=minioadmin \
    minio/minio server /data
'
```

### Bug Fixes Applied (Phase 2.5)

1. **`[REDIS ERROR] e is not defined`** - Fixed typo in server.js line 3608
   - Changed `toAbsoluteUrl(e.thumbnail_url)` to `toAbsoluteUrl(episode.thumbnail_url)`

2. **Redis port mismatch** - API now uses `REDIS_PORT=16379` to connect to Docker Redis

### What NOT to Change

- Do not move API into Docker until full Phase 3 is planned
- Do not change the Redis port mapping (16379→6379)
- Do not run multiple vision workers without load testing first
- Do not upgrade Node.js or Python without testing
