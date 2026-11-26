import fs from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

const reader = fs.readFileSync(new URL("../preload/read-voice.js", import.meta.url), "utf8");

function page(viewOnce = false, signal?: AbortSignal) {
  const id = "ABCDEF0123456789";
  const message = { type: "ptt", id: { id, _serialized: "false_chat_" + id }, isViewOnce: viewOnce };
  const api = {
    getActiveChat: async () => ({ msgs: { getModelsArray: () => [message] } }),
    getMessageById: vi.fn(),
    downloadMedia: vi.fn(async () => new Blob(["audio"])),
  };
  const browser = {
    location: { origin: "https://web.whatsapp.com" },
    document: { querySelector: () => ({ dataset: { id }, isConnected: true }) },
    CSS: { escape: (key: string) => key },
    window: { WPP: { isReady: true, chat: api } },
    Blob, Int16Array, signal,
    OfflineAudioContext: class {
      async decodeAudioData() {
        return { duration: 1, length: 2, numberOfChannels: 1, getChannelData: () => [1, -1] };
      }
    },
  };
  return { api, run: () => vm.runInNewContext(reader + "(" + JSON.stringify(id) + ",signal)", browser) };
}

it("resolve o ID curto na conversa e devolve o buffer PCM para o Electron", async () => {
  const { api, run } = page();
  const result = await run();
  expect(api.downloadMedia).toHaveBeenCalledWith("false_chat_ABCDEF0123456789");
  expect(result.pcm).toBeInstanceOf(ArrayBuffer);
  expect(Array.from(new Int16Array(result.pcm))).toEqual([32767, -32767]);
});

it("descarta um download pendente antes da decodificação quando a sessão é ocultada", async () => {
  const controller = new AbortController();
  const { api, run } = page(false, controller.signal);
  const blob = new Blob(["audio"]);
  const readBytes = vi.spyOn(blob, "arrayBuffer");
  let finish!: (blob: Blob) => void;
  api.downloadMedia.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = run();
  await vi.waitFor(() => expect(api.downloadMedia).toHaveBeenCalledOnce());
  controller.abort();
  finish(blob);
  expect(await pending).toEqual({ error: "gone" });
  expect(readBytes).not.toHaveBeenCalled();
});

it("ignora mensagens de reprodução única antes de carregar a mídia", async () => {
  const { api, run } = page(true);
  expect(await run()).toEqual({ error: "skip" });
  expect(api.downloadMedia).not.toHaveBeenCalled();
});
