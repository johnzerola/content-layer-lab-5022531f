import os
import shutil
import cv2
import numpy as np
from celery import Celery
from .engines.inpainting import ProPainterEngine, STTNEngine
import requests
import hmac
import hashlib
import json

# Redis configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery('cleaner_tasks', broker=REDIS_URL, backend=REDIS_URL)

WORKER_SECRET = os.getenv("CLEANER_WORKER_SECRET", "default_secret")

def sign_payload(payload: dict, secret: str) -> str:
    msg = json.dumps(payload, sort_keys=True)
    return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()

@celery_app.task(name='process_video_task', bind=True)
def process_video_task(self, job_id: str, mode: str, preset: str, masks_data: list, callback_url: str):
    """
    Asynchronous task to process video inpainting
    """
    storage_path = f"storage/{job_id}"
    input_path = f"{storage_path}/input.mp4"
    output_path = f"{storage_path}/output.mp4"
    
    def update_progress(progress: float, stage: str):
        self.update_state(state='PROGRESS', meta={'progress': progress, 'stage': stage})
        if callback_url:
            payload = {
                "jobId": job_id,
                "status": "inpainting" if progress < 100 else "completed",
                "progress": progress,
                "stage": stage,
                "resultUrl": f"/v1/jobs/{job_id}/result" if progress >= 100 else None
            }
            sig = sign_payload(payload, WORKER_SECRET)
            try:
                requests.post(callback_url, json=payload, headers={"x-signature": sig}, timeout=5)
            except Exception as e:
                print(f"Callback error: {e}")

    try:
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Input video not found for job {job_id}")

        update_progress(5, "extraindo frames")
        
        cap = cv2.VideoCapture(input_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        frames = []
        while True:
            ret, frame = cap.read()
            if not ret: break
            frames.append(frame)
        cap.release()
        
        total_frames = len(frames)
        update_progress(15, f"frames extraídos: {total_frames}")

        # Create binary masks from regions
        # masks_data is a list of regions: {x, y, w, h, from, to}
        masks = np.zeros((total_frames, height, width), dtype=np.uint8)
        for m in masks_data:
            start_f = int(m.get('from', 0) * fps)
            end_f = int(m.get('to', total_frames/fps) * fps)
            
            x = int(m['x'] * width)
            y = int(m['y'] * height)
            w = int(m['w'] * width)
            h = int(m['h'] * height)
            
            # Clamp values
            x, y = max(0, x), max(0, y)
            w, h = min(width - x, w), min(height - y, h)
            
            for f in range(max(0, start_f), min(total_frames, end_f)):
                masks[f, y:y+h, x:x+w] = 255

        update_progress(20, "inicializando engine de IA")
        engine = ProPainterEngine() if preset == "quality" else STTNEngine()
        
        # Process in chunks to avoid OOM
        chunk_size = 40
        processed_frames = []
        
        for i in range(0, total_frames, chunk_size):
            chunk_end = min(i + chunk_size, total_frames)
            update_progress(20 + (i / total_frames) * 60, f"removendo objetos: frame {i}/{total_frames}")
            
            chunk_frames = np.array(frames[i:chunk_end])
            chunk_masks = masks[i:chunk_end]
            
            cleaned_chunk = engine.process(chunk_frames, chunk_masks)
            processed_frames.extend(cleaned_chunk)

        update_progress(85, "encodando resultado final")
        
        # Write output video using FFmpeg (via cv2 for MVP simplicity)
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        for frame in processed_frames:
            out.write(frame)
        out.release()
        
        update_progress(100, "concluído")
        return {"status": "completed", "result": output_path}

    except Exception as e:
        print(f"Task failed: {e}")
        update_progress(0, f"erro: {str(e)}")
        if callback_url:
            payload = {"jobId": job_id, "status": "failed", "error": str(e)}
            sig = sign_payload(payload, WORKER_SECRET)
            requests.post(callback_url, json=payload, headers={"x-signature": sig})
        raise e
