import {
  chooseAutomaticDevice,
  isBlockedAudioDevice,
  isVirtualAudioDevice
} from "/assets/device-selection.js";

const token = document.querySelector('meta[name="aisteph-token"]').content;
const version = document.querySelector('meta[name="aisteph-version"]').content;

const elements = {
  serviceStatus: document.querySelector("#service-status"),
  recorderStatus: document.querySelector("#recorder-status"),
  recorderStateLabel: document.querySelector("#recorder-state-label"),
  recorderDuration: document.querySelector("#recorder-duration"),
  recorderWaveform: document.querySelector("#recording-waveform"),
  recorderDevice: document.querySelector("#recorder-device"),
  recorderTitle: document.querySelector("#recorder-title"),
  recorderSettingsToggle: document.querySelector("#recorder-settings-toggle"),
  recorderSettingsPanel: document.querySelector("#recorder-settings-panel"),
  recorderGain: document.querySelector("#recorder-gain"),
  recorderGainValue: document.querySelector("#recorder-gain-value"),
  refreshDevices: document.querySelector("#refresh-devices"),
  recordingToggle: document.querySelector("#recording-toggle"),
  recordingToggleLabel: document.querySelector(".record-toggle-label"),
  formMessage: document.querySelector("#form-message"),
  recordingList: document.querySelector("#recording-list"),
  recordingTemplate: document.querySelector("#recording-card-template"),
  refreshRecordings: document.querySelector("#refresh-recordings")
};

let currentRecorderStatus = { state: "idle", lastError: null };
let recorderRequestActive = false;
let recorderStatusRefreshing = false;
const RECORDER_GAIN_STORAGE_KEY = "aisteph.recorder.gainDb";
const RECORDER_DEVICE_STORAGE_KEY = "aisteph.recorder.deviceName";
const DEVICE_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const WAVEFORM_BAR_COUNT = 43;
const waveformBars = Array.from({ length: WAVEFORM_BAR_COUNT }, () => {
  const bar = document.createElement("span");
  elements.recorderWaveform.append(bar);
  return bar;
});
let waveformHistory = Array(WAVEFORM_BAR_COUNT).fill(0);
let deviceLoadActive = false;
let deviceRetryTimer = null;
let deviceRetryAttempt = 0;

function getPreferredDevice() {
  try {
    const stored = localStorage.getItem(RECORDER_DEVICE_STORAGE_KEY) ?? "";
    return isVirtualAudioDevice(stored) || isBlockedAudioDevice(stored) ? "" : stored;
  } catch {
    return "";
  }
}

function rememberPreferredDevice(deviceName) {
  if (!deviceName || isVirtualAudioDevice(deviceName) || isBlockedAudioDevice(deviceName)) return;
  try {
    localStorage.setItem(RECORDER_DEVICE_STORAGE_KEY, deviceName);
  } catch {
    // 本地存储不可用时，当前页面仍会保持本次选择。
  }
}

function clearDeviceRetry() {
  if (deviceRetryTimer) clearTimeout(deviceRetryTimer);
  deviceRetryTimer = null;
}

function scheduleDeviceRetry() {
  clearDeviceRetry();
  if (deviceRetryAttempt >= DEVICE_RETRY_DELAYS_MS.length) return false;
  const delay = DEVICE_RETRY_DELAYS_MS[deviceRetryAttempt];
  deviceRetryAttempt += 1;
  deviceRetryTimer = setTimeout(() => loadRecorderDevices(), delay);
  return true;
}

function normalizeAudioLevel(levelDb) {
  const numericLevel = Number(levelDb);
  if (!Number.isFinite(numericLevel)) return 0;
  return Math.max(0, Math.min(1, (numericLevel + 60) / 54));
}

function renderWaveform(status) {
  if (status.state === "recording") {
    const measuredLevel = Math.pow(normalizeAudioLevel(status.audioLevelDb), 0.72);
    const previousLevel = waveformHistory.at(-1) || 0;
    waveformHistory.push(Math.max(measuredLevel, previousLevel * 0.72));
    waveformHistory = waveformHistory.slice(-WAVEFORM_BAR_COUNT);
  } else if (status.state === "idle") {
    waveformHistory = Array(WAVEFORM_BAR_COUNT).fill(0);
  }

  waveformBars.forEach((bar, index) => {
    const level = waveformHistory[index] || 0;
    bar.style.height = Math.round(7 + level * 69) + "px";
    bar.style.opacity = String(0.3 + level * 0.7);
  });
}

function normalizeGainDb(value) {
  const gainDb = Number(value);
  if (!Number.isFinite(gainDb)) return 0;
  return Math.min(24, Math.max(0, Math.round(gainDb)));
}

function updateGainSetting(value, persist = true) {
  const gainDb = normalizeGainDb(value);
  elements.recorderGain.value = String(gainDb);
  elements.recorderGainValue.textContent = gainDb ? "+" + gainDb + " dB" : "0 dB";
  if (persist) {
    try {
      localStorage.setItem(RECORDER_GAIN_STORAGE_KEY, String(gainDb));
    } catch {
      // 本地存储不可用时，本次页面内的设置仍然有效。
    }
  }
}

function setSettingsPanel(open) {
  elements.recorderSettingsPanel.hidden = !open;
  elements.recorderSettingsToggle.setAttribute("aria-expanded", String(open));
}

try {
  updateGainSetting(localStorage.getItem(RECORDER_GAIN_STORAGE_KEY), false);
} catch {
  updateGainSetting(0, false);
}

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
  renderWaveform(status);

  elements.recorderDevice.disabled = active || recorderRequestActive;
  elements.recorderTitle.disabled = active || recorderRequestActive;
  elements.recorderSettingsToggle.disabled = active || recorderRequestActive;
  elements.recorderGain.disabled = active || recorderRequestActive;
  elements.refreshDevices.disabled = active || recorderRequestActive;
  if (active) setSettingsPanel(false);
  elements.recordingToggle.classList.toggle("is-recording", active);
  elements.recordingToggleLabel.textContent = active ? "停止并保存" : "开始录音";
  elements.recordingToggle.disabled = recorderRequestActive
    || state === "starting"
    || state === "stopping"
    || (!active && !elements.recorderDevice.value);

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

    const audio = card.querySelector("audio");
    const deleteButton = card.querySelector(".delete-recording-button");
    deleteButton.addEventListener("click", async () => {
      const title = item.title || "未命名录音";
      const confirmed = window.confirm(
        `确定删除“${title}”吗？\n\n音频文件、处理队列和待审核资料将永久删除。`
      );
      if (!confirmed) return;

      audio.pause();
      deleteButton.disabled = true;
      deleteButton.textContent = "删除中…";
      try {
        await api(`/api/inbox/audio/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        showMessage(`已删除录音：${title}`, "success");
        await refreshDashboard();
      } catch (error) {
        deleteButton.disabled = false;
        deleteButton.textContent = "删除";
        showMessage(error.message, "error");
      }
    });
    if (item.audioUrl) {
      audio.src = item.audioUrl;
      audio.addEventListener("play", () => {
        document.querySelectorAll("audio").forEach((other) => {
          if (other !== audio) other.pause();
        });
      });
      audio.addEventListener("error", () => {
        card.classList.add("playback-error");
        audio.title = "播放失败";
      });
    } else {
      audio.hidden = true;
      card.classList.add("playback-error");
      const unavailable = document.createElement("span");
      unavailable.className = "playback-unavailable";
      unavailable.textContent = "录音文件不可用";
      card.append(unavailable);
    }
    fragment.append(card);
  }
  elements.recordingList.replaceChildren(fragment);
}

async function loadRecorderDevices({ resetRetry = false } = {}) {
  if (deviceLoadActive) return;
  if (resetRetry) {
    clearDeviceRetry();
    deviceRetryAttempt = 0;
  }

  deviceLoadActive = true;
  const previous = elements.recorderDevice.value;
  const preferred = getPreferredDevice();
  elements.refreshDevices.disabled = true;
  elements.recorderDevice.disabled = true;
  try {
    const payload = await api("/api/recorder/devices");
    const selected = chooseAutomaticDevice(payload.devices, { previous, preferred });
    const names = new Set(payload.devices.map((device) => device.name));
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = preferred && !names.has(preferred)
      ? "正在等待上次使用的麦克风…"
      : "请选择录音设备";

    const fragment = document.createDocumentFragment();
    fragment.append(placeholder);
    for (const device of payload.devices) {
      const option = document.createElement("option");
      const blocked = isBlockedAudioDevice(device.name);
      const virtual = isVirtualAudioDevice(device.name);
      option.value = device.name;
      option.disabled = blocked;
      option.textContent = blocked
        ? device.name + "（不可用于录音）"
        : virtual
          ? device.name + "（虚拟设备，需手动选择）"
          : device.name;
      fragment.append(option);
    }

    elements.recorderDevice.replaceChildren(fragment);
    elements.recorderDevice.value = selected;
    if (selected && !isVirtualAudioDevice(selected)) {
      rememberPreferredDevice(selected);
      clearDeviceRetry();
      deviceRetryAttempt = 0;
      showMessage("已选择录音设备：" + selected, "success");
    } else if (preferred && !names.has(preferred)) {
      const retrying = scheduleDeviceRetry();
      showMessage(
        retrying
          ? "上次使用的麦克风暂未出现，正在自动重试：" + preferred
          : "上次使用的麦克风仍未出现，请连接设备后点击刷新：" + preferred,
        "warning"
      );
    } else if (payload.devices.some((device) => isVirtualAudioDevice(device.name))) {
      const retrying = scheduleDeviceRetry();
      showMessage(
        retrying
          ? "目前只检测到虚拟音频设备，正在继续查找真实麦克风。"
          : "仍只检测到虚拟音频设备，请连接耳机后点击刷新。",
        "warning"
      );
    } else {
      const retrying = scheduleDeviceRetry();
      showMessage(
        retrying
          ? "未检测到可用麦克风，正在自动重试。"
          : "未检测到可用麦克风，请检查连接后点击刷新。",
        "error"
      );
    }
  } catch (error) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "麦克风读取失败，正在重试…";
    elements.recorderDevice.replaceChildren(option);
    const retrying = scheduleDeviceRetry();
    showMessage(
      retrying ? error.message + "，正在自动重试。" : error.message + "，请点击刷新重试。",
      "error"
    );
  } finally {
    deviceLoadActive = false;
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
    showMessage(error.message, "error");
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

elements.refreshDevices.addEventListener("click", () => loadRecorderDevices({ resetRetry: true }));
elements.recorderDevice.addEventListener("change", () => {
  const selected = elements.recorderDevice.value;
  if (selected && !isVirtualAudioDevice(selected)) {
    rememberPreferredDevice(selected);
    clearDeviceRetry();
    deviceRetryAttempt = 0;
    showMessage("已选择录音设备：" + selected, "success");
  } else if (selected) {
    showMessage("这是虚拟音频设备，不会保存为默认麦克风。", "warning");
  }
  renderRecorderStatus();
});
elements.refreshRecordings.addEventListener("click", refreshDashboard);
elements.recorderSettingsToggle.addEventListener("click", () => {
  setSettingsPanel(elements.recorderSettingsPanel.hidden);
});
elements.recorderGain.addEventListener("input", () => {
  updateGainSetting(elements.recorderGain.value);
});
document.addEventListener("click", (event) => {
  if (elements.recorderSettingsPanel.hidden) return;
  if (event.target instanceof Element && event.target.closest(".recorder-field")) return;
  setSettingsPanel(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSettingsPanel(false);
});

async function startRecording() {
  if (!elements.recorderDevice.value) {
    showMessage("请等待华为耳机出现，或手动选择一个可用麦克风。", "error");
    return;
  }
  if (isBlockedAudioDevice(elements.recorderDevice.value)) {
    showMessage("网易虚拟音频设备不可用于录音，请选择华为耳机。", "error");
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
        title: elements.recorderTitle.value,
        gainDb: Number(elements.recorderGain.value)
      })
    });
    renderRecorderStatus(status);
    showMessage("录音已开始，再次点击按钮即可停止并保存。", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    recorderRequestActive = false;
    await refreshRecorderStatus();
  }
}

async function stopRecording() {
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
}

elements.recordingToggle.addEventListener("click", async () => {
  if (currentRecorderStatus.state === "recording") {
    await stopRecording();
    return;
  }
  await startRecording();
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
  if (["recording", "stopping"].includes(currentRecorderStatus.state)) {
    refreshRecorderStatus();
  }
}, 250);
setInterval(() => {
  if (!isAudioPlaybackActive()) refreshDashboard();
}, 30000);
