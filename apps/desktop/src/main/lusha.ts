/**
 * Keep LinkedIn input narrow. The Workspace may use a LinkedIn URL as an
 * identifier for Lusha, but it must never turn this into a page scraper.
 */
export function normalizeLinkedInProfileUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "www.linkedin.com" && url.hostname !== "linkedin.com") return null;
    if (!/^\/in\/[A-Za-z0-9][^/?#]*\/?$/i.test(url.pathname)) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatRevealableField(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const object = record(value);
  if (!object) return null;
  const field = ["field", "name", "key", "type"]
    .map((key) => object[key])
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
  if (!field) return null;
  const credits = typeof object["credits"] === "number" && Number.isFinite(object["credits"])
    ? object["credits"]
    : null;
  if (credits === null) return field.trim();
  return `${field.trim()} (${credits} crédito${credits === 1 ? "" : "s"})`;
}

function looksLikeContact(value: Record<string, unknown>): boolean {
  return Boolean(
    readContactId(value) &&
    [
      "fullName",
      "firstName",
      "lastName",
      "jobTitle",
      "company",
      "companyName",
      "linkedinUrl",
      "socialLinks",
      "has",
      "canReveal",
      "emails",
      "phones",
    ].some((key) => key in value),
  );
}

function findFirstRecord(value: unknown): Record<string, unknown> | null {
  const object = record(value);
  if (object) {
    if (looksLikeContact(object)) return object;
    // Prefer provider collection keys so a requestId on the response envelope
    // cannot be mistaken for the contact identifier.
    const preferred = ["data", "contacts", "results", "items"];
    for (const key of preferred) {
      const found = findFirstRecord(object[key]);
      if (found) return found;
    }
    for (const [key, child] of Object.entries(object)) {
      if (preferred.includes(key)) continue;
      const found = findFirstRecord(child);
      if (found) return found;
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const found = findFirstRecord(child);
      if (found) return found;
    }
  }
  return null;
}

function readContactId(contact: Record<string, unknown>): string | null {
  for (const key of ["id", "contactId", "person_id", "personId"]) {
    const value = contact[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function summarizeLushaContact(value: unknown): string {
  const contact = findFirstRecord(value);
  if (!contact) return "Nenhum contato encontrado.";
  const lines: string[] = [];
  const first = contact["firstName"];
  const last = contact["lastName"];
  const fullName = contact["fullName"] || [first, last].filter(Boolean).join(" ");
  if (typeof fullName === "string" && fullName.trim()) lines.push(`Nome: ${fullName.trim()}`);
  for (const [label, keys] of [
    ["Cargo", ["jobTitle", "title"]],
    ["Empresa", ["companyName"]],
    ["LinkedIn", ["linkedinUrl"]],
  ] as const) {
    const valueForLabel = keys.map((key) => contact[key]).find((item) => typeof item === "string");
    if (typeof valueForLabel === "string" && valueForLabel.trim()) {
      lines.push(`${label}: ${valueForLabel.trim()}`);
    }
  }
  const has = contact["has"];
  if (Array.isArray(has) && has.length) lines.push(`Disponível para revelar: ${has.join(", ")}`);
  const canReveal = contact["canReveal"];
  if (Array.isArray(canReveal)) {
    const revealable = canReveal.map(formatRevealableField).filter((item): item is string => Boolean(item));
    if (revealable.length) lines.push(`Revelável: ${revealable.join(", ")}`);
  }
  const emails = contact["emails"];
  if (Array.isArray(emails)) {
    const values = emails
      .map((item) => record(item)?.["email"] || item)
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (values.length) lines.push(`E-mail: ${values.join(", ")}`);
  }
  const phones = contact["phones"];
  if (Array.isArray(phones)) {
    const values = phones
      .map((item) => record(item)?.["number"] || item)
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (values.length) lines.push(`Telefone: ${values.join(", ")}`);
  }
  return lines.length ? lines.join("\n") : "Contato localizado, sem campos de preview legíveis.";
}

export interface LushaContactCardData {
  fullName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  linkedinUrl: string | null;
  emails: string[];
  phones: string[];
  canRevealSummary: string | null;
  hasContactId: boolean;
}

export function parseLushaContact(value: unknown): LushaContactCardData | null {
  const contact = findFirstRecord(value);
  if (!contact) return null;
  const first = contact["firstName"];
  const last = contact["lastName"];
  const rawFullName = contact["fullName"];
  const fullName =
    typeof rawFullName === "string" && rawFullName.trim()
      ? rawFullName.trim()
      : [first, last]
          .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          .join(" ")
          .trim() || null;

  const jobTitle =
    ["jobTitle", "title"]
      .map((k) => contact[k])
      .find((v): v is string => typeof v === "string" && v.trim().length > 0)
      ?.trim() || null;

  const companyName =
    typeof contact["companyName"] === "string" && contact["companyName"].trim()
      ? contact["companyName"].trim()
      : null;
  const linkedinUrl =
    typeof contact["linkedinUrl"] === "string" && contact["linkedinUrl"].trim()
      ? contact["linkedinUrl"].trim()
      : null;

  const emails: string[] = [];
  if (Array.isArray(contact["emails"])) {
    for (const item of contact["emails"]) {
      const email = record(item)?.["email"] || item;
      if (typeof email === "string" && email.trim()) emails.push(email.trim());
    }
  }

  const phones: string[] = [];
  if (Array.isArray(contact["phones"])) {
    for (const item of contact["phones"]) {
      const num = record(item)?.["number"] || item;
      if (typeof num === "string" && num.trim()) phones.push(num.trim());
    }
  }

  const canRevealParts: string[] = [];
  if (Array.isArray(contact["canReveal"])) {
    const fields = contact["canReveal"].map(formatRevealableField).filter((item): item is string => Boolean(item));
    if (fields.length) canRevealParts.push(fields.join(", "));
  } else if (Array.isArray(contact["has"]) && contact["has"].length) {
    canRevealParts.push(contact["has"].join(", "));
  }

  return {
    fullName,
    jobTitle,
    companyName,
    linkedinUrl,
    emails,
    phones,
    canRevealSummary: canRevealParts.length ? canRevealParts.join("; ") : null,
    hasContactId: Boolean(readContactId(contact)),
  };
}

/** Mundo JS isolado do card da Lusha (1..536870911; 0 é a página, 999 o do contextIsolation). */
export const LUSHA_WORLD_ID = 1031;

export function buildLushaCardScript(
  mode: "preview" | "revealed" | "message",
  payload: {
    title?: string;
    message?: string;
    fullName?: string | null;
    jobTitle?: string | null;
    companyName?: string | null;
    linkedinUrl?: string | null;
    emails?: string[];
    phones?: string[];
    canRevealSummary?: string | null;
    hasContactId?: boolean;
  },
): string {
  const modeJson = JSON.stringify(mode);
  const dataJson = JSON.stringify(payload);
  // ponytail: Shadow DOM card in active browser view replaces native OS dialogs.
  return `(() => {
  return new Promise((resolve) => {
    // Roda num mundo isolado (LUSHA_WORLD_ID): a página não vê esta variável, e o
    // shadow FECHADO não deixa script do LinkedIn achar os botões (clicar
    // "Revelar" gasta crédito) nem ler o e-mail e o telefone revelados.
    // Card anterior ainda aberto (segundo clique): encerra a promessa dele e o Esc
    // dele, senão ela ficava pendurada e o Esc velho fechava este card.
    if (window.__adrLushaDismiss) window.__adrLushaDismiss(true);
    let shadow = window.__adrLushaShadow;
    let host = shadow && shadow.host;
    if (!shadow || !host.isConnected) {
      host = document.createElement("div");
      host.id = "adr-lusha-host";
      (document.body || document.documentElement).appendChild(host);
      shadow = host.attachShadow({ mode: "closed" });
      window.__adrLushaShadow = shadow;
    }
    shadow.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = [
      ":host { all: initial; }",
      "* { box-sizing: border-box; }",
      ".card {",
      "  position: fixed;",
      "  top: 16px;",
      "  right: 16px;",
      "  width: 360px;",
      "  max-width: calc(100vw - 32px);",
      "  background: #111c24;",
      "  border: 1px solid #2b3a45;",
      "  border-radius: 14px;",
      "  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05);",
      "  color: #ffffff;",
      "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
      "  font-size: 13px;",
      "  line-height: 1.4;",
      "  z-index: 2147483647;",
      "  overflow: hidden;",
      "  user-select: text;",
      "  animation: adrFadeIn 0.18s ease-out;",
      "}",
      "@keyframes adrFadeIn {",
      "  from { opacity: 0; transform: translateY(-8px); }",
      "  to { opacity: 1; transform: translateY(0); }",
      "}",
      ".header {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  padding: 10px 14px;",
      "  background: #18252f;",
      "  border-bottom: 1px solid #2b3a45;",
      "}",
      ".brand {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 6px;",
      "  font-weight: 700;",
      "  font-size: 12px;",
      "  letter-spacing: 0.3px;",
      "  color: #4da3ff;",
      "}",
      ".close-btn {",
      "  background: transparent;",
      "  border: none;",
      "  color: #94a3b8;",
      "  font-size: 18px;",
      "  line-height: 1;",
      "  cursor: pointer;",
      "  padding: 2px 6px;",
      "  border-radius: 6px;",
      "}",
      ".close-btn:hover { background: #2b3a45; color: #ffffff; }",
      ".body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }",
      ".name { font-size: 16px; font-weight: 700; color: #ffffff; word-break: break-word; }",
      ".subtitle { font-size: 12px; color: #94a3b8; margin-top: -6px; word-break: break-word; }",
      ".notice { font-size: 12px; color: #94a3b8; background: #0b141b; border: 1px solid #2b3a45; border-radius: 8px; padding: 8px 10px; word-break: break-word; }",
      ".fields { display: flex; flex-direction: column; gap: 6px; }",
      ".field-row {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  background: #0b141b;",
      "  border: 1px solid #2b3a45;",
      "  border-radius: 8px;",
      "  padding: 7px 10px;",
      "  gap: 8px;",
      "}",
      ".field-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }",
      ".field-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; font-weight: 600; }",
      ".field-value { font-size: 13px; color: #ffffff; word-break: break-all; user-select: text; }",
      ".copy-btn {",
      "  background: #18252f;",
      "  border: 1px solid #2b3a45;",
      "  color: #ffffff;",
      "  padding: 4px 8px;",
      "  border-radius: 6px;",
      "  font-size: 11px;",
      "  font-weight: 600;",
      "  cursor: pointer;",
      "  flex-shrink: 0;",
      "  transition: all 0.15s;",
      "}",
      ".copy-btn:hover { border-color: #4da3ff; color: #4da3ff; }",
      ".copy-btn.copied { border-color: #22c55e !important; color: #22c55e !important; background: rgba(34, 197, 94, 0.12) !important; }",
      ".actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }",
      ".btn-primary {",
      "  background: linear-gradient(90deg, #4da3ff, #6b8cff);",
      "  border: none;",
      "  color: #041018;",
      "  font-weight: 700;",
      "  font-size: 13px;",
      "  padding: 8px 14px;",
      "  border-radius: 8px;",
      "  cursor: pointer;",
      "}",
      ".btn-primary:hover { filter: brightness(1.08); }",
      ".btn-primary:disabled { opacity: 0.6; cursor: default; }",
      ".btn-secondary {",
      "  background: #18252f;",
      "  border: 1px solid #2b3a45;",
      "  color: #ffffff;",
      "  font-size: 13px;",
      "  padding: 7px 12px;",
      "  border-radius: 8px;",
      "  cursor: pointer;",
      "}",
      ".btn-secondary:hover { border-color: #94a3b8; }",
    ].join("\\n");
    shadow.appendChild(style);

    const MODE = ${modeJson};
    const DATA = ${dataJson};

    const card = document.createElement("div");
    card.className = "card";

    const header = document.createElement("div");
    header.className = "header";
    const brand = document.createElement("div");
    brand.className = "brand";
    brand.textContent = "Lusha · ADR Browser";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "close-btn";
    closeBtn.textContent = "×";
    closeBtn.title = "Fechar (Esc)";
    header.appendChild(brand);
    header.appendChild(closeBtn);
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "body";

    const onKeyDown = (e) => {
      if (e.key === "Escape") dismiss();
    };
    const dismiss = (replaced) => {
      if (window.__adrLushaDismiss === dismiss) window.__adrLushaDismiss = null;
      if (!replaced) host.remove();
      window.removeEventListener("keydown", onKeyDown);
      resolve("close");
    };
    window.__adrLushaDismiss = dismiss;
    closeBtn.onclick = () => dismiss();
    window.addEventListener("keydown", onKeyDown);

    function copyToClipboard(text, btn) {
      const finish = () => {
        btn.textContent = "Copiado!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copiar";
          btn.classList.remove("copied");
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(finish, () => fallbackCopy(text, finish));
      } else {
        fallbackCopy(text, finish);
      }
    }

    function fallbackCopy(text, callback) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      // Dentro do shadow root fechado: no DOM do LinkedIn, os scripts da página
      // leriam o e-mail/telefone revelado enquanto o textarea existe.
      (shadow || document.body || document.documentElement).appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      ta.remove();
      if (callback) callback();
    }

    function addField(label, value) {
      const row = document.createElement("div");
      row.className = "field-row";
      const info = document.createElement("div");
      info.className = "field-info";
      const lbl = document.createElement("span");
      lbl.className = "field-label";
      lbl.textContent = label;
      const val = document.createElement("span");
      val.className = "field-value";
      val.textContent = value;
      info.appendChild(lbl);
      info.appendChild(val);
      const cbtn = document.createElement("button");
      cbtn.type = "button";
      cbtn.className = "copy-btn";
      cbtn.textContent = "Copiar";
      cbtn.onclick = () => copyToClipboard(value, cbtn);
      row.appendChild(info);
      row.appendChild(cbtn);
      return row;
    }

    if (MODE === "message") {
      const titleEl = document.createElement("div");
      titleEl.className = "name";
      titleEl.textContent = DATA.title || "Lusha";
      const msgEl = document.createElement("div");
      msgEl.className = "notice";
      msgEl.textContent = DATA.message || "";
      body.appendChild(titleEl);
      body.appendChild(msgEl);
      const actions = document.createElement("div");
      actions.className = "actions";
      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "btn-secondary";
      okBtn.textContent = "Fechar";
      okBtn.onclick = () => dismiss();
      actions.appendChild(okBtn);
      body.appendChild(actions);
    } else if (MODE === "preview") {
      if (DATA.fullName) {
        const nameEl = document.createElement("div");
        nameEl.className = "name";
        nameEl.textContent = DATA.fullName;
        body.appendChild(nameEl);
      }
      const sub = [DATA.jobTitle, DATA.companyName].filter(Boolean).join(" • ");
      if (sub) {
        const subEl = document.createElement("div");
        subEl.className = "subtitle";
        subEl.textContent = sub;
        body.appendChild(subEl);
      }
      if (DATA.canRevealSummary) {
        const revEl = document.createElement("div");
        revEl.className = "notice";
        revEl.textContent = "Disponível para revelar: " + DATA.canRevealSummary;
        body.appendChild(revEl);
      }
      const note = document.createElement("div");
      note.className = "notice";
      note.textContent = "A próxima ação revela e-mail e telefone e pode consumir créditos da sua conta Lusha.";
      body.appendChild(note);

      const actions = document.createElement("div");
      actions.className = "actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn-secondary";
      cancelBtn.textContent = "Fechar";
      cancelBtn.onclick = () => dismiss();
      actions.appendChild(cancelBtn);

      if (DATA.hasContactId) {
        const revealBtn = document.createElement("button");
        revealBtn.type = "button";
        revealBtn.className = "btn-primary";
        revealBtn.textContent = "Revelar e-mail e telefone";
        revealBtn.onclick = (e) => {
          if (!e.isTrusted) return;
          revealBtn.disabled = true;
          revealBtn.textContent = "Revelando...";
          window.removeEventListener("keydown", onKeyDown);
          resolve("reveal");
        };
        actions.appendChild(revealBtn);
      }
      body.appendChild(actions);
    } else if (MODE === "revealed") {
      if (DATA.fullName) {
        const nameEl = document.createElement("div");
        nameEl.className = "name";
        nameEl.textContent = DATA.fullName;
        body.appendChild(nameEl);
      }
      const sub = [DATA.jobTitle, DATA.companyName].filter(Boolean).join(" • ");
      if (sub) {
        const subEl = document.createElement("div");
        subEl.className = "subtitle";
        subEl.textContent = sub;
        body.appendChild(subEl);
      }

      const fields = document.createElement("div");
      fields.className = "fields";

      if (DATA.fullName) {
        fields.appendChild(addField("Nome", DATA.fullName));
      }
      for (const email of (DATA.emails || [])) {
        fields.appendChild(addField("E-mail", email));
      }
      for (const phone of (DATA.phones || [])) {
        fields.appendChild(addField("Telefone", phone));
      }
      if (!DATA.emails?.length && !DATA.phones?.length) {
        const emptyMsg = document.createElement("div");
        emptyMsg.className = "notice";
        emptyMsg.textContent = "Nenhum e-mail ou telefone encontrado.";
        fields.appendChild(emptyMsg);
      }
      body.appendChild(fields);

      const actions = document.createElement("div");
      actions.className = "actions";

      const copyAllBtn = document.createElement("button");
      copyAllBtn.type = "button";
      copyAllBtn.className = "btn-secondary";
      copyAllBtn.textContent = "Copiar tudo";
      copyAllBtn.onclick = () => {
        const lines = [];
        if (DATA.fullName) lines.push("Nome: " + DATA.fullName);
        if (DATA.jobTitle) lines.push("Cargo: " + DATA.jobTitle);
        if (DATA.companyName) lines.push("Empresa: " + DATA.companyName);
        for (const e of (DATA.emails || [])) lines.push("E-mail: " + e);
        for (const p of (DATA.phones || [])) lines.push("Telefone: " + p);
        copyToClipboard(lines.join("\\n"), copyAllBtn);
      };
      actions.appendChild(copyAllBtn);

      const prepareBtn = document.createElement("button");
      prepareBtn.type = "button";
      prepareBtn.className = "btn-primary";
      prepareBtn.textContent = "Preparar negócio";
      prepareBtn.onclick = (e) => {
        if (!e.isTrusted) return;
        prepareBtn.disabled = true;
        prepareBtn.textContent = "Preparando...";
        window.removeEventListener("keydown", onKeyDown);
        resolve("prepareDeal");
      };
      actions.appendChild(prepareBtn);

      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "btn-secondary";
      okBtn.textContent = "Fechar";
      okBtn.onclick = () => dismiss();
      actions.appendChild(okBtn);

      body.appendChild(actions);
    }

    card.appendChild(body);
    shadow.appendChild(card);
  });
})()`;
}
