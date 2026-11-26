(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const getShell = () => window.adrShell;
  const ui = {
    tab: "overview",
    snapshot: null,
    preview: null,
    runs: [],
    historyOffset: 0,
    historyHasMore: false,
    selected: new Set(),
    busy: false,
    operation: null,
    activeRunId: null,
    loaded: false,
    restorePromptOpen: false,
  };
  const tabs = [...document.querySelectorAll("[data-performance-tab]")];
  const text = (value, fallback = "—") =>
    value === null || value === undefined || value === "" ? fallback : String(value);
  const element = (tag, className, content) => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (content !== undefined) result.textContent = text(content, "");
    return result;
  };
  const safeArray = (value) => (Array.isArray(value) ? value : []);
  const items = () => [
    ...safeArray(ui.snapshot?.recommendations),
    ...safeArray(ui.snapshot?.cleanup),
  ];
  const selectedItems = () => items().filter((item) => ui.selected.has(item.id));
  const date = (value) => {
    if (!value) return "Data indisponível";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? "Data indisponível"
      : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(parsed);
  };
  const bytes = (value) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) return null;
    const amount = Number(value);
    if (amount < 1024) return `${amount} B`;
    const unit = amount < 1024 ** 2 ? "KB" : amount < 1024 ** 3 ? "MB" : "GB";
    const divisor = unit === "KB" ? 1024 : unit === "MB" ? 1024 ** 2 : 1024 ** 3;
    return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(amount / divisor)} ${unit}`;
  };
  const percent = (part, total) =>
    Number.isFinite(part) && Number.isFinite(total) && total > 0
      ? Math.max(0, Math.min(100, Math.round((part / total) * 100))) : null;
  const metric = (title, value, detail, usage = null, tone = "normal") => {
    const card = element("article", "performance-metric");
    card.dataset.tone = tone;
    card.append(element("span", "meta", title), element("strong", "", value));
    if (usage !== null) {
      const track = element("div", "performance-meter");
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", title);
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(usage));
      const fill = element("span");
      fill.style.width = `${usage}%`;
      track.appendChild(fill);
      card.appendChild(track);
    }
    card.appendChild(element("small", "meta", detail));
    return card;
  };
  const categoryLabel = { workspace: "Workspace", startup: "Inicialização", power: "Energia", cleanup: "Limpeza" };
  const runStatusLabel = {
    pending: "Pendente", running: "Em andamento", completed: "Concluída", partial: "Resultado parcial",
    failed: "Falhou", cancelled: "Cancelada", interrupted: "Interrompida", restored: "Restaurada",
  };
  const actionStatusLabel = {
    pending: "Pendente", running: "Em andamento", completed: "Concluída", partial: "Resultado parcial",
    failed: "Falhou", cancelled: "Cancelada", interrupted: "Verificação pendente",
    restoring: "Restaurando", restored: "Restaurada",
  };
  const status = (message, tone = "neutral") => {
    const target = byId("performance-status");
    target.textContent = message;
    target.dataset.feedback = tone;
  };
  const errorText = (error) => text(error?.message || error, "Não foi possível concluir a operação.");

  // Keep IPC details here so the view does not depend on the implementation of the native service.
  const api = {
    analyze: () => getShell().optimizerAnalyze(),
    snapshot: () => getShell().optimizerGetSnapshot(),
    preview: (ids) => getShell().optimizerPreview(ids),
    apply: (id, confirmed) => getShell().optimizerApply(id, confirmed),
    cancel: (id) => getShell().optimizerCancel(id),
    history: (offset) => getShell().optimizerHistory(offset),
    restore: (runId, actionId) => getShell().optimizerRestore(runId, actionId),
    export: () => getShell().optimizerExportReport(),
    openSettings: (section) => getShell().optimizerOpenWindowsSettings(section),
  };

  function setBusy(value, runId = null) {
    ui.busy = value;
    if (!value) ui.operation = null;
    ui.activeRunId = value ? runId : null;
    byId("performance-analyze").disabled = value;
    byId("performance-export").disabled = value;
    byId("performance-preview-button").disabled = value || selectedItems().length === 0;
    const hasActions = safeArray(ui.preview?.actions).length > 0;
    const needsCleanupConfirmation = !byId("performance-cleanup-confirm-row").hidden;
    byId("performance-apply").disabled =
      value || !hasActions || (needsCleanupConfirmation && !byId("performance-cleanup-confirm").checked);
    const cancel = byId("performance-cancel");
    cancel.hidden = !value || !runId;
    cancel.disabled = !runId;
    for (const checkbox of document.querySelectorAll("[data-performance-choice]"))
      checkbox.disabled = value || checkbox.dataset.available !== "true";
  }

  function setSection(name, focus = false) {
    ui.tab = name;
    for (const tab of tabs) {
      const active = tab.dataset.performanceTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      byId(tab.getAttribute("aria-controls")).hidden = !active;
      if (active && focus) tab.focus();
    }
    byId("performance-selection").hidden = !["recommendations", "cleanup"].includes(name) || !ui.snapshot;
    byId("performance-preview").hidden = !ui.preview || !["recommendations", "cleanup"].includes(name);
    if (name === "history") void refreshHistory();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setSection(tab.dataset.performanceTab));
    tab.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      setSection(tabs[next].dataset.performanceTab, true);
    });
  });

  function notice(message, className = "") {
    return element("p", `performance-notice ${className}`, message);
  }
  function appendWarnings(target, warnings) {
    for (const warning of safeArray(warnings)) target.appendChild(notice(text(warning), "warning"));
  }
  function labelValue(label, value) {
    const card = element("div", "performance-fact");
    card.append(element("span", "meta", label), element("strong", "", value));
    return card;
  }
  function appendWindowsSettings(target) {
    if (!navigator.platform.toLowerCase().includes("win")) return;
    const windows = element("div", "performance-windows-settings");
    windows.appendChild(element("h3", "", "Configurações do Windows"));
    windows.appendChild(element("p", "meta", "Estes atalhos abrem as configurações nativas para você decidir. Os ajustes da Central só são aplicados após revisar a prévia."));
    for (const [label, section] of [
      ["Apps na inicialização", "startup"], ["Recomendações de armazenamento", "storage"],
      ["Energia e suspensão", "power"], ["Apps instalados e segundo plano", "apps"],
      ["Notificações", "notifications"], ["Preferências gráficas", "graphics"],
    ]) {
      const button = element("button", "btn", label);
      button.type = "button";
      button.addEventListener("click", async () => {
        try {
          await api.openSettings(section);
          status("Configurações do Windows abertas. Escolha o ajuste na janela do sistema.");
        } catch (error) {
          status(`Configuração indisponível: ${errorText(error)}`, "error");
        }
      });
      windows.appendChild(button);
    }
    target.appendChild(windows);
  }
  function renderOverview() {
    const target = byId("performance-overview");
    target.replaceChildren();
    const snapshot = ui.snapshot;
    if (!snapshot) {
      target.appendChild(notice("Nenhuma análise disponível. Selecione “Analisar agora” para começar."));
      appendWindowsSettings(target);
      return;
    }
    const heading = element("div", "performance-summary");
    heading.append(
      element("h3", "", "Última análise"),
      element("p", "meta", date(snapshot.createdAt)),
    );
    target.appendChild(heading);
    if (snapshot.incomplete) {
      target.appendChild(notice("Análise incompleta. Alguns dados ou verificações não estavam disponíveis; revise os avisos antes de agir.", "warning"));
    }
    appendWarnings(target, snapshot.warnings);
    const facts = element("div", "performance-facts");
    const overview = snapshot.overview || {};
    const ramPercent = percent(overview.memoryUsedBytes, overview.memoryTotalBytes);
    const diskUsedPercent = percent(
      overview.diskTotalBytes - overview.diskFreeBytes, overview.diskTotalBytes);
    const appRamPercent = percent(overview.appMemoryBytes, overview.memoryTotalBytes);
    const summary = element("div", "performance-metrics");
    summary.append(
      metric("RAM ocupada na última análise", ramPercent === null ? "Indisponível" : `${ramPercent}%`,
        ramPercent === null ? "Não foi possível medir a memória do computador." :
          `${bytes(overview.memoryUsedBytes)} de ${bytes(overview.memoryTotalBytes)} · ${bytes(Math.max(0, overview.memoryTotalBytes - overview.memoryUsedBytes))} livres na coleta`,
        ramPercent, ramPercent !== null && ramPercent >= 85 ? "high" : "normal"),
      metric("BiraWorkspace", bytes(overview.appMemoryBytes) || "Indisponível",
        appRamPercent === null ? "Uso do aplicativo não medido." :
          `${appRamPercent}% da RAM física · processos compartilhados contados uma vez`,
        appRamPercent),
      metric("CPU média · 15 segundos", Number.isFinite(overview.cpuPercent) ? `${overview.cpuPercent}%` : "Indisponível",
        `${overview.cpuHighSeconds ?? 0} s acima de 80% durante a coleta`,
        Number.isFinite(overview.cpuPercent) ? Math.max(0, Math.min(100, overview.cpuPercent)) : null,
        overview.cpuHighSeconds >= 10 ? "high" : "normal"),
      metric("Disco do perfil", bytes(overview.diskFreeBytes) || "Indisponível",
        Number.isFinite(overview.diskTotalBytes) ? `${bytes(overview.diskTotalBytes)} no total · espaço livre` : "Unidade não medida.",
        diskUsedPercent,
        diskUsedPercent !== null && (diskUsedPercent >= 90 || overview.diskFreeBytes < 10 * 1024 ** 3) ? "high" : "normal"),
    );
    target.appendChild(summary);
    const age = Date.now() - new Date(snapshot.createdAt).getTime();
    if (Number.isFinite(age) && age > 15 * 60_000)
      target.appendChild(notice("Esta medição tem mais de 15 minutos. Analise novamente antes de decidir.", "warning"));
    if (overview.memoryHighSeconds >= 10)
      target.appendChild(notice(`RAM acima de 85% por ${overview.memoryHighSeconds} segundos consecutivos. Reveja os serviços carregados.` , "warning"));
    const known = [
      ["Apps na inicialização", overview.startupCount ?? "Indisponível"],
      ["Plano de energia ativo", overview.activePowerScheme ?? "Indisponível"],
      ["Alimentação", overview.onBattery === true ? "Bateria" : overview.onBattery === false ? "Tomada" : "Indisponível"],
      ["Carga da bateria", Number.isFinite(overview.batteryPercent) ? `${overview.batteryPercent}%` : "Indisponível"],
      ["Serviços carregados no Workspace", overview.workspace?.loadedServices ?? "Indisponível"],
      ["Processos compartilhados entre serviços", overview.workspace?.sharedRendererProcesses ?? "Indisponível"],
      ["Serviços mantidos em memória", overview.workspace?.maxLoadedViews ?? "Indisponível"],
    ];
    for (const [label, value] of known) if (value !== undefined && value !== null && value !== "") facts.appendChild(labelValue(label, value));
    if (facts.childElementCount) target.appendChild(facts);
    if (overview.workspace?.sharedRendererProcesses > 0)
      target.appendChild(notice("Serviços que usam o mesmo processo foram contados uma vez na memória do Workspace."));
    const actionable = safeArray(snapshot.recommendations).filter((item) => item.status === "available");
    const guidance = [...safeArray(snapshot.recommendations), ...safeArray(snapshot.cleanup)]
      .filter((item) => item.id?.startsWith("guidance:"));
    const improvement = element("section", "performance-improvements");
    improvement.appendChild(element("h3", "", "O que pode melhorar"));
    improvement.appendChild(element("p", "meta", `${actionable.length} ajustes disponíveis · ${guidance.length} orientações · ${safeArray(snapshot.cleanup).length} opções de limpeza. Nada será alterado sem sua escolha.`));
    const priority = [
      ...[...safeArray(snapshot.recommendations), ...safeArray(snapshot.cleanup)]
        .filter((item) => ["guidance:memory", "guidance:cpu", "guidance:disk"].includes(item.id)),
      ...actionable,
      ...safeArray(snapshot.cleanup).filter((item) => item.status === "available"),
      ...guidance.filter((item) => !["guidance:memory", "guidance:cpu"].includes(item.id)),
    ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 5);
    if (!priority.length) improvement.appendChild(notice("Nenhum ajuste recomendado nesta medição."));
    for (const item of priority) {
      const row = element("div", "performance-improvement");
      row.append(element("strong", "", item.title), element("span", "meta", item.evidence?.[0] || item.reason || item.description));
      improvement.appendChild(row);
    }
    target.appendChild(improvement);
    target.appendChild(notice(`Coleta de 15 segundos concluída em ${date(overview.sampledAt)}. Uso de memória e CPU pode mudar após esta amostra.`));
    const next = element("div", "performance-next");
    for (const [label, section] of [["Ver recomendações", "recommendations"], ["Ver limpeza", "cleanup"]]) {
      const button = element("button", "btn", label);
      button.type = "button";
      button.addEventListener("click", () => setSection(section, true));
      next.appendChild(button);
    }
    target.appendChild(next);
    appendWindowsSettings(target);
  }

  function itemCard(item, cleanup) {
    const card = element("div", "performance-item");
    const input = element("input");
    input.type = "checkbox";
    input.dataset.performanceChoice = item.id;
    input.dataset.available = String(item.status === "available");
    input.checked = ui.selected.has(item.id);
    input.disabled = ui.busy || item.status !== "available";
    const label = element("label", "performance-item-label");
    label.appendChild(input);
    const copy = element("span", "performance-item-copy");
    copy.appendChild(element("strong", "", item.title));
    copy.appendChild(element("span", "meta", item.description));
    label.appendChild(copy);
    card.appendChild(label);
    const meta = element("div", "performance-item-meta");
    const guidance = item.executor === "none" && item.id?.startsWith("guidance:");
    const tags = [
      categoryLabel[item.category] || item.category,
      item.requiresAdmin ? "Requer administrador" : null,
      guidance ? "Orientação para o Windows" : cleanup || item.reversible === false ? "Não reversível" : "Pode ser restaurado",
      item.requiresRestart ? "Efeito no próximo início" : null,
      bytes(item.estimatedBytes),
      item.status === "unavailable" && !guidance ? "Indisponível" : item.status === "applied" ? "Sem ajuste necessário" : null,
    ].filter(Boolean);
    for (const tag of tags) meta.appendChild(element("span", "performance-tag", tag));
    card.appendChild(meta);
    if (safeArray(item.evidence).length) {
      const evidence = element("p", "meta", `Evidência: ${item.evidence.join("; ")}`);
      card.appendChild(evidence);
    }
    if (item.proposedChange) card.appendChild(element("p", "meta", `Mudança proposta: ${item.proposedChange}`));
    if (item.status === "unavailable") card.appendChild(notice(item.reason || "Indisponível neste computador.", guidance ? "" : "warning"));
    if (item.status === "applied") card.appendChild(notice(item.id === "workspace:hibernate" ? "Nenhuma aba inativa está elegível agora." : "O ajuste recomendado já está em uso."));
    input.addEventListener("change", () => {
      if (input.checked) ui.selected.add(item.id);
      else ui.selected.delete(item.id);
      clearPreview();
      updateSelection();
    });
    return card;
  }
  function renderChoices() {
    for (const [name, cleanup] of [["recommendations", false], ["cleanup", true]]) {
      const target = byId(`performance-${name}`);
      target.replaceChildren();
      const list = safeArray(ui.snapshot?.[name]);
      if (!ui.snapshot) {
        target.appendChild(notice("Faça uma análise para ver as opções disponíveis."));
      } else if (!list.length) {
        target.appendChild(notice(cleanup ? "Nenhuma opção de limpeza encontrada." : "Nenhuma recomendação encontrada."));
      } else {
        for (const item of list) target.appendChild(itemCard(item, cleanup));
      }
    }
    updateSelection();
  }
  function updateSelection() {
    const count = selectedItems().length;
    byId("performance-selected-count").textContent =
      count ? `${count} ${count === 1 ? "ação selecionada" : "ações selecionadas"}` : "Nenhuma ação selecionada";
    byId("performance-preview-button").disabled = ui.busy || count === 0;
    byId("performance-selection").hidden = !["recommendations", "cleanup"].includes(ui.tab) || !ui.snapshot;
  }
  function clearPreview() {
    ui.preview = null;
    byId("performance-preview").hidden = true;
    byId("performance-cleanup-confirm").checked = false;
  }
  function renderPreview() {
    const preview = ui.preview;
    const target = byId("performance-preview-content");
    target.replaceChildren();
    if (!preview) return;
    appendWarnings(target, preview.warnings);
    const actions = safeArray(preview.actions);
    if (!actions.length) target.appendChild(notice("A prévia não contém alterações aplicáveis.", "warning"));
    for (const action of actions) {
      const row = element("div", "performance-preview-row");
      row.appendChild(element("strong", "", action.title || items().find((item) => item.id === action.id)?.title || action.id));
      if (action.description) row.appendChild(element("p", "meta", action.description));
      if (safeArray(action.evidence).length) row.appendChild(element("p", "meta", `Evidência: ${action.evidence.join("; ")}`));
      if (action.proposedChange) row.appendChild(element("p", "meta", `Mudança: ${action.proposedChange}`));
      const before = action.category === "power" ? ui.snapshot?.overview?.activePowerScheme
        : action.id === "workspace:max-views" ? ui.snapshot?.overview?.workspace?.maxLoadedViews : null;
      const after = action.category === "power" ? action.id.slice("power:".length)
        : action.id === "workspace:max-views" ? ui.snapshot?.overview?.workspace?.recommendedMaxLoadedViews : null;
      const details = [
        before !== null && before !== undefined && `Atual: ${before}`,
        after !== null && after !== undefined && `Após aplicar: ${after}`,
        action.scope && `Escopo: ${action.scope === "workspace" ? "Workspace" : action.scope === "user" ? "Usuário atual" : "Sistema"}`,
        action.requiresAdmin && "Requer administrador",
        action.requiresRestart && "O efeito aparece após reiniciar a sessão ou o computador",
        action.reversible === false && "Não há restauração automática desta ação",
      ].filter(Boolean);
      for (const detail of details) row.appendChild(element("p", "meta", detail));
      if (safeArray(action.preconditions).length)
        row.appendChild(element("p", "meta", `Condições: ${action.preconditions.join("; ")}`));
      target.appendChild(row);
    }
    const hasCleanup = actions.some((action) => action.category === "cleanup");
    byId("performance-cleanup-confirm-row").hidden = !hasCleanup;
    byId("performance-cleanup-confirm").checked = false;
    byId("performance-apply").disabled = ui.busy || !actions.length || hasCleanup;
    byId("performance-preview").hidden = false;
    byId("performance-preview").scrollIntoView({ block: "nearest", behavior: "smooth" });
    byId("performance-preview-title").focus?.();
  }

  async function refreshHistory(more = false) {
    try {
      const offset = more ? ui.historyOffset : 0;
      const page = safeArray(await api.history(offset));
      ui.runs = more ? [...ui.runs, ...page] : page;
      ui.historyOffset = offset + page.length;
      ui.historyHasMore = page.length === 50;
      renderHistory();
    } catch (error) {
      byId("performance-history").replaceChildren(notice(`Não foi possível carregar o histórico: ${errorText(error)}`, "error"));
    }
  }
  function renderHistory() {
    const target = byId("performance-history");
    target.replaceChildren();
    if (!ui.runs.length) {
      target.appendChild(notice("Ainda não há operações registradas."));
      return;
    }
    for (const run of ui.runs) {
      const card = element("article", "settings-card performance-run");
      const header = element("div", "performance-run-header");
      header.append(element("strong", "", date(run.createdAt)), element("span", "performance-tag", runStatusLabel[run.status] || "Estado indisponível"));
      card.appendChild(header);
      if (run.error) card.appendChild(notice(run.error, run.status === "failed" ? "error" : "warning"));
      for (const action of safeArray(run.actions)) {
        const row = element("div", "performance-run-action");
        const copy = element("div", "performance-item-copy");
        const detail = action.error || (["completed", "partial"].includes(action.status)
          ? action.category === "cleanup" ? `${action.result?.deleted ?? 0} arquivo(s) removido(s), ${bytes(action.result?.bytes) ?? "volume indisponível"}; ${action.result?.skipped ?? 0} ignorado(s), ${action.result?.pending ?? 0} pendente(s)` : action.id === "workspace:hibernate"
            ? `${action.result?.hibernated ?? 0} serviço(s) suspenso(s); ${action.result?.skipped ?? 0} preservado(s)` : "Ajuste aplicado"
          : actionStatusLabel[action.status] || "Estado indisponível");
        copy.append(element("strong", "", action.title || action.id), element("span", "meta", detail));
        row.appendChild(copy);
        if (action.reversible && ["completed", "interrupted"].includes(action.status) && !ui.busy) {
          const interrupted = action.status === "interrupted";
          const restore = element("button", "btn", interrupted ? "Conferir e restaurar" : "Restaurar");
          restore.type = "button";
          restore.setAttribute("aria-label", `${interrupted ? "Conferir o estado e restaurar" : "Restaurar"} ${action.title || action.id}`);
          restore.addEventListener("click", () => void restoreAction(run.id, action.id));
          row.appendChild(restore);
        }
        card.appendChild(row);
      }
      if (run.comparison?.before && run.comparison?.after) {
        const comparison = element("div", "performance-run-comparison");
        comparison.appendChild(element("strong", "", "Variação observada em nova medição de 15 segundos"));
        const before = run.comparison.before;
        const after = run.comparison.after;
        const deltas = [
          ["CPU média", before.cpuPercent, after.cpuPercent, (value) => `${value}%`],
          ["Memória usada", before.memoryUsedBytes, after.memoryUsedBytes, (value) => bytes(value)],
          ["Memória do Workspace", before.appMemoryBytes, after.appMemoryBytes, (value) => bytes(value)],
          ["Espaço livre no volume do perfil", before.diskFreeBytes, after.diskFreeBytes, (value) => bytes(value)],
        ];
        for (const [label, prior, current, format] of deltas) {
          if (!Number.isFinite(prior) || !Number.isFinite(current)) continue;
          comparison.appendChild(element("p", "meta", `${label}: ${format(prior)} → ${format(current)}. Variação ${current >= prior ? "+" : "−"}${format(Math.abs(current - prior))}.`));
        }
        comparison.appendChild(element("p", "meta", "Variação observada; não representa ganho causado pela ação."));
        appendWarnings(comparison, run.comparison.warnings);
        card.appendChild(comparison);
      }
      target.appendChild(card);
    }
    if (ui.historyHasMore) {
      const more = element("button", "btn", "Carregar mais operações");
      more.type = "button";
      more.addEventListener("click", () => void refreshHistory(true));
      target.appendChild(more);
    }
  }
  async function restoreAction(runId, actionId) {
    if (ui.busy || ui.restorePromptOpen) return;
    ui.restorePromptOpen = true;
    let answer;
    try {
      answer = await getShell().confirm("Restaurar o valor anterior desta ação?", "Restaurar", "Confira o resultado no histórico após a operação.");
    } catch (error) {
      status(`Não foi possível abrir a confirmação: ${errorText(error)}`, "error");
      return;
    } finally {
      ui.restorePromptOpen = false;
    }
    if (!answer?.ok || ui.busy) return;
    ui.operation = "restore";
    setBusy(true);
    renderHistory();
    status("Restaurando valor anterior…");
    try {
      await api.restore(runId, actionId);
      await refreshHistory();
      ui.snapshot = null;
      ui.selected.clear();
      clearPreview();
      renderOverview();
      renderChoices();
      status("Restauração concluída. Confira o resultado no histórico.", "success");
    } catch (error) {
      status(`Restauração não concluída: ${errorText(error)}`, "error");
    } finally {
      setBusy(false);
      renderHistory();
    }
  }

  async function analyze() {
    if (ui.busy) return;
    clearPreview();
    ui.snapshot = null;
    ui.selected.clear();
    renderOverview();
    renderChoices();
    ensureProgressSubscription();
    ui.operation = "analyze";
    setBusy(true, "analysis");
    status("Analisando o computador…");
    try {
      const snapshot = await api.analyze();
      ui.snapshot = snapshot;
      ui.selected.clear();
      renderOverview();
      renderChoices();
      status(snapshot?.incomplete ? "Análise incompleta. Veja os avisos na Visão geral." : "Análise concluída. Escolha as ações que deseja revisar.", snapshot?.incomplete ? "warning" : "success");
    } catch (error) {
      const cancelled = /cancelad/i.test(errorText(error));
      status(cancelled ? "Análise cancelada." : `Análise não concluída: ${errorText(error)}`, cancelled ? "warning" : "error");
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    if (ui.busy) return;
    const selected = selectedItems();
    if (!selected.length) return;
    ui.operation = "preview";
    setBusy(true);
    status("Preparando prévia…");
    try {
      ui.preview = await api.preview(selected.map((item) => item.id));
      renderPreview();
      status("Prévia pronta. Revise os efeitos antes de aplicar.");
    } catch (error) {
      clearPreview();
      status(`Prévia não disponível: ${errorText(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (ui.busy || !ui.preview) return;
    const irreversible = !byId("performance-cleanup-confirm-row").hidden;
    if (irreversible && !byId("performance-cleanup-confirm").checked) {
      status("Confirme a exclusão dos arquivos selecionados para continuar.", "warning");
      byId("performance-cleanup-confirm").focus();
      return;
    }
    const previewId = ui.preview.id;
    ensureProgressSubscription();
    ui.operation = "apply";
    setBusy(true);
    status("Aplicando alterações…");
    try {
      const run = await api.apply(previewId, irreversible);
      if (run?.id && ["running", "pending"].includes(run.status)) setBusy(true, run.id);
      clearPreview();
      ui.snapshot = null;
      ui.selected.clear();
      renderOverview();
      renderChoices();
      setSection("history", true);
      status(run?.status === "failed" ? "A operação falhou. Veja os detalhes no histórico." : run?.status === "interrupted" ? "Estado de uma ação requer verificação. Veja o histórico antes de repetir." : run?.status === "partial" ? "Resultado parcial. Veja os arquivos removidos e ignorados no histórico." : run?.status === "cancelled" ? "Operação cancelada. Veja o histórico." : "Operação registrada. Veja o resultado por ação no histórico.", run?.status === "failed" ? "error" : ["interrupted", "partial", "cancelled"].includes(run?.status) ? "warning" : "success");
    } catch (error) {
      status(`Alterações não aplicadas: ${errorText(error)}`, "error");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!ui.activeRunId) return;
    byId("performance-cancel").disabled = true;
    try {
      await api.cancel(ui.activeRunId);
      status("Cancelamento solicitado. Aguarde o estado final da operação.", "warning");
      if (ui.operation !== "analyze") await refreshHistory();
    } catch (error) {
      status(`Não foi possível cancelar: ${errorText(error)}`, "error");
      byId("performance-cancel").disabled = false;
    }
  }
  async function exportReport() {
    try {
      const report = await api.export();
      const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
      const link = element("a");
      link.href = url;
      link.download = `adr-desempenho-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      status("Relatório preparado para download.", "success");
    } catch (error) {
      status(`Relatório não disponível: ${errorText(error)}`, "error");
    }
  }
  async function load() {
    if (ui.loaded) return;
    if (!getShell()?.optimizerGetSnapshot) return;
    ui.loaded = true;
    ensureProgressSubscription();
    renderOverview();
    renderChoices();
    setBusy(false);
    try {
      ui.snapshot = await api.snapshot();
      renderOverview();
      renderChoices();
      if (ui.snapshot) status(ui.snapshot.incomplete ? "Última análise incompleta. Confira os avisos." : `Última análise: ${date(ui.snapshot.createdAt)}.` , ui.snapshot.incomplete ? "warning" : "neutral");
    } catch (error) {
      ui.loaded = false;
      status(`Não foi possível carregar a última análise: ${errorText(error)}`, "error");
    }
  }

  byId("open-performance").addEventListener("click", () => {
    document.querySelector('nav button[data-tab="desempenho"]').click();
  });
  document.querySelector('nav button[data-tab="desempenho"]').addEventListener("click", () => void load());
  byId("performance-analyze").addEventListener("click", () => void analyze());
  byId("performance-preview-button").addEventListener("click", () => void preview());
  byId("performance-apply").addEventListener("click", () => void apply());
  byId("performance-back").addEventListener("click", () => {
    clearPreview();
    byId("performance-preview-button").focus();
  });
  byId("performance-cancel").addEventListener("click", () => void cancel());
  byId("performance-export").addEventListener("click", () => void exportReport());
  byId("performance-cleanup-confirm").addEventListener("change", (event) => {
    byId("performance-apply").disabled = !event.target.checked || ui.busy;
  });
  let progressSubscribed = false;
  function ensureProgressSubscription() {
    if (progressSubscribed || !getShell()?.onOptimizerProgress) return;
    progressSubscribed = true;
    getShell().onOptimizerProgress((progress) => {
      if (!ui.busy) return;
      if (ui.operation === "analyze") {
        if (progress?.runId !== "analysis") return;
        status(progress.message || (progress.status === "cancelled" ? "Análise cancelada." : "Coletando amostras da CPU…"), progress.status === "cancelled" ? "warning" : "neutral");
        if (progress.status === "cancelled") byId("performance-cancel").disabled = true;
        return;
      }
      if (ui.operation !== "apply") return;
      const terminal = ["completed", "partial", "failed", "cancelled", "interrupted", "restored"].includes(progress?.status) && !progress?.actionId;
      if (progress?.runId) setBusy(true, terminal ? null : progress.runId);
      const title = ui.preview?.actions?.find((action) => action.id === progress?.actionId)?.title;
      status(progress?.message || (title
        ? `${title}: ${actionStatusLabel[progress.status] || "em andamento"}.`
        : `Operação: ${runStatusLabel[progress?.status] || "em andamento"}.`));
      if (ui.tab === "history") void refreshHistory();
    });
  }
  void load();
})();
