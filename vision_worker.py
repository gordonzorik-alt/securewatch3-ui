import cv2
import time
import json
import redis
import argparse
import os
import uuid
from ultralytics import YOLO
from datetime import datetime

# --- CONFIGURATION ---
RAM_DISK_PATH = "/dev/shm/securewatch_v2"
REDIS_CHANNEL = "v2:detections"  # New channel so old system ignores it

def run_worker(camera_id, rtsp_url, model_name="yolo11n.pt", redis_host="localhost"):
    # 1. Setup Infrastructure
    print(f"[v2-Eye] Starting Vision Worker for {camera_id}")
    r = redis.Redis(host=redis_host, port=6379, decode_responses=True)
    model = YOLO(model_name)

    # 2. Connect to MediaMTX (TCP forced for stability)
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
    cap = cv2.VideoCapture(rtsp_url)

    if not cap.isOpened():
        print(f"[v2-Eye] Error: Could not open stream {rtsp_url}")
        return

    print(f"[v2-Eye] Connected to {rtsp_url}")

    while True:
        success, frame = cap.read()
        if not success:
            print("[v2-Eye] Stream lost. Reconnecting in 2s...")
            time.sleep(2)
            cap.open(rtsp_url)
            continue

        # 3. The "Brain" (YOLO)
        # stream=True is faster, conf=0.25 matches your Nano needs
        results = model(frame, stream=True, verbose=False, conf=0.25, classes=[0, 2]) # 0=person, 2=car

        for result in results:
            for box in result.boxes:
                # 4. The "Action" (Save to RAM & Signal)

                # Generate unique ID
                event_id = str(uuid.uuid4())
                timestamp = datetime.utcnow().isoformat() + "Z"
                filename = f"{camera_id}_{event_id}.jpg"
                filepath = os.path.join(RAM_DISK_PATH, filename)

                # Save Image to RAM (Instant)
                cv2.imwrite(filepath, frame)

                # Construct Signal
                payload = {
                    "id": event_id,
                    "camera": camera_id,
                    "time": timestamp,
                    "file": filepath, # Pointer to RAM
                    "class": model.names[int(box.cls)],
                    "score": float(box.conf)
                }

                # Fire Signal
                r.publish(REDIS_CHANNEL, json.dumps(payload))
                print(f" -> [v2-Eye] Saw {payload['class']} ({payload['score']:.2f}) -> Saved to RAM")

        # Optional: Sleep slightly to save CPU if 30fps isn't needed
        # time.sleep(0.05)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--camid", required=True)
    parser.add_argument("--source", required=True)
    args = parser.parse_args()

    # Ensure RAM disk exists
    os.makedirs(RAM_DISK_PATH, exist_ok=True)

    run_worker(args.camid, args.source)
