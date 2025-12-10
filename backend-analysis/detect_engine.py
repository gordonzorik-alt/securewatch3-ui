#!/usr/bin/env python3
"""
SecureWatch Unified Detection Engine

Single Python script with two modes:
- UPLOAD: Process video files (existing functionality)
- LIVE: Process RTSP/camera streams in real-time

Outputs JSON episodes in a unified format for Node.js backend.
"""

import argparse
import base64
import io
import json
import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
import signal
import sys
import time
import threading
from datetime import datetime
from typing import Optional, List, Dict, Any

import cv2
import numpy as np
import requests
from requests.auth import HTTPDigestAuth
from ultralytics import YOLO

# Redis for decoupled pub/sub
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    print("[DetectEngine] Redis not available, will use HTTP fallback", file=sys.stderr)

# Import Telegram notifier
try:
    from notifier import send_alert
    TELEGRAM_ENABLED = True
except ImportError:
    TELEGRAM_ENABLED = False
    print("[DetectEngine] Telegram notifier not available", file=sys.stderr)


class SecureWatchDetector:
    """
    Unified detector for both video file uploads and live RTSP streams.
    """

    # Classes we care about for security surveillance
    ALLOWED_CLASSES = {'person', 'car', 'truck', 'motorcycle', 'bicycle', 'bus'}

    # Default confidence threshold
    DEFAULT_CONFIDENCE = 0.3

    # Frame skip for file processing (every Nth frame)
    FILE_FRAME_SKIP = 10

    # Live stream settings
    LIVE_FRAME_SKIP = 3  # Process every 3rd frame for live (higher FPS needed)
    RECONNECT_DELAY = 5  # Seconds to wait before reconnecting

    # HTTP snapshot polling settings
    HTTP_POLL_INTERVAL = 0.5  # Seconds between snapshot fetches (2 FPS)
    HTTP_TIMEOUT = 10  # HTTP request timeout in seconds

    # Telegram alert settings
    ALERT_COOLDOWN = 30  # Seconds between Telegram alerts
    ALERT_CONFIDENCE_THRESHOLD = 0.7  # Minimum confidence for alerts

    # Heartbeat settings for health monitoring
    HEARTBEAT_INTERVAL = 5  # Seconds between heartbeat writes to Redis

    def __init__(
        self,
        mode: str,
        source: str,
        cam_id: str,
        endpoint: str,
        confidence: float = DEFAULT_CONFIDENCE,
        username: Optional[str] = None,
        password: Optional[str] = None,
        redis_host: Optional[str] = None,
        redis_port: int = 6379
    ):
        """
        Initialize the detector.

        Args:
            mode: 'UPLOAD' for video files, 'LIVE' for RTSP streams, 'HTTP' for HTTP snapshot polling
            source: File path, RTSP URL, or HTTP snapshot URL
            cam_id: Camera identifier string
            endpoint: Node.js callback URL for posting detections (fallback if Redis unavailable)
            confidence: Minimum confidence threshold (0-1)
            username: HTTP auth username (for HTTP mode)
            password: HTTP auth password (for HTTP mode)
            redis_host: Redis server hostname (enables pub/sub mode)
            redis_port: Redis server port (default 6379)
        """
        self.mode = mode.upper()
        self.source = source
        self.cam_id = cam_id
        self.endpoint = endpoint
        self.confidence = confidence
        self.username = username
        self.password = password
        self.redis_host = redis_host
        self.redis_port = redis_port

        self.running = True
        self.cap: Optional[cv2.VideoCapture] = None
        self.frame_count = 0
        self.detection_count = 0

        # Telegram alert cooldown
        self.last_alert_time = 0

        # HTTP session for snapshot polling (with Digest auth)
        self.http_session: Optional[requests.Session] = None

        # Heartbeat thread for health monitoring
        self.heartbeat_thread: Optional[threading.Thread] = None

        # Redis client for pub/sub (preferred over HTTP)
        self.redis_client: Optional[redis.Redis] = None
        if redis_host and REDIS_AVAILABLE:
            try:
                self.redis_client = redis.Redis(
                    host=redis_host,
                    port=redis_port,
                    decode_responses=True,
                    socket_connect_timeout=5
                )
                # Test connection
                self.redis_client.ping()
                print(f"[DetectEngine] Connected to Redis at {redis_host}:{redis_port}", file=sys.stderr)
            except redis.ConnectionError as e:
                print(f"[DetectEngine] Redis connection failed: {e}", file=sys.stderr)
                print(f"[DetectEngine] Falling back to HTTP POST", file=sys.stderr)
                self.redis_client = None

        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

        # Load YOLO model
        print(f"[DetectEngine] Loading YOLO model...", file=sys.stderr)
        # YOLO11m - Faster, more accurate, fewer false positives than YOLOv8m
        self.model = YOLO("yolo11m.pt")
        print(f"[DetectEngine] YOLO11m model loaded successfully", file=sys.stderr)

        # Get class name mapping from model
        self.class_names = self.model.names

    def start(self):
        """
        Start detection based on mode.
        """
        print(f"[DetectEngine] Starting in {self.mode} mode", file=sys.stderr)
        print(f"[DetectEngine] Source: {self.source}", file=sys.stderr)
        print(f"[DetectEngine] Camera ID: {self.cam_id}", file=sys.stderr)
        print(f"[DetectEngine] Endpoint: {self.endpoint}", file=sys.stderr)

        # Start heartbeat thread for health monitoring
        self._start_heartbeat_thread()

        try:
            if self.mode == 'UPLOAD':
                self._run_file_loop()
            elif self.mode == 'LIVE':
                self._run_stream_loop()
            elif self.mode == 'HTTP':
                self._run_http_loop()
            else:
                raise ValueError(f"Unknown mode: {self.mode}")
        except KeyboardInterrupt:
            print(f"\n[DetectEngine] Interrupted by user", file=sys.stderr)
        finally:
            self._cleanup()

    def _run_file_loop(self):
        """
        Process a video file frame by frame.
        Accumulates frames with detections into episodes and sends at end.
        Also outputs per-frame JSON to stdout for real-time processing.
        """
        print(f"[DetectEngine] Opening video file: {self.source}", file=sys.stderr)

        # Accumulate frames for episode
        episode_frames: List[Dict[str, Any]] = []
        detections_summary: Dict[str, int] = {}
        start_time = time.time()

        try:
            self.cap = cv2.VideoCapture(self.source)
            if not self.cap.isOpened():
                raise RuntimeError(f"Failed to open video file: {self.source}")

            fps = self.cap.get(cv2.CAP_PROP_FPS) or 30
            total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))

            print(f"[DetectEngine] Video FPS: {fps}, Total frames: {total_frames}", file=sys.stderr)

            while self.running:
                ret, frame = self.cap.read()
                if not ret:
                    break

                self.frame_count += 1

                # Skip frames for efficiency
                if self.frame_count % self.FILE_FRAME_SKIP != 0:
                    continue

                # Run YOLO detection
                detections = self._detect_frame(frame)

                # Calculate timestamp relative to video start
                frame_timestamp = self.frame_count / fps

                if detections:
                    # Create per-frame episode data for real-time output
                    episode_data = self._create_episode_data(detections, frame)

                    # Output to stdout for Node.js to capture (real-time)
                    print(f"DETECTION_JSON:{json.dumps(episode_data)}")
                    sys.stdout.flush()

                    # Also POST individual detection if configured
                    self._post_detection(episode_data)

                    # Send Telegram alert for high-confidence person detections
                    self._send_telegram_alert(frame, detections)

                    # Accumulate frame for episode batch
                    frame_detections = []
                    for det in detections:
                        frame_detections.append({
                            'label': det['class'],
                            'confidence': det['confidence'],
                            'bbox': det['bbox']
                        })
                        # Update detection summary counts
                        cls_name = det['class']
                        detections_summary[cls_name] = detections_summary.get(cls_name, 0) + 1

                    episode_frames.append({
                        'seq': len(episode_frames),
                        'image': frame.copy(),  # Copy frame for later serialization
                        'detections': frame_detections,
                        'timestamp': frame_timestamp,
                        'frame_number': self.frame_count
                    })

            # End of file - compute final summary and send episode
            end_time = time.time()
            processing_time = end_time - start_time

            print(f"[DetectEngine] File processing complete. "
                  f"Frames: {self.frame_count}, Detections: {self.detection_count}, "
                  f"Processing time: {processing_time:.2f}s",
                  file=sys.stderr)

            # Send the accumulated episode if we have frames with detections
            if episode_frames:
                print(f"[DetectEngine] Sending episode with {len(episode_frames)} frames",
                      file=sys.stderr)
                self._send_episode(episode_frames, detections_summary)
            else:
                print(f"[DetectEngine] No detections found in video", file=sys.stderr)

        finally:
            # Always release the capture
            if self.cap:
                self.cap.release()
                self.cap = None

    def _run_stream_loop(self):
        """
        Process a live RTSP stream continuously.
        Creates episodes based on activity/silence detection.
        Reconnects automatically on connection loss.
        """
        print(f"[DetectEngine] Starting live stream processing", file=sys.stderr)

        while self.running:
            try:
                self._connect_stream()
                self._process_stream()
            except Exception as e:
                print(f"[DetectEngine] Stream error: {e}", file=sys.stderr)
                if self.running:
                    print(f"[DetectEngine] Reconnecting in {self.RECONNECT_DELAY}s...",
                          file=sys.stderr)
                    time.sleep(self.RECONNECT_DELAY)

    def _connect_stream(self):
        """
        Connect to the RTSP stream with optimized settings.
        """
        print(f"[DetectEngine] Connecting to stream: {self.source}", file=sys.stderr)

        # Release existing capture if any
        if self.cap is not None:
            self.cap.release()

        # Create capture with RTSP-optimized settings
        self.cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)

        # Set buffer size to minimize latency
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        # Try to use hardware acceleration
        self.cap.set(cv2.CAP_PROP_HW_ACCELERATION, cv2.VIDEO_ACCELERATION_ANY)

        if not self.cap.isOpened():
            raise RuntimeError(f"Failed to connect to stream: {self.source}")

        print(f"[DetectEngine] Connected to stream successfully", file=sys.stderr)

    def _process_stream(self):
        """
        Process frames from the connected stream with activity-based episode creation.

        Episodes are created when:
        - Activity is detected (person/vehicle in frame)
        - Episode ends after SILENCE_THRESHOLD frames with no detections
        """
        # Episode buffering state
        active_frames: List[Dict[str, Any]] = []
        detections_summary: Dict[str, int] = {}
        silence_counter = 0
        episode_start_time: Optional[float] = None
        episode_count = 0

        # Thresholds for episode management
        SILENCE_THRESHOLD = 15  # ~0.5 seconds at 30fps with LIVE_FRAME_SKIP=3
        MAX_EPISODE_FRAMES = 300  # Cap episode size to prevent memory issues

        # Connection health tracking
        consecutive_failures = 0
        max_failures = 30  # ~1 second of failures at 30fps

        print(f"[DetectEngine] Processing stream with silence threshold: {SILENCE_THRESHOLD}",
              file=sys.stderr)

        try:
            while self.running and consecutive_failures < max_failures:
                ret, frame = self.cap.read()

                if not ret:
                    consecutive_failures += 1
                    time.sleep(0.01)  # Brief sleep on read failure
                    continue

                consecutive_failures = 0
                self.frame_count += 1

                # Skip frames for live processing efficiency
                if self.frame_count % self.LIVE_FRAME_SKIP != 0:
                    continue

                # Get current timestamp
                current_time = time.time()

                # Run YOLO detection
                detections = self._detect_frame(frame)
                has_detections = len(detections) > 0

                if has_detections:
                    # Reset silence counter on activity
                    silence_counter = 0

                    # Start new episode if not already active
                    if episode_start_time is None:
                        episode_start_time = current_time
                        print(f"[DetectEngine] Episode started at frame {self.frame_count}",
                              file=sys.stderr)

                    # Create per-frame data for real-time output
                    episode_data = self._create_episode_data(detections, frame)

                    # Output to stdout for real-time processing
                    print(f"DETECTION_JSON:{json.dumps(episode_data)}")
                    sys.stdout.flush()

                    # POST individual detection
                    self._post_detection(episode_data)

                    # Send Telegram alert for high-confidence person detections
                    self._send_telegram_alert(frame, detections)

                    # Accumulate frame for episode batch
                    frame_detections = []
                    for det in detections:
                        frame_detections.append({
                            'label': det['class'],
                            'confidence': det['confidence'],
                            'bbox': det['bbox']
                        })
                        # Update detection summary counts
                        cls_name = det['class']
                        detections_summary[cls_name] = detections_summary.get(cls_name, 0) + 1

                    active_frames.append({
                        'seq': len(active_frames),
                        'image': frame.copy(),
                        'detections': frame_detections,
                        'timestamp': current_time,
                        'frame_number': self.frame_count
                    })

                    # Check if episode is too large - send and reset
                    if len(active_frames) >= MAX_EPISODE_FRAMES:
                        print(f"[DetectEngine] Episode max size reached, sending partial episode",
                              file=sys.stderr)
                        self._send_episode(active_frames, detections_summary)
                        episode_count += 1
                        # Reset for next episode segment
                        active_frames = []
                        detections_summary = {}
                        episode_start_time = current_time  # Continue as new episode

                else:
                    # No detections - increment silence counter
                    silence_counter += 1

                    # Check if we should end the current episode
                    if silence_counter >= SILENCE_THRESHOLD and active_frames:
                        # Calculate episode duration
                        episode_duration = current_time - (episode_start_time or current_time)

                        print(f"[DetectEngine] Episode ended: {len(active_frames)} frames, "
                              f"{episode_duration:.2f}s duration, "
                              f"detections: {detections_summary}",
                              file=sys.stderr)

                        # Send the episode
                        self._send_episode(active_frames, detections_summary)
                        episode_count += 1

                        # Reset episode state
                        active_frames = []
                        detections_summary = {}
                        episode_start_time = None
                        silence_counter = 0

            # Handle stream disconnect
            if consecutive_failures >= max_failures:
                # Send any pending episode before raising error
                if active_frames:
                    print(f"[DetectEngine] Sending pending episode before reconnect",
                          file=sys.stderr)
                    self._send_episode(active_frames, detections_summary)
                    episode_count += 1
                raise RuntimeError("Too many consecutive frame read failures")

        finally:
            # Send any remaining frames as final episode on cleanup
            if active_frames:
                print(f"[DetectEngine] Sending final episode on stream end",
                      file=sys.stderr)
                self._send_episode(active_frames, detections_summary)
                episode_count += 1

            print(f"[DetectEngine] Stream session ended. "
                  f"Total episodes: {episode_count}, Total frames: {self.frame_count}",
                  file=sys.stderr)

    def _run_http_loop(self):
        """
        Process snapshots from an HTTP endpoint (Hikvision ISAPI or similar).
        Polls the endpoint at regular intervals and runs detection on each snapshot.
        Uses Digest authentication for Hikvision cameras.

        This is wrapped in a persistent reconnection loop to handle network blips.
        """
        print(f"[DetectEngine] Starting HTTP snapshot polling", file=sys.stderr)
        print(f"[DetectEngine] URL: {self.source}", file=sys.stderr)
        print(f"[DetectEngine] Poll interval: {self.HTTP_POLL_INTERVAL}s", file=sys.stderr)

        # Outer reconnection loop for persistence
        reconnect_count = 0
        max_reconnects = 100  # Give up after many reconnects

        while self.running and reconnect_count < max_reconnects:
            try:
                self._http_polling_session(reconnect_count)
            except Exception as e:
                reconnect_count += 1
                print(f"[DetectEngine] HTTP session error: {e}", file=sys.stderr)
                print(f"[DetectEngine] Reconnecting in {self.RECONNECT_DELAY}s... (attempt {reconnect_count}/{max_reconnects})",
                      file=sys.stderr)

                # Close existing session
                if self.http_session:
                    self.http_session.close()
                    self.http_session = None

                time.sleep(self.RECONNECT_DELAY)

        print(f"[DetectEngine] HTTP loop ended after {reconnect_count} reconnects", file=sys.stderr)

    def _http_polling_session(self, reconnect_count: int = 0):
        """
        Internal HTTP polling session. Separated for reconnection handling.
        """
        # Create session with Digest auth
        self.http_session = requests.Session()
        if self.username and self.password:
            self.http_session.auth = HTTPDigestAuth(self.username, self.password)
            print(f"[DetectEngine] Using Digest auth for user: {self.username}", file=sys.stderr)

        # Episode buffering state (same as stream mode)
        active_frames: List[Dict[str, Any]] = []
        detections_summary: Dict[str, int] = {}
        silence_counter = 0
        episode_start_time: Optional[float] = None
        episode_count = 0
        consecutive_failures = 0

        # Thresholds for episode management
        SILENCE_THRESHOLD = 6  # ~3 seconds at 0.5s poll interval
        MAX_EPISODE_FRAMES = 120  # ~1 minute of snapshots
        MAX_FAILURES = 20  # Increased to handle brief network blips

        try:
            while self.running and consecutive_failures < MAX_FAILURES:
                loop_start = time.time()

                try:
                    # Fetch snapshot from HTTP endpoint
                    frame = self._fetch_http_snapshot()

                    if frame is None:
                        consecutive_failures += 1
                        print(f"[DetectEngine] Snapshot fetch failed ({consecutive_failures}/{MAX_FAILURES})",
                              file=sys.stderr)
                        time.sleep(self.HTTP_POLL_INTERVAL)
                        continue

                    consecutive_failures = 0
                    self.frame_count += 1
                    current_time = time.time()

                    # Run YOLO detection
                    detections = self._detect_frame(frame)
                    has_detections = len(detections) > 0

                    if has_detections:
                        # Reset silence counter on activity
                        silence_counter = 0

                        # Start new episode if not already active
                        if episode_start_time is None:
                            episode_start_time = current_time
                            print(f"[DetectEngine] Episode started at frame {self.frame_count}",
                                  file=sys.stderr)

                        # Create per-frame data for real-time output
                        episode_data = self._create_episode_data(detections, frame)

                        # Output to stdout for real-time processing
                        print(f"DETECTION_JSON:{json.dumps(episode_data)}")
                        sys.stdout.flush()

                        # POST individual detection
                        self._post_detection(episode_data)

                        # Send Telegram alert for high-confidence person detections
                        self._send_telegram_alert(frame, detections)

                        # Accumulate frame for episode batch
                        frame_detections = []
                        for det in detections:
                            frame_detections.append({
                                'label': det['class'],
                                'confidence': det['confidence'],
                                'bbox': det['bbox']
                            })
                            # Update detection summary counts
                            cls_name = det['class']
                            detections_summary[cls_name] = detections_summary.get(cls_name, 0) + 1

                        active_frames.append({
                            'seq': len(active_frames),
                            'image': frame.copy(),
                            'detections': frame_detections,
                            'timestamp': current_time,
                            'frame_number': self.frame_count
                        })

                        # Check if episode is too large - send and reset
                        if len(active_frames) >= MAX_EPISODE_FRAMES:
                            print(f"[DetectEngine] Episode max size reached, sending partial episode",
                                  file=sys.stderr)
                            self._send_episode(active_frames, detections_summary)
                            episode_count += 1
                            active_frames = []
                            detections_summary = {}
                            episode_start_time = current_time

                    else:
                        # No detections - increment silence counter
                        silence_counter += 1

                        # Check if we should end the current episode
                        if silence_counter >= SILENCE_THRESHOLD and active_frames:
                            episode_duration = current_time - (episode_start_time or current_time)

                            print(f"[DetectEngine] Episode ended: {len(active_frames)} frames, "
                                  f"{episode_duration:.2f}s duration, "
                                  f"detections: {detections_summary}",
                                  file=sys.stderr)

                            self._send_episode(active_frames, detections_summary)
                            episode_count += 1

                            # Reset episode state
                            active_frames = []
                            detections_summary = {}
                            episode_start_time = None
                            silence_counter = 0

                except Exception as e:
                    print(f"[DetectEngine] HTTP polling error: {e}", file=sys.stderr)
                    consecutive_failures += 1

                # Maintain poll interval
                elapsed = time.time() - loop_start
                sleep_time = max(0, self.HTTP_POLL_INTERVAL - elapsed)
                if sleep_time > 0:
                    time.sleep(sleep_time)

            # Handle too many failures - raise to trigger reconnect
            if consecutive_failures >= MAX_FAILURES:
                raise RuntimeError(f"Too many consecutive failures ({consecutive_failures})")

        finally:
            # Send any remaining frames as final episode
            if active_frames:
                print(f"[DetectEngine] Sending final episode on HTTP session end", file=sys.stderr)
                self._send_episode(active_frames, detections_summary)
                episode_count += 1

            # Close HTTP session
            if self.http_session:
                self.http_session.close()
                self.http_session = None

            print(f"[DetectEngine] HTTP session ended. "
                  f"Total episodes: {episode_count}, Total frames: {self.frame_count}",
                  file=sys.stderr)

    def _fetch_http_snapshot(self) -> Optional[np.ndarray]:
        """
        Fetch a snapshot from the HTTP endpoint.

        Returns:
            OpenCV frame (numpy array) or None on failure
        """
        if not self.http_session:
            return None

        try:
            response = self.http_session.get(
                self.source,
                timeout=self.HTTP_TIMEOUT,
                stream=True
            )

            if response.status_code != 200:
                print(f"[DetectEngine] HTTP {response.status_code} from snapshot URL",
                      file=sys.stderr)
                return None

            # Read image data
            image_data = response.content

            # Decode JPEG to OpenCV frame
            nparr = np.frombuffer(image_data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if frame is None:
                print(f"[DetectEngine] Failed to decode image from HTTP response",
                      file=sys.stderr)
                return None

            return frame

        except requests.Timeout:
            print(f"[DetectEngine] HTTP snapshot request timed out", file=sys.stderr)
            return None
        except requests.RequestException as e:
            print(f"[DetectEngine] HTTP snapshot request failed: {e}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[DetectEngine] Error fetching HTTP snapshot: {e}", file=sys.stderr)
            return None

    def _detect_frame(self, frame) -> list:
        """
        Run YOLO detection on a single frame.

        Returns:
            List of detection dictionaries
        """
        results = self.model(frame, verbose=False, conf=self.confidence)

        detections = []
        for result in results:
            boxes = result.boxes
            if boxes is None:
                continue

            for i, box in enumerate(boxes):
                cls_id = int(box.cls[0])
                cls_name = self.class_names.get(cls_id, f"class_{cls_id}")

                # Filter to allowed classes
                if cls_name not in self.ALLOWED_CLASSES:
                    continue

                conf = float(box.conf[0])
                bbox = box.xyxy[0].tolist()  # [x1, y1, x2, y2]

                detections.append({
                    'class': cls_name,
                    'confidence': round(conf, 3),
                    'bbox': [round(b, 1) for b in bbox],
                    'class_id': cls_id
                })

                self.detection_count += 1

        return detections

    def _create_episode_data(self, detections: list, frame) -> dict:
        """
        Create a unified episode data structure.

        Args:
            detections: List of detection dictionaries
            frame: The OpenCV frame (for snapshot)

        Returns:
            Episode data dictionary
        """
        timestamp = datetime.utcnow().isoformat() + 'Z'

        # Calculate frame dimensions
        height, width = frame.shape[:2]

        # Build detection list with normalized coordinates
        detection_list = []
        for det in detections:
            bbox = det['bbox']
            detection_list.append({
                'label': det['class'],
                'confidence': det['confidence'],
                'bbox': bbox,
                'bbox_normalized': [
                    round(bbox[0] / width, 4),
                    round(bbox[1] / height, 4),
                    round(bbox[2] / width, 4),
                    round(bbox[3] / height, 4)
                ]
            })

        # Check if any person detected - include frame image if so
        has_relevant = any(det['class'].lower() in ['person', 'car'] for det in detections)
        frame_base64 = None
        if has_relevant:
            # Draw bounding boxes on frame before encoding
            frame_with_boxes = self._draw_bounding_boxes(frame.copy(), detections, width, height)
            # Encode frame for person detections in live mode
            frame_base64 = self._encode_frame_to_base64(frame_with_boxes)

        return {
            'type': 'detection',
            'mode': self.mode,
            'camera_id': self.cam_id,
            'frame_number': self.frame_count,
            'timestamp': timestamp,
            'frame_dimensions': {'width': width, 'height': height},
            'detections': detection_list,
            'detection_count': len(detection_list),
            'engine': 'yolo',
            'model': 'yolov8m',
            'frame_image': frame_base64  # Base64 JPEG for person detections
        }

    def _post_detection(self, data: dict):
        """
        Send detection data via Redis (preferred) or HTTP POST (fallback).

        If Redis is connected:
        - LPUSH to 'detection_queue' list for reliable processing
        - PUBLISH to 'live_events' channel for real-time UI updates

        Args:
            data: Episode data dictionary
        """
        # Prefer Redis if available
        if self.redis_client:
            try:
                json_data = json.dumps(data)
                # Push to queue for reliable processing
                self.redis_client.lpush('detection_queue', json_data)
                # Publish for real-time subscribers
                self.redis_client.publish('live_events', json_data)
                return
            except redis.RedisError as e:
                print(f"[DetectEngine] Redis error: {e}", file=sys.stderr)
                # Fall through to HTTP fallback

        # HTTP fallback
        if not self.endpoint:
            return

        try:
            response = requests.post(
                self.endpoint,
                json=data,
                timeout=5,
                headers={'Content-Type': 'application/json'}
            )
            if response.status_code != 200:
                print(f"[DetectEngine] POST failed: {response.status_code}",
                      file=sys.stderr)
        except requests.RequestException as e:
            # Don't spam logs for connection errors in live mode
            if self.mode == 'UPLOAD':
                print(f"[DetectEngine] POST error: {e}", file=sys.stderr)

    def _send_telegram_alert(self, frame, detections: list):
        """
        Send a Telegram alert for high-confidence person detections.
        Respects cooldown to prevent spam.

        Args:
            frame: OpenCV frame (numpy array)
            detections: List of detection dictionaries
        """
        if not TELEGRAM_ENABLED:
            return

        current_time = time.time()

        # Check cooldown
        if current_time - self.last_alert_time < self.ALERT_COOLDOWN:
            return

        # Find high-confidence person detections
        for det in detections:
            if det['class'].lower() == 'person' and det['confidence'] >= self.ALERT_CONFIDENCE_THRESHOLD:
                # Save frame to temp file
                alert_dir = os.path.join(os.path.dirname(__file__), 'data', 'alerts')
                os.makedirs(alert_dir, exist_ok=True)
                alert_path = os.path.join(alert_dir, f"alert_{self.cam_id}_{int(current_time)}.jpg")

                # Draw bounding boxes on frame before saving
                frame_with_boxes = self._draw_bounding_boxes(frame.copy(), detections, frame.shape[1], frame.shape[0])
                cv2.imwrite(alert_path, frame_with_boxes)

                # Send Telegram alert
                try:
                    send_alert(alert_path, f"Person on {self.cam_id}", det['confidence'])
                    self.last_alert_time = current_time
                    print(f"[DetectEngine] Telegram alert sent for {self.cam_id}", file=sys.stderr)
                except Exception as e:
                    print(f"[DetectEngine] Telegram alert failed: {e}", file=sys.stderr)

                # Only send one alert per cooldown period
                break

    def _draw_bounding_boxes(self, frame, detections, width: int, height: int):
        """
        Draw bounding boxes on frame for all detections.

        Args:
            frame: OpenCV frame (numpy array)
            detections: List of detection dictionaries with 'class', 'confidence', 'bbox'
            width: Frame width (unused - bbox already in pixels)
            height: Frame height (unused - bbox already in pixels)

        Returns:
            Frame with bounding boxes drawn
        """
        # Colors for different classes (BGR format)
        colors = {
            'person': (0, 255, 0),    # Green
            'car': (255, 165, 0),     # Orange
            'truck': (255, 0, 0),     # Blue
            'motorcycle': (255, 255, 0),  # Cyan
            'bicycle': (0, 255, 255),  # Yellow
            'bus': (128, 0, 128),     # Purple
        }
        default_color = (0, 255, 0)  # Green default

        for det in detections:
            cls = det.get('class', '').lower()
            conf = det.get('confidence', 0)
            bbox = det.get('bbox', [])

            if len(bbox) != 4:
                continue

            # bbox is already in pixel coordinates [x1, y1, x2, y2]
            x1 = int(bbox[0])
            y1 = int(bbox[1])
            x2 = int(bbox[2])
            y2 = int(bbox[3])

            # Get color for this class
            color = colors.get(cls, default_color)

            # Draw rectangle with thicker line
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)

            # Draw label background
            label = f"{cls} {conf:.0%}"
            (label_w, label_h), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.rectangle(frame, (x1, y1 - label_h - 10), (x1 + label_w + 6, y1), color, -1)

            # Draw label text
            cv2.putText(frame, label, (x1 + 3, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

        return frame

    def _encode_frame_to_base64(self, frame) -> str:
        """
        Encode an OpenCV frame to base64 JPEG string.

        Args:
            frame: OpenCV frame (numpy array)

        Returns:
            Base64 encoded JPEG string
        """
        # Encode frame as JPEG
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 85]
        _, buffer = cv2.imencode('.jpg', frame, encode_param)

        # Convert to base64
        return base64.b64encode(buffer).decode('utf-8')

    def _serialize_episode(
        self,
        frames: List[Dict[str, Any]],
        detections_summary: Dict[str, int]
    ) -> Dict[str, Any]:
        """
        Serialize an episode with frames and detections into unified JSON format.

        Both UPLOAD and LIVE modes send the same JSON structure to Node.js.

        Args:
            frames: List of frame dictionaries, each containing:
                - 'image': OpenCV frame (numpy array)
                - 'seq': Sequence number
                - 'detections': List of detection bboxes for this frame
                - 'timestamp': Frame timestamp
            detections_summary: Aggregated detection counts, e.g. {"person": 3, "car": 1}

        Returns:
            Unified episode dictionary ready for JSON serialization
        """
        # Calculate episode duration from frame timestamps
        if len(frames) >= 2:
            first_ts = frames[0].get('timestamp', 0)
            last_ts = frames[-1].get('timestamp', 0)
            duration_sec = (last_ts - first_ts) if isinstance(first_ts, (int, float)) else 0.0
        else:
            duration_sec = 0.0

        # Build frames array with base64 encoded images
        serialized_frames = []
        for i, frame_data in enumerate(frames):
            frame_entry = {
                'seq': frame_data.get('seq', i),
                'image': self._encode_frame_to_base64(frame_data['image']),
                'bbox': frame_data.get('detections', [])
            }
            serialized_frames.append(frame_entry)

        # Build the unified episode payload
        episode_payload = {
            'source_type': 'live_stream' if self.mode == 'LIVE' else 'file_upload',
            'camera_id': self.cam_id,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'duration_sec': round(duration_sec, 3),
            'frames': serialized_frames,
            'yolo_detections': detections_summary
        }

        return episode_payload

    def _send_episode(
        self,
        frames: List[Dict[str, Any]],
        detections_summary: Dict[str, int]
    ) -> bool:
        """
        Serialize and send an episode via Redis (preferred) or HTTP (fallback).

        Args:
            frames: List of frame dictionaries (see _serialize_episode)
            detections_summary: Aggregated detection counts

        Returns:
            True if successfully sent, False otherwise
        """
        try:
            # Serialize the episode
            payload = self._serialize_episode(frames, detections_summary)
            payload['type'] = 'episode'  # Mark as episode for Node.js

            # Prefer Redis if available
            if self.redis_client:
                try:
                    json_data = json.dumps(payload)
                    # Push to queue for reliable processing
                    self.redis_client.lpush('detection_queue', json_data)
                    # Publish for real-time subscribers
                    self.redis_client.publish('live_events', json_data)
                    print(f"[DetectEngine] Episode sent via Redis: "
                          f"{len(frames)} frames, {sum(detections_summary.values())} detections",
                          file=sys.stderr)
                    return True
                except redis.RedisError as e:
                    print(f"[DetectEngine] Redis error: {e}, trying HTTP fallback", file=sys.stderr)
                    # Fall through to HTTP fallback

            # HTTP fallback
            if not self.endpoint:
                print("[DetectEngine] No endpoint configured, skipping episode send",
                      file=sys.stderr)
                return False

            # POST to Node.js endpoint
            response = requests.post(
                self.endpoint,
                json=payload,
                timeout=3,
                headers={'Content-Type': 'application/json'}
            )

            if response.status_code == 200:
                print(f"[DetectEngine] Episode sent successfully: "
                      f"{len(frames)} frames, {sum(detections_summary.values())} detections",
                      file=sys.stderr)
                return True
            else:
                print(f"[DetectEngine] Episode send failed: HTTP {response.status_code}",
                      file=sys.stderr)
                return False

        except requests.Timeout:
            print("[DetectEngine] Episode send timed out", file=sys.stderr)
            return False
        except requests.ConnectionError as e:
            print(f"[DetectEngine] Episode send connection error: {e}", file=sys.stderr)
            return False
        except requests.RequestException as e:
            print(f"[DetectEngine] Episode send error: {e}", file=sys.stderr)
            return False
        except Exception as e:
            print(f"[DetectEngine] Unexpected error sending episode: {e}", file=sys.stderr)
            return False

    def _start_heartbeat_thread(self):
        """
        Start the heartbeat thread for health monitoring.
        Writes timestamp to Redis every HEARTBEAT_INTERVAL seconds.
        Key format: heartbeat:detector:<camera_id>
        """
        if not self.redis_client:
            print(f"[DetectEngine] Heartbeat disabled - no Redis connection", file=sys.stderr)
            return

        def heartbeat_loop():
            heartbeat_key = f"heartbeat:detector:{self.cam_id}"
            print(f"[DetectEngine] Heartbeat thread started for {heartbeat_key}", file=sys.stderr)

            while self.running:
                try:
                    # Write current timestamp (milliseconds since epoch)
                    timestamp_ms = int(time.time() * 1000)
                    self.redis_client.set(heartbeat_key, str(timestamp_ms))
                except redis.RedisError as e:
                    print(f"[DetectEngine] Heartbeat write failed: {e}", file=sys.stderr)
                except Exception as e:
                    print(f"[DetectEngine] Heartbeat error: {e}", file=sys.stderr)

                # Sleep for the heartbeat interval
                time.sleep(self.HEARTBEAT_INTERVAL)

            # Clean up heartbeat key on shutdown
            try:
                self.redis_client.delete(heartbeat_key)
                print(f"[DetectEngine] Heartbeat key removed on shutdown", file=sys.stderr)
            except Exception:
                pass

        self.heartbeat_thread = threading.Thread(target=heartbeat_loop, daemon=True)
        self.heartbeat_thread.start()

    def _cleanup(self):
        """
        Clean up resources.
        """
        self.running = False
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        print(f"[DetectEngine] Cleanup complete", file=sys.stderr)

    def stop(self):
        """
        Signal the detector to stop.
        """
        print(f"[DetectEngine] Stop requested", file=sys.stderr)
        self.running = False

    def _handle_signal(self, signum, frame):
        """
        Handle OS signals for graceful shutdown.

        When Node.js kills the process (SIGTERM) or user presses Ctrl+C (SIGINT),
        this handler ensures the camera is released and resources are cleaned up.

        Args:
            signum: Signal number received
            frame: Current stack frame (unused)
        """
        signal_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else str(signum)
        print(f"[DetectEngine] Received signal {signal_name} ({signum}), shutting down...",
              file=sys.stderr)

        # Set running flag to false to stop loops
        self.running = False

        # Release camera capture if open
        if self.cap:
            print(f"[DetectEngine] Releasing camera capture...", file=sys.stderr)
            self.cap.release()
            self.cap = None

        print(f"[DetectEngine] Graceful shutdown complete. "
              f"Processed {self.frame_count} frames, {self.detection_count} detections.",
              file=sys.stderr)

        sys.exit(0)


def parse_args():
    """
    Parse command line arguments.
    """
    parser = argparse.ArgumentParser(
        description='SecureWatch Unified Detection Engine',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Process a video file
  python detect_engine.py --mode UPLOAD --source video.mp4 --camid cam1 --endpoint http://localhost:4000/api/detections/ingest

  # Process an RTSP stream
  python detect_engine.py --mode LIVE --source rtsp://192.168.1.100:554/stream --camid front_door --endpoint http://localhost:4000/api/live/ingest

  # Process HTTP snapshots (Hikvision camera)
  python detect_engine.py --mode HTTP --source http://192.168.1.100:8001/ISAPI/Streaming/channels/101/picture --camid front_door --endpoint http://localhost:4000/api/live/ingest --username admin --password mypassword
        '''
    )

    parser.add_argument(
        '--mode',
        choices=['UPLOAD', 'LIVE', 'HTTP'],
        required=True,
        help='Detection mode: UPLOAD for video files, LIVE for RTSP streams, HTTP for snapshot polling'
    )

    parser.add_argument(
        '--source',
        required=True,
        help='Video file path, RTSP URL, or HTTP snapshot URL'
    )

    parser.add_argument(
        '--camid',
        required=True,
        help='Camera identifier string'
    )

    parser.add_argument(
        '--endpoint',
        default=None,
        help='Node.js callback URL for posting detections (optional if using --redis-host)'
    )

    parser.add_argument(
        '--confidence',
        type=float,
        default=SecureWatchDetector.DEFAULT_CONFIDENCE,
        help=f'Minimum confidence threshold (default: {SecureWatchDetector.DEFAULT_CONFIDENCE})'
    )

    parser.add_argument(
        '--username',
        default=None,
        help='HTTP auth username (for HTTP mode with Digest auth)'
    )

    parser.add_argument(
        '--password',
        default=None,
        help='HTTP auth password (for HTTP mode with Digest auth)'
    )

    parser.add_argument(
        '--redis-host',
        default=None,
        help='Redis server hostname (enables pub/sub mode instead of HTTP POST)'
    )

    parser.add_argument(
        '--redis-port',
        type=int,
        default=6379,
        help='Redis server port (default: 6379)'
    )

    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    detector = SecureWatchDetector(
        mode=args.mode,
        source=args.source,
        cam_id=args.camid,
        endpoint=args.endpoint,
        confidence=args.confidence,
        username=args.username,
        password=args.password,
        redis_host=getattr(args, 'redis_host', None),
        redis_port=getattr(args, 'redis_port', 6379)
    )

    detector.start()
