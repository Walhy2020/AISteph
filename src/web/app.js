const token = document.querySelector('meta[name="aisteph-token"]').content;
const version = document.querySelector('meta[name="aisteph-version"]').content;

const elements = {
  serviceStatus: document.querySelector("#service-status"),
  total: document.querySelector("#stat-total"),
  pending: document.querySelector("#stat-pending"),
  uptime: document.querySelector("#stat-uptime"),
  inbox: document.querySelector("#inbox-list"),
  template: document.querySelector("#inbox-card-template"),
  filter: document.querySelector("#type-filter"),
  refresh: document.querySelector("#refresh-button"),
  formMessage: document.querySelector("#form-message"),
  fileInput: document.querySelector("#file-input"),
  fileName: document.querySelector("#file-name"),
  recorderDevice: document.querySelector("#recorder-device"),
  refreshDevices: document.querySelector("#refresh-devices"),
  recorderTitle: document.querySelector("#recorder-title"),
  recorderStatus: document.querySelector("#recorder-status"),
  recorderStateLabel: document.querySelector("#recorder-state-label"),
  recorderDeviceLabel: document.querySelector("#recorder-device-label"),
  recorderDuration: document.querySelector("#recorder-duration"),
  startRecording: document.querySelector("#start-recording"),
  stopRecording: document.querySelector("#stop-recording")
};

const typeInfo = {
  text: { label: "文字记录", glyph: "字", className: "" },
  article_link: { label: "文章链接", glyph: "链", className: "article" },
  document: { label: "本地文件", glyph: "档", className: "document" },
  audio: { label: "录音", glyph: "声", className: "audio" }
};

let devicesLoaded = false;
let recorderRequestActive = false;
let recorderStatusRefreshing = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "X-AISteph-Token": token,
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({ error: "响应格式无效" }));
  if (response.status === 403) {
    window.location.reload();
    throw new Error("本地服务已重启，正在刷新访问令牌");
  }
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function setServiceStatus(online, label) {
  elements.serviceStatus.classList.toggle("online", online);
  elements.serviceStatus.classList.toggle("offline", !online);
  elements.serviceStatus.querySelector("span:last-child").textContent = label;
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}时${minutes}分`;
}

function formatTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function renderEmpty(message = "还没有待审核资料") {
  const container = document.createElement("div");
  container.className = "empty-state";
  const title = document.createElement("strong");
  title.textContent = message;
  const description = document.createElement("p");
  description.textContent = "从左侧收录文字、文章、文件或一段录音，它会出现在这里。";
  container.append(title, description);
  elements.inbox.replaceChildren(container);
}

function renderError(error) {
  const container = document.createElement("div");
  container.className = "error-state";
  const title = document.createElement("strong");
  title.textContent = "收件箱读取失败";
  const description = document.createElement("p");
  description.textContent = error.message;
  container.append(title, description);
  elements.inbox.replaceChildren(container);
}

function renderInbox(items) {
  if (!items.length) {
    renderEmpty(elements.filter.value ? "当前筛选没有资料" : undefined);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const info = typeInfo[item.type] ?? {
      label: item.type || "未知类型",
      glyph: "?",
      className: ""
    };
    const icon = card.querySelector(".type-icon");
    icon.textContent = info.glyph;
    if (info.className) icon.classList.add(info.className);
    card.querySelector(".type-label").textContent = info.label;
    card.querySelector(".captured-time").textContent = formatTime(item.capturedAt);
    card.querySelector("h3").textContent = item.title || "未命名资料";
    card.querySelector(".record-id").textContent = item.id;

    const sourceLink = card.querySelector(".source-link");
    const sourcePath = card.querySelector(".source-path");
    if (item.sourceUrl) {
      sourceLink.href = item.sourceUrl;
      sourceLink.textContent = item.sourceUrl;
      sourcePath.remove();
    } else {
      sourcePath.textContent = item.sourcePath || "原始路径未记录";
      sourceLink.remove();
    }
    fragment.append(card);
  }
  elements.inbox.replaceChildren(fragment);
}

async function refreshDashboard() {
  elements.refresh.disabled = true;
  try {
    const type = elements.filter.value;
    const query = new URLSearchParams({ status: "pending_review", limit: "100" });
    if (type) query.set("type", type);
    const [status, inbox] = await Promise.all([
      api("/api/status"),
      api(`/api/inbox?${query}`)
    ]);
    setServiceStatus(true, `本地服务在线 · v${status.version}`);
    elements.total.textContent = status.stats.total;
    elements.pending.textContent = status.stats.pendingReview;
    elements.uptime.textContent = formatUptime(status.uptimeSeconds);
    renderInbox(inbox.items);
  } catch (error) {
    setServiceStatus(false, "本地服务异常");
    renderError(error);
  } finally {
    elements.refresh.disabled = false;
  }
}

function showMessage(message, kind = "") {
  elements.formMessage.className = `form-message ${kind}`.trim();
  elements.formMessage.textContent = message;
}

async function submitForm(form, action) {
  const button = form.querySelector('button[type="submit"]');
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "正在保存…";
  showMessage("");
  try {
    const record = await action();
    showMessage(`已收录 ${record.id}，等待你在 Obsidian 中审核。`, "success");
    form.reset();
    elements.fileName.textContent = "选择一个本地文件";
    await refreshDashboard();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = [minutes, remainder].map((part) => String(part).padStart(2, "0"));
  if (hours > 0) parts.unshift(String(hours).padStart(2, "0"));
  return parts.join(":");
}

function renderRecorderStatus(status) {
  const state = status.state || "idle";
  const active = ["starting", "recording", "stopping"].includes(state);
  const stateLabels = {
    idle: "准备录音",
    starting: "正在启动麦克风",
    recording: "正在录音",
    stopping: "正在保存录音"
  };
  elements.recorderStatus.className = `recorder-status ${state}`;
  elements.recorderStateLabel.textContent = stateLabels[state] || "录音状态未知";
  elements.recorderDeviceLabel.textContent = status.deviceName
    || status.lastError
    || elements.recorderDevice.selectedOptions[0]?.textContent
    || "请选择麦克风";
  elements.recorderDuration.textContent = formatDuration(status.elapsedSeconds);
  elements.recorderDevice.disabled = active || recorderRequestActive;
  elements.recorderTitle.disabled = active || recorderRequestActive;
  elements.refreshDevices.disabled = active || recorderRequestActive;
  elements.startRecording.hidden = active;
  elements.stopRecording.hidden = !active;
  elements.startRecording.disabled = recorderRequestActive || !elements.recorderDevice.value;
  elements.stopRecording.disabled = recorderRequestActive || state === "stopping";
  if (state === "idle" && status.lastError) {
    elements.recorderStatus.classList.add("error");
    elements.recorderStateLabel.textContent = "上次录音失败";
  }
}

async function loadRecorderDevices() {
  const previous = elements.recorderDevice.value;
  elements.refreshDevices.disabled = true;
  elements.recorderDevice.disabled = true;
  try {
    const payload = await api("/api/recorder/devices");
    const fragment = document.createDocumentFragment();
    for (const device of payload.devices) {
      const option = document.createElement("option");
      option.value = device.name;
      option.textContent = device.name;
      fragment.append(option);
    }
    if (!payload.devices.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "未检测到可用麦克风";
      fragment.append(option);
    }
    elements.recorderDevice.replaceChildren(fragment);
    if (payload.devices.some((device) => device.name === previous)) {
      elements.recorderDevice.value = previous;
    }
    devicesLoaded = true;
    showMessage(
      payload.devices.length ? `已检测到 ${payload.devices.length} 个麦克风。` : "未检测到麦克风，请检查连接。",
      payload.devices.length ? "" : "error"
    );
  } catch (error) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "麦克风读取失败";
    elements.recorderDevice.replaceChildren(option);
    showMessage(error.message, "error");
  } finally {
    elements.refreshDevices.disabled = false;
    elements.recorderDevice.disabled = false;
    renderRecorderStatus({ state: "idle", lastError: null });
  }
}

async function refreshRecorderStatus() {
  if (recorderStatusRefreshing) return;
  recorderStatusRefreshing = true;
  try {
    renderRecorderStatus(await api("/api/recorder/status"));
  } catch (error) {
    elements.recorderStatus.className = "recorder-status error";
    elements.recorderStateLabel.textContent = "录音服务不可用";
    elements.recorderDeviceLabel.textContent = error.message;
  } finally {
    recorderStatusRefreshing = false;
  }
}
document.querySelectorAll(".capture-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const activeName = tab.dataset.tab;
    document.querySelectorAll(".capture-tab").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".capture-form").forEach((panel) => {
      const active = panel.dataset.panel === activeName;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    showMessage("");
    if (activeName === "audio") {
      if (!devicesLoaded) loadRecorderDevices();
      refreshRecorderStatus();
    }
  });
});

document.querySelector("#text-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  submitForm(event.currentTarget, async () => {
    const payload = await api("/api/intake/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.get("title"),
        text: data.get("text")
      })
    });
    return payload.record;
  });
});

document.querySelector("#link-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  submitForm(event.currentTarget, async () => {
    const payload = await api("/api/intake/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.get("title"),
        url: data.get("url")
      })
    });
    return payload.record;
  });
});

document.querySelector("#file-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const file = data.get("file");
  if (!(file instanceof File) || !file.name) {
    showMessage("请先选择一个本地文件。", "error");
    return;
  }
  submitForm(event.currentTarget, async () => {
    const query = new URLSearchParams({
      name: file.name,
      title: String(data.get("title") || "")
    });
    const payload = await api(`/api/intake/file?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file
    });
    return payload.record;
  });
});

elements.refreshDevices.addEventListener("click", loadRecorderDevices);
elements.recorderDevice.addEventListener("change", () => {
  renderRecorderStatus({ state: "idle", lastError: null });
});

elements.startRecording.addEventListener("click", async () => {
  if (!elements.recorderDevice.value) {
    showMessage("请先选择一个可用麦克风。", "error");
    return;
  }
  recorderRequestActive = true;
  elements.startRecording.disabled = true;
  showMessage("正在启动麦克风，请稍候…");
  try {
    const status = await api("/api/recorder/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceName: elements.recorderDevice.value,
        title: elements.recorderTitle.value
      })
    });
    renderRecorderStatus(status);
    showMessage("录音已开始。停止后会自动进入统一收件箱。", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    recorderRequestActive = false;
    await refreshRecorderStatus();
  }
});

elements.stopRecording.addEventListener("click", async () => {
  recorderRequestActive = true;
  elements.stopRecording.disabled = true;
  showMessage("正在停止并校验录音…");
  try {
    const payload = await api("/api/recorder/stop", { method: "POST" });
    showMessage(
      `已收录 ${payload.record.id}（${formatDuration(payload.record.durationSeconds)}），等待你在 Obsidian 中审核。`,
      "success"
    );
    elements.recorderTitle.value = "";
    await Promise.all([refreshRecorderStatus(), refreshDashboard()]);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    recorderRequestActive = false;
    await refreshRecorderStatus();
  }
});
elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files[0];
  elements.fileName.textContent = file
    ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`
    : "选择一个本地文件";
});

elements.filter.addEventListener("change", refreshDashboard);
elements.refresh.addEventListener("click", refreshDashboard);

document.title = `AISteph v${version} · 个人信息收件箱`;
await Promise.all([refreshDashboard(), refreshRecorderStatus()]);
setInterval(refreshDashboard, 30000);
setInterval(() => {
  if (!document.querySelector("#audio-form").hidden) refreshRecorderStatus();
}, 1000);
