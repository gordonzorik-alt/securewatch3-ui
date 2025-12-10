import cv2
import time
import json
import redis
import argparse
import os
import uuid
import threading
import boto3
from ultralytics import YOLO
from datetime import datetime

# Force TCP for RTSP
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

# S3/MinIO Configuration
S3_ENDPOINT = 'http://localhost:9000'
S3_ACCESS_KEY = 'minioadmin'
S3_SECRET_KEY = 'minioadmin'
BUCKET_NAME = 'images'
PUBLIC_IP = '136.119.129.106'  # Your Public IP

REDIS_CHANNEL = "v2:detections"

class FreshFrame:
    def __init__(self, url):
        self.cap = cv2.VideoCapture(url)
        self.lock = threading.Lock()
        self.frame = None
        self.success = False
        self.running = True
        
        if not self.cap.isOpened():
            print(f"[v3-Eye] Failed to open {url}")
            return

        self.thread = threading.Thread(target=self._reader)
        self.thread.daemon = True
        self.thread.start()
        print(f"[v3-Eye] FreshFrame thread started")

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
    print(f"[v3-Eye] Starting Vision Worker for {camera_id}")
    print(f"[v3-Eye] Mode: PERSON ONLY, 70% confidence")
    print(f"[v3-Eye] Storage: S3/MinIO @ {S3_ENDPOINT}")
    
    # Redis for pub/sub
    r = redis.Redis(host=redis_host, port=6379, decode_responses=True)
    
    # Initialize S3 Client (boto3)
    s3 = boto3.client('s3',
                      endpoint_url=S3_ENDPOINT,
                      aws_access_key_id=S3_ACCESS_KEY,
                      aws_secret_access_key=S3_SECRET_KEY)
    
    # Verify bucket exists
    try:
        s3.head_bucket(Bucket=BUCKET_NAME)
        print(f"[v3-Eye] S3 bucket '{BUCKET_NAME}' verified")
    except Exception as e:
        print(f"[v3-Eye] ERROR: Bucket '{BUCKET_NAME}' does not exist: {e}")
        return
    
    model = YOLO(model_name)
    
    cap = FreshFrame(rtsp_url)
    print(f"[v3-Eye] Connected to {rtsp_url}")
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
            print(f"[v3-Eye] Processing frame {frame.shape}")
            last_debug = time.time()

        # PERSON ONLY (class 0), 70% confidence
        results = model(frame, stream=True, verbose=False, conf=0.40, classes=[0])

        for result in results:
            boxes_count = len(result.boxes)
            
            if boxes_count == 0:
                continue
            
            print(f"[v3-Eye] Found {boxes_count} person(s)")
            annotated_frame = result.plot()
            
            for box in result.boxes:
                label = model.names[int(box.cls)]
                conf = float(box.conf)
                
                # Generate unique filename
                event_id = str(uuid.uuid4())
                timestamp = datetime.utcnow().isoformat() + "Z"
                filename = f"{camera_id}_{event_id}.jpg"
                
                # Encode image to JPEG bytes
                success_enc, buffer = cv2.imencode('.jpg', annotated_frame)
                if not success_enc:
                    print(f"[v3-Eye] Failed to encode image")
                    continue
                
                # Upload to S3/MinIO
                try:
                    s3.put_object(
                        Bucket=BUCKET_NAME,
                        Key=filename,
                        Body=buffer.tobytes(),
                        ContentType='image/jpeg'
                    )
                    
                    # Construct Public URL
                    image_url = f"http://{PUBLIC_IP}:9000/{BUCKET_NAME}/{filename}"
                    
                    payload = {
                        "id": event_id,
                        "camera": camera_id,
                        "time": timestamp,
                        "url": image_url,       # v3 format
                        "imageUrl": image_url,  # Backwards compat
                        "class": label,
                        "score": conf
                    }
                    r.publish(REDIS_CHANNEL, json.dumps(payload))
                    print(f"[v3-Eye] {label} ({conf:.0%}) -> S3 + Redis")
                    
                except Exception as e:
                    print(f"[v3-Eye] S3 upload failed: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--camid", required=True)
    parser.add_argument("--source", required=True)
    args = parser.parse_args()
    
    run_worker(args.camid, args.source)
