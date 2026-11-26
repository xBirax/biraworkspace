import { LocalWorker } from "./local-worker.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function localWhisper() {
  const local = (process.platform === "win32" ? process.env["LOCALAPPDATA"] : process.env["XDG_DATA_HOME"]) || path.join(os.homedir(), ".local", "share");
  const binary = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const roots = ["BiraWorkspace", "BiraFlow"].map((name) => path.join(local, name));
  const override = process.env["BIRA_WHISPER_CLI"];
  const cpu = roots.map((dir) => path.join(dir, "whisper", binary)).find(fs.existsSync);
  const gpu = path.join(local, "BiraWorkspace", "whisper-cuda", "Release", binary);
  const cli = override && fs.existsSync(override) ? override :
    process.platform === "win32" && fs.existsSync(gpu) ? gpu : cpu;
  const model = [
    process.env["BIRA_WHISPER_MODEL"],
    ...roots.map((dir) => path.join(dir, "models", "ggml-small.bin")),
  ].find((file): file is string => !!file && fs.existsSync(file));
  return cli && model ? { cli, model, fallback: cli === gpu && !override ? cpu : undefined } : undefined;
}

let failedGpu = "";
let failedResident = "";
const voiceTemp = path.join((process.platform === "win32" ? process.env["LOCALAPPDATA"] : process.env["XDG_DATA_HOME"]) || path.join(os.homedir(),".local","share"),"BiraWorkspace","voice-temp");
export async function cleanVoiceTemp() {
  await fs.promises.mkdir(voiceTemp,{recursive:true,mode:0o700});
  for (const item of await fs.promises.readdir(voiceTemp,{withFileTypes:true})) {
    const match=/^job-(\d+)-[a-zA-Z0-9]{6}$/.exec(item.name);
    if (!match || !item.isDirectory()) continue;
    try { process.kill(Number(match[1]),0); continue; }
    catch (error) { if ((error as NodeJS.ErrnoException).code!=="ESRCH") continue; }
    const dir=path.join(voiceTemp,item.name);
    await fs.promises.unlink(path.join(dir,"voice.wav")).catch(()=>undefined);
    await fs.promises.rmdir(dir).catch(()=>undefined);
  }
}
let resident: { binary:string; model:string; worker:LocalWorker } | undefined;

export function closeLocalTranscription() {
  resident?.worker.close();
  resident = undefined;
}

export async function transcribePcm(pcm: Buffer, signal: AbortSignal, language:"pt"|"en"|"es"|"auto"="pt"): Promise<string> {
  const engine = localWhisper();
  if (!engine) throw Error("Whisper indisponível");
  if (!pcm.length || pcm.length % 2 || pcm.length > 16000 * 2 * 600)
    throw Error("Duração inválida");
  signal.throwIfAborted();
  const key=engine.cli+"|"+engine.model;
  const dir=path.dirname(engine.cli);
  const version2=path.join(dir,"bira-whisper-worker-v2.exe");
  const modern=fs.existsSync(version2);
  const binary=modern ? version2 : path.join(dir,"bira-whisper-worker.exe");
  if (process.platform === "win32" && !process.env["BIRA_WHISPER_CLI"] && (modern || language==="pt") && failedResident!==key && failedGpu!==key && fs.existsSync(binary)) {
    if (!resident || resident.binary !== binary || resident.model !== engine.model) {
      closeLocalTranscription();
      resident = {binary, model:engine.model, worker:new LocalWorker(() => ({
        executable:binary, args:[engine.model], cwd:path.dirname(binary),
      }),600000)};
    }
    const size = Buffer.alloc(4);
    size.writeUInt32LE(pcm.length + ["pt","en","es","auto"].indexOf(language)*0x10000000);
    try {
      const text = (await resident.worker.request(Buffer.concat([size,pcm]),signal)).trim();
      if (text) return text;
    } catch { signal.throwIfAborted(); failedResident=key; }
  }
  const wav = Buffer.alloc(44);
  wav.write("RIFF");
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  await fs.promises.mkdir(voiceTemp,{recursive:true,mode:0o700});
  const directory = await fs.promises.mkdtemp(path.join(voiceTemp, `job-${process.pid}-`));
  const file = path.join(directory, "voice.wav");
  try {
    await fs.promises.writeFile(file, Buffer.concat([wav, pcm]), { mode: 0o600 });
    signal.throwIfAborted();
    const recognize = (binary: string) => new Promise<string>((resolve, reject) => {
      const child = spawn(
        binary,
        ["-m", engine.model, "-l", language, "-nt", "-np", "-t", "4", "-f", file],
        {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          signal,
          timeout: 600000,
        },
      );
      const chunks: Buffer[] = [];
      child.on("error", reject);
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("close", (code) => {
        const text = Buffer.concat(chunks).toString("utf8").trim().replace(/\s+/g, " ");
        if (code === 0 && text) resolve(text);
        else reject(Error("Sem transcrição"));
      });
    });
    if (failedGpu===key && engine.fallback) return await recognize(engine.fallback);
    try { return await recognize(engine.cli); }
    catch (error) {
      signal.throwIfAborted();
      if (!engine.fallback) throw error;
      failedGpu=key;
      return await recognize(engine.fallback);
    }
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
}
