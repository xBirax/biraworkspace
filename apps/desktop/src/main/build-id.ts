import fs from "node:fs";
import path from "node:path";
import {app} from "electron";
let cached:string;
export function buildId():string {
  try {return cached ??= JSON.parse(fs.readFileSync(path.join(app.getAppPath(),"dist/preload/build-id.json"),"utf8")) as string;}
  catch {return "desenvolvimento";}
}
