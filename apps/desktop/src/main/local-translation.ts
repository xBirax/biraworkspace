import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {LocalWorker} from "./local-worker.js";

type Reply = { text?:string; unchanged?:boolean; error?:string };
const address = /^(?:(?:(?:[a-z][a-z\d+.-]*:)?\/\/|mailto:|tel:|sms:|magnet:|geo:|www\.)[^\s<>"“”]+|(?:localhost|\[[0-9a-f:]+\]|(?:\d{1,3}\.){3}\d{1,3}|(?:[\w.+%-]+@)?(?:[\p{L}\d_-]+\.)+(?:xn--[\w-]+|[\p{L}]{2,63}))(?::\d+)?(?:[/?#][^\s<>"“”]*)?)$/iu;

export class LocalTranslation {
  private worker: LocalWorker;

  constructor(script:string) {
    this.worker = new LocalWorker(() => {
      const local = (process.platform === "win32" ? process.env["LOCALAPPDATA"] : process.env["XDG_DATA_HOME"]) || path.join(os.homedir(), ".local", "share");
      const root = path.join(local, "BiraWorkspace", "translation");
      const executable = path.join(root, process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python");
      return {executable, args:["-I","-X","utf8","-u","-c",fs.readFileSync(script,"utf8"),root]};
    },45000);
  }

  async translate(text:string, target:"pt"|"en"|"es", relevant=()=>true, glossary?:readonly {source:string;target:string}[]):Promise<Reply> {
    if (text.trim() && text.trim().split(/\s+/u).every(token=>address.test(token))) return {text,unchanged:true};
    try { return JSON.parse(await this.worker.request(JSON.stringify({text,target,glossary})+"\n",undefined,target!=="pt",relevant)); }
    catch { return {error:"Tradução local indisponível"}; }
  }

  close() { this.worker.close(); }
}
