const fields = ["baseUrl", "tenantId"];
const statusEl = document.getElementById("status");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || "";
}

chrome.storage.local.get(fields).then((c) => {
  for (const f of fields) document.getElementById(f).value = c[f] || "";
});

function readForm() {
  const data = {};
  for (const f of fields) data[f] = document.getElementById(f).value.trim();
  data.baseUrl = data.baseUrl.replace(/\/+$/, "");
  return data;
}

function validate(data) {
  try {
    const url = new URL(data.baseUrl);
    const allowed = new Set(["https://app.adragencia.com.br", "http://localhost:3000"]);
    if (!allowed.has(url.origin) || (url.pathname !== "/" && url.pathname !== "")) {
      return "Use https://app.adragencia.com.br ou http://localhost:3000.";
    }
    data.baseUrl = url.origin;
  } catch {
    return "URL do CRM inválida.";
  }
  if (data.tenantId && !/^[a-zA-Z0-9_-]{1,80}$/.test(data.tenantId)) {
    return "Tenant inválido.";
  }
  return null;
}

async function persist() {
  const data = readForm();
  const error = validate(data);
  if (error) {
    setStatus(error, "err");
    return null;
  }
  await chrome.storage.local.set(data);
  await chrome.storage.local.remove("token");
  return data;
}

document.getElementById("save").onclick = async () => {
  const data = await persist();
  if (data) setStatus("Salvo. Recarregue a aba do WhatsApp Web.", "ok");
};

document.getElementById("test").onclick = async () => {
  const data = await persist();
  if (!data) return;
  setStatus("Testando…", "");
  chrome.runtime.sendMessage({ type: "ping" }, (res) => {
    if (chrome.runtime.lastError) return setStatus(chrome.runtime.lastError.message, "err");
    if (res?.ok) setStatus(`✓ ${res.data.message}`, "ok");
    else setStatus(`✗ ${res?.error || "Falha na conexão."}`, "err");
  });
};
