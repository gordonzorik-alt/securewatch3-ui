# SecureWatch3-UI

Next.js 14 frontend for SecureWatch3 video object detection system.

## Features

- **Dark Theme**: Professional dark mode interface
- **Sidebar Navigation**: Easy access to Dispatch, Videos, and Detections
- **Real-time Updates**: Auto-polling every 5 seconds with React Query
- **Video Upload**: Drag-and-drop or click to upload videos
- **Auto-Detection**: Automatically starts detection after upload
- **Status Tracking**: Monitor video processing status (uploaded, processing, completed, failed)
- **Recent Detections**: View latest object detections with confidence scores

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Data Fetching**: TanStack React Query
- **API Base**: http://localhost:4000 (configurable)

## Prerequisites

- Node.js 18+ and npm
- SecureWatch3 backend API running on port 4000 (or configure via `.env.local`)

## Installation

```bash
cd ~/Claude/securewatch3-ui
npm install
```

## Configuration

The API base URL can be configured in `.env.local`:

```env
NEXT_PUBLIC_API_BASE=http://localhost:4000
```

Change `4000` to match your backend API port if different.

## Running the Application

### Development Mode

```bash
npm run dev
```

The UI will be available at **http://localhost:3000**

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
securewatch3-ui/
├── app/
│   ├── layout.tsx           # Root layout with sidebar
│   ├── page.tsx             # Root page (redirects to /dispatch)
│   ├── providers.tsx        # React Query provider
│   ├── dispatch/
│   │   └── page.tsx         # Main dispatch console
│   └── globals.css          # Global styles with dark theme
├── lib/
│   ├── types.ts             # TypeScript interfaces
│   └── api.ts               # API client functions
├── hooks/
│   ├── useVideos.ts         # Videos data hook
│   └── useDetections.ts     # Detections data hook
└── .env.local               # Environment configuration
```

## API Integration

The frontend expects the following API endpoints from the backend:

- `GET /api/videos` - Get all videos
- `GET /api/detections?limit=50` - Get recent detections
- `POST /api/upload` - Upload video file
- `POST /api/detect/:videoId` - Start detection for video

## Usage

1. **Start the Backend**: Make sure your SecureWatch3 backend API is running on port 4000
2. **Start the UI**: Run `npm run dev` in this directory
3. **Open Browser**: Navigate to http://localhost:3000
4. **Upload Video**: Drag and drop or click to upload a video file
5. **Watch Detection**: Detection starts automatically and results appear in real-time

## Features in Detail

### Auto-Polling
- Videos and detections refresh every 5 seconds
- Implemented with React Query's `refetchInterval`

### Upload Progress
- Visual progress bar during upload
- Automatic detection start after successful upload

### Status Badges
- **UPLOADED**: Gray - Video uploaded, detection not started
- **PROCESSING**: Yellow - Detection in progress
- **COMPLETED**: Green - Detection finished successfully
- **FAILED**: Red - Detection encountered an error

### Dark Theme
- Professional dark color scheme
- Custom scrollbar styling
- Hover effects and transitions

## Troubleshooting

### CORS Errors
If you see CORS errors, make sure the backend has CORS enabled for http://localhost:3000

### API Connection Issues
- Check that the backend is running on the configured port
- Verify `.env.local` has the correct `NEXT_PUBLIC_API_BASE` value
- Check browser console for specific error messages

### No Data Appearing
- Verify API endpoints are responding (use browser DevTools Network tab)
- Check React Query DevTools (visible in development mode)
- Ensure backend is returning data in the expected format

## Development

To make changes:

1. Edit files in `app/`, `lib/`, or `hooks/`
2. Changes auto-reload in development mode
3. TypeScript provides type checking
4. Tailwind classes provide styling

## Next Steps

Potential enhancements:
- WebSocket support for real-time updates (socket.io-client already installed)
- Video playback with bounding boxes
- Filtering and search for videos/detections
- Export detection data
- User authentication
- Multi-camera support

---

Built with Next.js 14, TypeScript, and Tailwind CSS
