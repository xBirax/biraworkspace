import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";

type Child = ChildProcessByStdio<Writable, Readable, null>;
type Command = { executable:string; args:string[]; cwd?:string };

// One reply per request. Reuse the loaded model while active, then release its memory.
export class LocalWorker {
  private child: Child | undefined;
  private pending: ((line?:string) => void) | undefined;
  private queue: {priority:boolean; run:()=>Promise<void>}[] = [];
  private processing=false;
  private idle: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(private command: () => Command, private timeout: number) {}

  request(input: string | Buffer, signal?: AbortSignal, priority=false, relevant=()=>true):Promise<string> {
    return new Promise((resolve,reject)=>{
      const run=async()=>{
        try {
          if (!relevant()) throw Error("Pedido expirado");
          resolve(await this.exchange(input,signal));
        } catch(error) {reject(error);}
      };
      const index=priority ? this.queue.findIndex(job=>!job.priority) : -1;
      this.queue.splice(index<0?this.queue.length:index,0,{priority,run});
      if (!this.processing) void this.drain();
    });
  }

  private async drain() {
    this.processing=true;
    try {
      let job;
      while ((job=this.queue.shift())) await job.run();
    } finally {this.processing=false;}
  }

  private exchange(input: string | Buffer, signal?: AbortSignal): Promise<string> {
    if (this.closed) throw Error("Motor encerrado");
    signal?.throwIfAborted();
    clearTimeout(this.idle);
    if (!this.child) {
      const {executable,args,cwd} = this.command();
      const child = spawn(executable, args, {cwd, windowsHide:true, stdio:["pipe","pipe","ignore"]});
      this.child = child;
      const exited = () => {
        if (this.child !== child) return;
        this.child = undefined;
        this.pending?.();
      };
      child.on("error", exited);
      child.on("exit", exited);
      child.stdin.on("error", () => { if (this.child === child) this.stop(); });
      createInterface({input:child.stdout}).on("line", line => {
        if (this.child === child) this.pending?.(line);
      });
    }
    const child = this.child;
    return new Promise((resolve,reject) => {
      const abort = () => this.stop();
      const timeout = setTimeout(abort, this.timeout);
      this.pending = line => {
        this.pending = undefined;
        clearTimeout(timeout);
        signal?.removeEventListener("abort",abort);
        if (line === undefined) reject(Error("Motor local interrompido"));
        else {
          this.idle = setTimeout(() => this.stop(), 120000);
          this.idle.unref();
          resolve(line);
        }
      };
      signal?.addEventListener("abort",abort,{once:true});
      child.stdin.write(input);
    });
  }

  private stop() {
    clearTimeout(this.idle);
    const child = this.child;
    this.child = undefined;
    child?.kill();
    this.pending?.();
  }

  close() { this.closed = true; this.stop(); }
}
