"""Leitura/escrita de vídeo preservando resolução, FPS, duração e áudio."""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from typing import Iterator, List

import cv2
import numpy as np


@dataclass
class Probe:
    width: int
    height: int
    fps: float
    frames: int
    duration: float
    has_audio: bool


def probe(path: str) -> Probe:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_streams", "-show_format", path],
        capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    v = next(s for s in data["streams"] if s["codec_type"] == "video")
    has_audio = any(s["codec_type"] == "audio" for s in data["streams"])
    num, den = (v.get("avg_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 30.0
    duration = float(data["format"].get("duration") or 0.0)
    frames = int(v.get("nb_frames") or 0) or int(round(duration * fps))
    return Probe(int(v["width"]), int(v["height"]), fps or 30.0, frames, duration, has_audio)


def read_frames(path: str) -> Iterator[np.ndarray]:
    cap = cv2.VideoCapture(path)
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            yield frame
    finally:
        cap.release()


def read_chunk(path: str, start: int, count: int) -> List[np.ndarray]:
    cap = cv2.VideoCapture(path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, start)
    frames: List[np.ndarray] = []
    try:
        for _ in range(count):
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
    finally:
        cap.release()
    return frames


class RawWriter:
    """Escreve frames BGR crus num pipe ffmpeg (x264, sem perdas visíveis)."""

    def __init__(self, path: str, width: int, height: int, fps: float, crf: int = 16):
        self.proc = subprocess.Popen(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "rawvideo", "-pix_fmt", "bgr24",
             "-s", f"{width}x{height}", "-r", f"{fps}", "-i", "pipe:0",
             "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
             "-pix_fmt", "yuv420p", path],
            stdin=subprocess.PIPE,
        )

    def write(self, frame: np.ndarray) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(np.ascontiguousarray(frame).tobytes())

    def close(self) -> None:
        if self.proc.stdin:
            self.proc.stdin.close()
        self.proc.wait()


def mux_audio(video_only: str, original: str, output: str, has_audio: bool) -> None:
    """Remonta o vídeo processado com o áudio original intacto."""
    if not has_audio:
        os.replace(video_only, output)
        return
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-i", video_only, "-i", original,
         "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-shortest", output],
        check=True,
    )
    try:
        os.remove(video_only)
    except OSError:
        pass


def normalize_video(
    source: str,
    destination: str,
    width: int,
    height: int,
    fps: float,
) -> str:
    """Return a video at the source video's exact display size and frame rate."""
    current = probe(source)
    if current.width == width and current.height == height and abs(current.fps - fps) < 0.02:
        return source
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", source,
            "-vf", f"scale={width}:{height}:flags=lanczos",
            "-r", f"{fps:.6f}",
            "-c:v", "libx264", "-preset", "slow", "-crf", "16",
            "-pix_fmt", "yuv420p", destination,
        ],
        check=True,
    )
    return destination


def masks_to_video(mask_dir: str, destination: str, fps: float) -> str:
    """Encode numbered PNG masks losslessly enough for official model input."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", f"{fps:.6f}",
            "-i", os.path.join(mask_dir, "%06d.png"),
            "-c:v", "libx264", "-preset", "medium", "-crf", "0",
            "-pix_fmt", "yuv420p", "-r", f"{fps:.6f}",
            destination,
        ],
        check=True,
    )
    return destination
