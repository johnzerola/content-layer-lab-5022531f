import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * API Client for the External Python GPU Worker.
 * Communicates with the backend defined in /backend/app/main.py.
 */

const API_BASE = import.meta.env.VITE_VIDEO_CLEANER_API_URL || "http://localhost:8000";

export const videoCleanerApi = {
  async getHealth() {
    try {
      const res = await fetch(`${API_BASE}/v1/health`);
      if (!res.ok) return { online: false, reason: "Worker offline" };
      return res.json();
    } catch (e) {
      return { online: false, reason: "Worker inacessível" };
    }
  },

  async uploadVideo(jobId: string, file: File, onProgress?: (p: number) => void) {
    const formData = new FormData();
    formData.append("file", file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/v1/jobs/${jobId}/upload`);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(xhr.responseText));
        }
      };
      xhr.onerror = () => reject(new Error("Erro de conexão com o worker"));
      xhr.send(formData);
    });
  },

  async detect(jobId: string, mode: string, roi?: any) {
    const res = await fetch(`${API_BASE}/v1/jobs/${jobId}/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, roi }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async process(input: {
    jobId: string;
    mode: string;
    preset: string;
    masks: any[];
    options: Record<string, any>;
    callbackUrl: string;
  }) {
    const res = await fetch(`${API_BASE}/v1/jobs/${input.jobId}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getStatus(jobId: string) {
    const res = await fetch(`${API_BASE}/v1/jobs/${jobId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
};
