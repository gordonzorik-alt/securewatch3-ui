// =============================================================================
// v3 Vision Worker Bridge (S3/MinIO Storage)
// =============================================================================

// Throttle state for detections (one per camera, 500ms cooldown)
const v2ThrottleState = {};
const V2_THROTTLE_MS = 500;

/**
 * Process a v3 detection message and bridge to frontend + v1 aggregator
 * @param {Object} v3Data - Detection from vision_worker_v3.py (with url/imageUrl)
 * @param {SocketIO.Server} io - Socket.IO server instance
 * @param {Function} processLiveDetection - v1 detection processor
 */
function processV2Detection(v3Data, io, processLiveDetection) {
  const cameraId = v3Data.camera;
  const now = Date.now();

  // Get the URL - support both 'url' (v3) and 'imageUrl' (backwards compat)
  const snapshotUrl = v3Data.url || v3Data.imageUrl;

  // Throttle: Only emit to frontend every 500ms per camera
  const lastEmit = v2ThrottleState[cameraId] || 0;
  const shouldEmit = (now - lastEmit) >= V2_THROTTLE_MS;

  if (shouldEmit) {
    v2ThrottleState[cameraId] = now;

    // Emit throttled v3 event to frontend
    io.emit('detection:v2', {
      id: v3Data.id,
      camera: cameraId,
      time: v3Data.time,
      imageUrl: snapshotUrl,  // Direct S3/MinIO URL
      class: v3Data.class,
      score: v3Data.score
    });

    console.log(`[v3-Bridge] ${cameraId}: ${v3Data.class} (${v3Data.score.toFixed(2)}) -> ${snapshotUrl ? 'S3' : 'no-image'}`);
  }

  // ALWAYS bridge to v1 aggregator (no throttling for data integrity)
  const v1Data = {
    camera_id: cameraId,
    timestamp: v3Data.time,
    frame_number: Math.floor(Date.now() / 1000), // Synthetic frame number
    frame_image: null, // v3 uses S3, not base64
    image_path: snapshotUrl, // Store the S3 URL as image_path (pass through directly)
    detections: [{
      label: v3Data.class,
      confidence: v3Data.score,
      bbox: [0, 0, 0, 0], // v3 doesn't track bbox currently
      bbox_normalized: [0, 0, 0, 0]
    }],
    detection_count: 1,
    source: 'v3' // Mark as v3 (S3) source
  };

  // Bridge to v1 episode aggregator
  processLiveDetection(v1Data);
}

export { processV2Detection, v2ThrottleState };
