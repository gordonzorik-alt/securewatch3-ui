// =============================================================================
// v2 Vision Worker Bridge
// =============================================================================

// Throttle state for v2 detections (one per camera, 500ms cooldown)
const v2ThrottleState = {};
const V2_THROTTLE_MS = 500;

/**
 * Process a v2 detection message and bridge to v1 format
 * @param {Object} v2Data - Detection from vision_worker.py
 * @param {SocketIO.Server} io - Socket.IO server instance
 * @param {Function} processLiveDetection - v1 detection processor
 */
function processV2Detection(v2Data, io, processLiveDetection) {
  const cameraId = v2Data.camera;
  const now = Date.now();

  // Throttle: Only emit to frontend every 500ms per camera
  const lastEmit = v2ThrottleState[cameraId] || 0;
  const shouldEmit = (now - lastEmit) >= V2_THROTTLE_MS;

  if (shouldEmit) {
    v2ThrottleState[cameraId] = now;

    // Emit throttled v2 event to frontend
    io.emit('detection:v2', {
      id: v2Data.id,
      camera: cameraId,
      time: v2Data.time,
      imageUrl: `/v2/live/${v2Data.file.split('/').pop()}`, // Convert path to URL
      class: v2Data.class,
      score: v2Data.score
    });

    console.log(`[v2-Bridge] ${cameraId}: ${v2Data.class} (${v2Data.score.toFixed(2)}) -> Frontend`);
  }

  // ALWAYS bridge to v1 aggregator (no throttling for data integrity)
  const v1Data = {
    camera_id: cameraId,
    timestamp: v2Data.time,
    frame_number: Math.floor(Date.now() / 1000), // Synthetic frame number
    frame_image: null, // v2 saves to disk instead
    image_path: `/v2/live/${v2Data.file.split('/').pop()}`, // URL path to image
    detections: [{
      label: v2Data.class,
      confidence: v2Data.score,
      bbox: [0, 0, 0, 0], // v2 doesn't track bbox currently
      bbox_normalized: [0, 0, 0, 0]
    }],
    detection_count: 1,
    source: 'v2' // Mark as v2 source
  };

  // Bridge to v1 episode aggregator
  processLiveDetection(v1Data);
}

export { processV2Detection, v2ThrottleState };
