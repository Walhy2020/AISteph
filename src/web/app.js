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
  fileName: document.querySelector("#file-name")
};

const typeInfo = {
  text: { label: "文字记录", glyph: "字", className: "" },
  article_link: { label: "文章链接", glyph: "链", className: "article" },
  document: { label: "本地文件", glyph: "档", className: "document" }
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "X-AISteph-Token": token,
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({ error: "响应格式无效" }));
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
  description.textContent = "从左侧收录一段文字、一个文章链接或本地文件，它会出现在这里。";
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

elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files[0];
  elements.fileName.textContent = file
    ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`
    : "选择一个本地文件";
});

elements.filter.addEventListener("change", refreshDashboard);
elements.refresh.addEventListener("click", refreshDashboard);

document.title = `AISteph v${version} · 个人信息收件箱`;
await refreshDashboard();
setInterval(refreshDashboard, 30000);
