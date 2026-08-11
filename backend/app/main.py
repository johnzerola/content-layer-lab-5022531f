from fastapi import FastAPI, UploadFile, File, Header, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import os
import uuid
import hmac
import hashlib
from typing import List, Optional
from pydantic import BaseModel

app = FastAPI(title="AI Video Cleaner Worker")

# Enable CORS for the Lovable frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STORAGE_DIR = "storage"
os.makedirs(STORAGE_DIR, exist_ok=True)

# Secret shared with the Lovable server
WORKER_SECRET = os.getenv("CLEANER_WORKER_SECRET", "default_secret")

class Region(BaseModel):
    id: str
    kind: str
    role: str
    x: float
    y: float
    w: float
    h: float
    from_time: Optional[float] = None
    to_time: Optional[float] = None

class ProcessRequest(BaseModel):
    mode: str
    preset: str
    masks: List[dict]
    options: dict = {}
    callbackUrl: Optional[str] = None

@app.get("/v1/health")
async def health():
    return {"online": True, "cuda": False} # Simplified for MVP

@app.post("/v1/jobs/{job_id}/upload")
async def upload_video(job_id: str, file: UploadFile = File(...), x_job_token: str = Header(None)):
    # Verify token (HMAC of job_id)
    expected = hmac.new(WORKER_SECRET.encode(), job_id.encode(), hashlib.sha256).hexdigest()
    if x_job_token != expected:
        raise HTTPException(401, "Invalid job token")
    
    job_dir = os.path.join(STORAGE_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    
    file_path = os.path.join(job_dir, "input.mp4")
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())
        
    return {"ok": True, "filename": file.filename}

@app.post("/v1/jobs/{job_id}/detect")
async def detect_objects(job_id: str, mode: str):
    # Mock detection: returns a central rectangle for subtitles if mode is subtitle
    regions = []
    if mode == "subtitle":
        regions.append({
            "id": "det_1",
            "kind": "rect",
            "role": "remove",
            "x": 0.1, "y": 0.7, "w": 0.8, "h": 0.15,
            "label": "Legenda Detectada"
        })
    return {"regions": regions}

@app.post("/v1/jobs/{job_id}/process")
async def start_process(job_id: str, req: ProcessRequest, background_tasks: BackgroundTasks):
    # In a full setup, this would trigger a Celery task
    # For MVP without Redis, we use FastAPI BackgroundTasks
    from .workers.tasks import process_video_task
    
    # Run task in background
    background_tasks.add_task(
        process_video_task, 
        None, # self for celery, not used in background_tasks
        job_id, 
        req.mode, 
        req.preset, 
        req.masks, 
        req.callbackUrl
    )
    
    return {"status": "queued", "job_id": job_id}

@app.get("/v1/jobs/{job_id}/result")
async def get_result(job_id: str):
    file_path = os.path.join(STORAGE_DIR, job_id, "output.mp4")
    if not os.path.exists(file_path):
        raise HTTPException(404, "Result not ready")
    return FileResponse(file_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
