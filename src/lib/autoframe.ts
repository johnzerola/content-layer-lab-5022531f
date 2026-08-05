/** Enquadramento automático: detecção de rosto (quando disponível) + saliência de movimento. */

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}

type FaceDetectorCtor = new (o?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
  detect: (src: CanvasImageSource) => Promise<DetectedFace[]>;
};

export interface AutoFrame {
  offsetX: number;
  offsetY: number;
  source: "rosto" | "movimento" | "centro";
}

const clamp = (n: number) => Math.max(-1, Math.min(1, n));

function energyCenter(a: ImageData, b: ImageData) {
  const { width: w, height: h } = a;
  const cols = new Float32Array(w);
  const rows = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const la = a.data[i]! * 0.3 + a.data[i + 1]! * 0.59 + a.data[i + 2]! * 0.11;
      const lb = b.data[i]! * 0.3 + b.data[i + 1]! * 0.59 + b.data[i + 2]! * 0.11;
      const d = Math.abs(la - lb);
      cols[x]! += d;
      rows[y]! += d;
    }
  }
  const centroid = (arr: Float32Array) => {
    let sum = 0;
    let acc = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i]!;
      acc += arr[i]! * i;
    }
    return sum > 0 ? acc / sum / arr.length : 0.5;
  };
  return { cx: centroid(cols), cy: centroid(rows), total: cols.reduce((s, v) => s + v, 0) };
}

/** Analisa alguns quadros do vídeo e devolve o deslocamento ideal do corte. */
export async function autoFrame(file: File): Promise<AutoFrame> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("erro"));
    });

    const W = 192;
    const H = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * W));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;

    const seek = async (t: number) => {
      video.currentTime = Math.min(Math.max(0.05, t), Math.max(0.1, video.duration - 0.1));
      await new Promise<void>((res) => {
        video.onseeked = () => res();
      });
      ctx.drawImage(video, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H);
    };

    const times = [0.15, 0.35, 0.55, 0.75].map((f) => f * video.duration);
    const frames: ImageData[] = [];
    for (const t of times) frames.push(await seek(t));

    // 1) rosto
    const FD = (window as unknown as { FaceDetector?: FaceDetectorCtor }).FaceDetector;
    if (FD) {
      try {
        const det = new FD({ fastMode: true, maxDetectedFaces: 5 });
        ctx.putImageData(frames[1] ?? frames[0]!, 0, 0);
        const faces = await det.detect(c);
        if (faces.length) {
          const cx =
            faces.reduce((s, f) => s + (f.boundingBox.x + f.boundingBox.width / 2), 0) / faces.length / W;
          const cy =
            faces.reduce((s, f) => s + (f.boundingBox.y + f.boundingBox.height / 2), 0) / faces.length / H;
          return { offsetX: clamp((0.5 - cx) * 2), offsetY: clamp((0.5 - cy) * 2), source: "rosto" };
        }
      } catch {
        /* segue para movimento */
      }
    }

    // 2) movimento
    let sx = 0;
    let sy = 0;
    let weight = 0;
    for (let i = 1; i < frames.length; i++) {
      const { cx, cy, total } = energyCenter(frames[i - 1]!, frames[i]!);
      sx += cx * total;
      sy += cy * total;
      weight += total;
    }
    if (weight > 0) {
      const cx = sx / weight;
      const cy = sy / weight;
      return {
        offsetX: clamp((0.5 - cx) * 1.6),
        offsetY: clamp((0.5 - cy) * 1.6),
        source: "movimento",
      };
    }
    return { offsetX: 0, offsetY: 0, source: "centro" };
  } catch {
    return { offsetX: 0, offsetY: 0, source: "centro" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
