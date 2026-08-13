import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

export async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  
  ffmpeg = new FFmpeg();
  
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  
  return ffmpeg;
}

/**
 * Separa voz e música de um arquivo de áudio/vídeo.
 * Como o FFmpeg puro não faz separação de fontes (Spleeter/Demucs) sem modelos pesados,
 * usamos uma aproximação de fase ou apenas extraímos o áudio para o usuário processar
 * em lote se tivermos um worker Python.
 * 
 * Para este MVP, implementamos a EXTRAÇÃO e uma tentativa de filtragem de voz.
 */
export async function splitAudio(file: File): Promise<{ voice: Blob; music: Blob }> {
  const instance = await loadFFmpeg();
  const inputName = "input" + file.name.substring(file.name.lastIndexOf("."));
  
  await instance.writeFile(inputName, await fetchFile(file));
  
  // Extração básica de áudio
  await instance.exec(["-i", inputName, "-vn", "-acodec", "libmp3lame", "audio.mp3"]);
  
  // No FFmpeg.wasm, separação real de vozes (AI) não é viável localmente por performance.
  // Criamos uma versão "Voz" (filtros passa-banda) e "Música" (corte de frequências de voz)
  // para simular o comportamento até que o backend GPU esteja pronto.
  
  // Voz: Filtro de 300Hz a 3000Hz
  await instance.exec(["-i", "audio.mp3", "-af", "highpass=f=300,lowpass=f=3000", "voice.mp3"]);
  
  // Música: Filtro rejeita-banda na frequência humana
  await instance.exec(["-i", "audio.mp3", "-af", "anequalizer=c0 f=1000 w=2000 g=-20|c1 f=1000 w=2000 g=-20", "music.mp3"]);
  
  const voiceData = await instance.readFile("voice.mp3");
  const musicData = await instance.readFile("music.mp3");
  
  return {
    voice: new Blob([voiceData], { type: "audio/mp3" }),
    music: new Blob([musicData], { type: "audio/mp3" }),
  };
}
