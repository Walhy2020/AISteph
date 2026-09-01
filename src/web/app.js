const token = document.querySelector('meta[name="aisteph-token"]').content;
const version = document.querySelector('meta[name="aisteph-version"]').content;

const elements = {
  serviceStatus: document.querySelector("#service-status"),
  recordingsStat: document.querySelector("#stat-recordings"),
  durationStat: document.querySelector("#stat-duration"),
  pendingStat: document.querySelector("#stat-pending"),
  recorderStatus: document.querySelector("#recorder-status"),
  recorderStateLabel: document.querySelector("#recorder-state-label"),
  recorderDuration: document.querySelector("#recorder-duration"),
  recorderDeviceLabel: document.querySelector("#recorder-device-label"),
  recorderDevice: document.querySelector("#recorder-device"),
  recorderTitle: document.querySelector("#recorder-title"),
  refreshDevices: document.querySelector("#refresh-devices"),
  startRecording: document.querySelector("#start-recording"),
  stopRecording: document.querySelector("#stop-recording"),
  formMessage: document.querySelector("#form-message"),
  recordingList: document.querySelector("#recording-list"),
  recordingTemplate: document.querySelector("#recording-card-template"),
  refreshRecordings: document.querySelector("#refresh-recordings")
};

let currentRecorderStatus = { state: "idle", lastError: null };
let recorderRequestActive = false;
let recorderStatusRefreshing = false;

async function api(requestPath, options = {}) {
  const response = await fetch(requestPath, {
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

function showMessage(message, kind = "") {
  elements.formMessage.className = `form-message ${kind}`.trim();
  elements.formMessage.textContent = message;
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

function formatTotalDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (seconds < 60) return `${seconds}秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (!hours) return `${minutes}分`;
  return `${hours}时${minutes}分`;
}

function formatTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function liveElapsedSeconds(status) {
  if (!status.startedAt || !["starting", "recording", "stopping"].includes(status.state)) {
    return Number(status.elapsedSeconds) || 0;
  }
  return Math.max(
    Number(status.elapsedSeconds) || 0,
    Math.floor((Date.now() - Date.parse(status.startedAt)) / 1000)
  );
}

function renderRecorderStatus(status = currentRecorderStatus) {
  currentRecorderStatus = status;
  const state = status.state || "idle";
  const active = ["starting", "recording", "stopping"].includes(state);
  const labels = {
    idle: "准备录音",
    starting: "正在连接麦克风",
    recording: "正在录音",
    stopping: "正在保存录音"
  };

  elements.recorderStatus.className = `recording-console ${state}`;
  elements.recorderStateLabel.textContent = labels[state] || "录音状态未知";
  elements.recorderDuration.textContent = formatDuration(liveElapsedSeconds(status));
  elements.recorderDeviceLabel.textContent = status.deviceName
    || status.lastError
    || elements.recorderDevice.selectedOptions[0]?.textContent
    || "请选择麦克风";

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

function renderEmpty() {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const icon = document.createElement("span");
  icon.textContent = "◎";
  const title = document.createElement("strong");
  title.textContent = "还没有录音";
  const description = document.createElement("p");
  description.textContent = "完成第一段录音后，它会出现在这里并可以直接播放。";
  empty.append(icon, title, description);
  elements.recordingList.replaceChildren(empty);
}

function isAudioPlaybackActive() {
  return Array.from(elements.recordingList.querySelectorAll("audio"))
    .some((audio) => !audio.paused && !audio.ended);
}

function renderRecordings(items) {
  if (!items.length) {
    renderEmpty();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = elements.recordingTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector("h3").textContent = item.title || "未命名录音";
    card.querySelector(".captured-time").textContent = formatTime(item.capturedAt);
    card.querySelector(".duration-label").textContent = `时长 ${formatDuration(item.durationSeconds)}`;
    card.querySelector(".device-label").textContent = item.deviceName || "设备未知";
    card.querySelector(".record-id").textContent = item.id;
    card.querySelector(".source-path").textContent = item.sourcePath || "文件路径未知";

    const audio = card.querySelector("audio");
    if (item.audioUrl) {
      audio.src = item.audioUrl;
      audio.addEventListener("play", () => {
        document.querySelectorAll("audio").forEach((other) => {
          if (other !== audio) other.pause();
        });
      });
      audio.addEventListener("error", () => {
        card.classList.add("playback-error");
        card.querySelector(".analysis-state").textContent = "播放失败";
      });
    } else {
      audio.remove();
      card.classList.add("playback-error");
      card.querySelector(".analysis-state").textContent = "文件不可用";
    }
    fragment.append(card);
  }
  elements.recordingList.replaceChildren(fragment);
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
    renderRecorderStatus();
  }
}

async function refreshRecorderStatus() {
  if (recorderStatusRefreshing) return;
  recorderStatusRefreshing = true;
  try {
    renderRecorderStatus(await api("/api/recorder/status"));
  } catch (error) {
    elements.recorderStatus.className = "recording-console error";
    elements.recorderStateLabel.textContent = "录音服务不可用";
    elements.recorderDeviceLabel.textContent = error.message;
  } finally {
    recorderStatusRefreshing = false;
  }
}

async function refreshDashboard() {
  elements.refreshRecordings.disabled = true;
  try {
    const [status, inbox] = await Promise.all([
      api("/api/status"),
      api("/api/inbox?type=audio&limit=200")
    ]);
    setServiceStatus(true, `本地服务在线 · v${status.version}`);
    elements.recordingsStat.textContent = status.stats.audio?.total ?? 0;
    elements.durationStat.textContent = formatTotalDuration(
      status.stats.audio?.durationSeconds ?? 0
    );
    elements.pendingStat.textContent = status.stats.audio?.pendingReview ?? 0;
    renderRecordings(inbox.items);
  } catch (error) {
    setServiceStatus(false, "本地服务异常");
    const container = document.createElement("div");
    container.className = "error-state";
    const title = document.createElement("strong");
    title.textContent = "录音资料库读取失败";
    const description = document.createElement("p");
    description.textContent = error.message;
    container.append(title, description);
    elements.recordingList.replaceChildren(container);
  } finally {
    elements.refreshRecordings.disabled = false;
  }
}

elements.refreshDevices.addEventListener("click", loadRecorderDevices);
elements.recorderDevice.addEventListener("change", () => renderRecorderStatus());
elements.refreshRecordings.addEventListener("click", refreshDashboard);

elements.startRecording.addEventListener("click", async () => {
  if (!elements.recorderDevice.value) {
    showMessage("请先选择一个可用麦克风。", "error");
    return;
  }
  recorderRequestActive = true;
  renderRecorderStatus();
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
    showMessage("录音已开始。完成后点击“停止并保存”。", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    recorderRequestActive = false;
    await refreshRecorderStatus();
  }
});

elements.stopRecording.addEventListener("click", async () => {
  recorderRequestActive = true;
  renderRecorderStatus({ ...currentRecorderStatus, state: "stopping" });
  showMessage("正在停止、封装并校验录音…");
  try {
    const payload = await api("/api/recorder/stop", { method: "POST" });
    showMessage(
      `录音已保存：${payload.record.title}（${formatDuration(payload.record.durationSeconds)}）。`,
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

document.title = `AISteph v${version} · 录音工作台`;
await Promise.all([
  refreshDashboard(),
  refreshRecorderStatus(),
  loadRecorderDevices()
]);

setInterval(() => renderRecorderStatus(), 1000);
setInterval(refreshRecorderStatus, 5000);
setInterval(() => {
  if (!isAudioPlaybackActive()) refreshDashboard();
}, 30000);