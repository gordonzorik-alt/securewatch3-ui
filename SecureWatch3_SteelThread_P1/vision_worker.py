import cv2
import time
import json
import redis
import argparse
import os
import uuid
import threading
from ultralytics import YOLO
from datetime import datetime

# Force TCP for RTSP (must be before any cv2 operations)
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

RAM_DISK_PATH = "/home/dd/securewatch3/v2_images"
REDIS_CHANNEL = "v2:detections"

class FreshFrame:
    def __init__(self, url):
        self.cap = cv2.VideoCapture(url)
        self.lock = threading.Lock()
        self.frame = None
        self.success = False
        self.running = True
        
        if not self.cap.isOpened():
            print(f"[v2-Eye] Failed to open {url}")
            return

        self.thread = threading.Thread(target=self._reader)
        self.thread.daemon = True
        self.thread.start()
        print(f"[v2-Eye] FreshFrame thread started")

    def _reader(self):
        while self.running:
            success, frame = self.cap.read()
            if not success:
                time.sleep(1)
                continue
            with self.lock:
                self.frame = frame
                self.success = success

    def read(self):
        with self.lock:
            return self.success, self.frame
            
    def release(self):
        self.running = False
        self.cap.release()

def run_worker(camera_id, rtsp_url, model_name="yolo11n.pt", redis_host="localhost"):
    print(f"[v2-Eye] Starting Vision Worker for {camera_id}")
    print(f"[v2-Eye] Mode: PERSON ONLY, 70% confidence")
    r = redis.Redis(host=redis_host, port=6379, decode_responses=True)
    model = YOLO(model_name)
    
    cap = FreshFrame(rtsp_url)
    print(f"[v2-Eye] Connected to {rtsp_url}")
    last_heartbeat = 0
    last_debug = 0
    time.sleep(1)

    while True:
        success, frame = cap.read()
        
        if frame is None:
            time.sleep(0.1)
            continue
            
        if not success:
            time.sleep(1)
            continue

        # Heartbeat
        if time.time() - last_heartbeat > 5:
            r.setex(f"heartbeat:detector:{camera_id}", 60, str(time.time()))
            last_heartbeat = time.time()

        # Debug every 10 seconds
        if time.time() - last_debug > 10:
            print(f"[v2-Eye] Processing frame {frame.shape}")
            last_debug = time.time()

        # PERSON ONLY (class 0), 70% confidence
        results = model(frame, stream=True, verbose=False, conf=0.40, classes=[0])

        for result in results:
            boxes_count = len(result.boxes)
            
            if boxes_count == 0:
                continue
            
            print(f"[v2-Eye] Found {boxes_count} person(s)")
            annotated_frame = result.plot()
            
            for box in result.boxes:
                label = model.names[int(box.cls)]
                conf = float(box.conf)
                
                # Save and publish
                event_id = str(uuid.uuid4())
                timestamp = datetime.utcnow().isoformat() + "Z"
                filename = f"{camera_id}_{event_id}.jpg"
                filepath = os.path.join(RAM_DISK_PATH, filename)
                
                cv2.imwrite(filepath, annotated_frame)

                payload = {
                    "id": event_id,
                    "camera": camera_id,
                    "time": timestamp,
                    "file": filepath,
                    "class": label,
                    "score": conf
                }
                r.publish(REDIS_CHANNEL, json.dumps(payload))
                print(f"[v2-Eye] {label} ({conf:.0%}) -> Published to Redis")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--camid", required=True)
    parser.add_argument("--source", required=True)
    args = parser.parse_args()
    
    os.makedirs(RAM_DISK_PATH, exist_ok=True)
    run_worker(args.camid, args.source)
