import os
import time
import logging
import uuid
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Header, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cleaner-api")

app = FastAPI(title="AI Video Cleaner Worker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mocked state for MVP demonstration (in real use, this would be Redis/Celery)
JOBS = {}

class Region(BaseModel):
    id: str
    kind: str
    role: str
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None
    points: Optional[List[Dict[str, float]]] = None
    size: Optional[float] = None
    grow: Optional[float] = None
    from_time: Optional[float] = None
    to_time: Optional[float] = None
    track: Optional[bool] = None

class DetectRequest(BaseModel):
    mode: str
    roi: Optional[Region] = None

class ProcessRequest(BaseModel):
    jobId: str
    mode: str
    preset: str
    masks: List[Region]
    options: Dict[str, Any]
    callbackUrl: str

@app.get("/v1/health")
async def health():
    return {
        "online": True,
        "gpu": "NVIDIA RTX 4090" if os.environ.get("CUDA_VISIBLE_DEVICES") else "CPU",
        "engines": ["ProPainter", "STTN", "Lama"],
        "version": "1.0.0"
    }

@app.post("/v1/jobs/{job_id}/upload")
async def upload_video(job_id: str, file: UploadFile = File(...)):
    # In a real scenario, save the file to a temporary location
    file_path = f"/tmp/{job_id}_{file.filename}"
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())
    
    JOBS[job_id] = {
        "status": "queued",
        "file_path": file_path,
        "progress": 0,
        "stage": "upload concluído"
    }
    return {"ok": True}

@app.post("/v1/jobs/{job_id}/detect")
async def detect_masks(job_id: str, req: DetectRequest):
    # Mocking detection
    logger.info(f"Detecting {req.mode} in job {job_id}")
    return {
        "regions": [
            {
                "id": str(uuid.uuid4())[:8],
                "kind": "rect",
                "role": "remove",
                "x": 0.2, "y": 0.8, "w": 0.6, "h": 0.1,
                "label": "legenda detectada",
                "score": 0.95
            }
        ]
    }

@app.post("/v1/jobs/{job_id}/process")
async def process_video(job_id: str, req: ProcessRequest, background_tasks: BackgroundTasks):
    if job_id not in JOBS:
        JOBS[job_id] = {"status": "queued", "progress": 0}
    
    JOBS[job_id].update({
        "status": "analyzing",
        "mode": req.mode,
        "preset": req.preset,
        "masks": req.masks,
        "progress": 2
    })
    
    # In production, this would dispatch to Celery
    background_tasks.add_task(dummy_process, job_id, req.callbackUrl)
    
    return {"status": "accepted"}

@app.get("/v1/jobs/{job_id}")
async def get_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    return JOBS[job_id]

async def dummy_process(job_id: str, callback_url: str):
    stages = ["analyzing", "detecting", "tracking", "inpainting", "refining", "encoding"]
    for i, stage in enumerate(stages):
        JOBS[job_id]["status"] = stage
        JOBS[job_id]["stage"] = stage
        JOBS[job_id]["progress"] = int((i + 1) / len(stages) * 100)
        time.sleep(2)  # Simulating heavy GPU work
    
    JOBS[job_id]["status"] = "completed"
    JOBS[job_id]["progress"] = 100
    JOBS[job_id]["result_url"] = "https://example.com/result.mp4"
    # In reality, trigger the callbackUrl with HMAC signature

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
