import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { newContactUrl, toE164, READ_WHATSAPP_CONTACT } from "./google-contacts.js";

describe("contato da conversa ativa", () => {
  const read = (jid:string, pn?:string, next=jid) => {
    let first=true;
    return vm.runInNewContext(READ_WHATSAPP_CONTACT, {window:{WPP:{
      chat:{getActiveChat:async()=>{const id=first?jid:next;first=false;return {id:{_serialized:id},contact:{name:"Ana & Cia"}};}},
      contact:{getPnLidEntry:async()=>({phoneNumber:{_serialized:pn}})}
    }}});
  };
  it("preenche o número público de uma conversa e resolve um LID", async()=>{
    for (const jid of ["12025550123@c.us","987654321@lid"]) {
      const c=await read(jid,"12025550123@c.us");
      const form=new URL(newContactUrl(c.name,toE164(c.phone),"teste@example.com"));
      expect(form.searchParams.get("phone")).toBe("+12025550123");
      expect(form.searchParams.get("givenname")).toBe("Ana & Cia");
    }
  });
  it("rejeita grupo, lista, canal, LID sem número e troca de conversa",async()=>{
    for(const jid of ["123@g.us","status@broadcast","123@newsletter","987654321@lid"]) expect(await read(jid)).toBeNull();
    expect(await read("12025550123@c.us",undefined,"12025550124@c.us")).toBeNull();
  });
});

describe("formulário de novo contato do Google", () => {
  it("preenche nome e telefone na conta escolhida", () => {
    // Grafias medidas no navegador: só `givenname` e `phone` funcionam.
    const url = new URL(newContactUrl("Ana Mosconi", "+5511999998888", "eu@gmail.com"));
    expect(url.origin + url.pathname).toBe("https://contacts.google.com/new");
    expect(url.searchParams.get("givenname")).toBe("Ana Mosconi");
    expect(url.searchParams.get("phone")).toBe("+5511999998888");
    expect(url.searchParams.get("authuser")).toBe("eu@gmail.com");
  });

  it("omite o que não existe em vez de mandar vazio", () => {
    // Contato fora da agenda não tem nome, e conta não configurada abre na
    // conta padrão do navegador.
    const url = new URL(newContactUrl(null, "+5511999998888"));
    expect(url.searchParams.has("givenname")).toBe(false);
    expect(url.searchParams.has("authuser")).toBe(false);
    expect(url.searchParams.get("phone")).toBe("+5511999998888");
  });

  it("converte o telefone do WhatsApp para E.164", () => {
    expect(toE164("5511999998888")).toBe("+5511999998888");
    expect(toE164("")).toBe("");
  });
});
