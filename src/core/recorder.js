import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { addAudio } from "./intake.js";

const START_TIMEOUT_MS = 2000;
const STOP_TIMEOUT_MS = 6000;
const KILL_TIMEOUT_MS = 2000;
const MIN_GAIN_DB = 0;
const MAX_GAIN_DB = 24;

export class RecorderError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "RecorderError";
    this.statusCode = statusCode;
  }
}

function compactStamp(date) {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeGainDb(value) {
  const gainDb = Number(value ?? 0);
  if (!Number.isFinite(gainDb) || gainDb < MIN_GAIN_DB || gainDb > MAX_GAIN_DB) {
    throw new RecorderError(400, "录音增益必须在0到24dB之间");
  }
  return Math.round(gainDb * 10) / 10;
}

export function parseDshowDevices(output) {
  const devices = [];
  const seen = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/\]\s+"([^"]+)"\s+\(audio\)\s*$/i);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    devices.push({ name: match[1] });
  }
  return devices;
}

function collectProcess(command, args, spawnImpl, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      settled = true;
      reject(new Error(`${command} 执行超时`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function processCompletion(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
    child.once("close", (code, signal) => resolve({ code, signal, error: null }));
  });
}

async function waitForCompletion(completion, timeoutMs) {
  return Promise.race([
    completion,
    wait(timeoutMs).then(() => null)
  ]);
}

async function defaultProbeAudio(filePath, spawnImpl, ffprobePath) {
  const result = await collectProcess(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_name,codec_type",
    "-of", "json",
    filePath
  ], spawnImpl);
  if (result.code !== 0) {
    throw new Error(`ffprobe校验失败（退出码 ${result.code}）`);
  }
  const payload = JSON.parse(result.stdout);
  const audioStream = payload.streams?.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(payload.format?.duration);
  if (!audioStream || audioStream.codec_name !== "opus") {
    throw new Error("录音文件不是有效的Opus音频");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("录音文件没有有效时长");
  }
  return { codecName: audioStream.codec_name, durationSeconds };
}

export function createRecorder(config, log, options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn;
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? "ffprobe";
  const probeAudio = options.probeAudio
    ?? ((filePath) => defaultProbeAudio(filePath, spawnImpl, ffprobePath));
  const now = options.now ?? (() => new Date());
  let active = null;
  let lastError = null;

  async function listDevices() {
    let result;
    try {
      result = await collectProcess(ffmpegPath, [
        "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"
      ], spawnImpl);
    } catch (error) {
      await log("error", "recorder.devices_failed", {
        errorName: error.name,
        errorMessage: error.message
      });
      throw new RecorderError(503, `无法枚举麦克风：${error.message}`);
    }
    const devices = parseDshowDevices(`${result.stdout}\n${result.stderr}`);
    await log("info", "recorder.devices_listed", {
      deviceCount: devices.length,
      exitCode: result.code
    }).catch(() => {});
    return devices;
  }

  function status() {
    if (!active) return { state: "idle", lastError };
    return {
      state: active.state,
      sessionId: active.sessionId,
      title: active.title,
      deviceName: active.deviceName,
      gainDb: active.gainDb,
      startedAt: active.startedAt,
      elapsedSeconds: Math.max(
        0,
        Math.floor((now().getTime() - Date.parse(active.startedAt)) / 1000)
      ),
      lastError
    };
  }

  async function cleanFailedSession(session, error, event = "recorder.failed") {
    if (active === session) active = null;
    lastError = error.message;
    await rm(session.temporaryPath, { force: true }).catch(() => {});
    await log("error", event, {
      sessionId: session.sessionId,
      deviceName: session.deviceName,
      errorName: error.name,
      errorMessage: error.message
    }).catch(() => {});
  }

  async function start({ deviceName, title, gainDb } = {}) {
    if (active) throw new RecorderError(409, "已有一场录音正在进行");
    const normalizedDevice = String(deviceName ?? "").trim();
    if (!normalizedDevice) throw new RecorderError(400, "请选择麦克风");
    if (normalizedDevice.length > 300) throw new RecorderError(400, "麦克风名称过长");
    const normalizedGainDb = normalizeGainDb(gainDb);
    const devices = await listDevices();
    if (!devices.some((device) => device.name === normalizedDevice)) {
      throw new RecorderError(400, "所选麦克风当前不可用，请刷新设备列表");
    }

    const started = now();
    const sessionId = `REC-${compactStamp(started)}-${randomUUID().slice(0, 6)}`;
    const dayDirectory = path.join(
      config.dataRootPath,
      "audio",
      started.toISOString().slice(0, 10)
    );
    await mkdir(dayDirectory, { recursive: true });
    const temporaryPath = path.join(dayDirectory, `.${sessionId}.part.opus`);
    const finalPath = path.join(dayDirectory, `${sessionId}.opus`);
    const child = spawnImpl(ffmpegPath, [
      "-hide_banner", "-loglevel", "info",
      "-f", "dshow", "-i", `audio=${normalizedDevice}`,
      "-af", `volume=${normalizedGainDb}dB`,
      "-vn", "-c:a", "libopus", "-b:a", "48k", "-application", "voip",
      "-y", temporaryPath
    ], {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"]
    });
    const session = {
      sessionId,
      title: String(title ?? "").trim().slice(0, 200),
      deviceName: normalizedDevice,
      gainDb: normalizedGainDb,
      startedAt: started.toISOString(),
      temporaryPath,
      finalPath,
      child,
      state: "starting",
      completion: processCompletion(child),
      stderrTail: ""
    };
    active = session;
    child.stderr?.on("data", (chunk) => {
      session.stderrTail = `${session.stderrTail}${chunk.toString("utf8")}`.slice(-4000);
    });

    const startupResult = await Promise.race([
      session.completion.then((result) => ({ kind: "closed", result })),
      wait(options.startTimeoutMs ?? START_TIMEOUT_MS).then(() => ({ kind: "ready" }))
    ]);
    if (startupResult.kind === "closed") {
      const detail = session.stderrTail.split(/\r?\n/).filter(Boolean).slice(-1)[0];
      const error = new RecorderError(
        503,
        detail ? `麦克风启动失败：${detail}` : "麦克风启动失败"
      );
      await cleanFailedSession(session, error, "recorder.start_failed");
      throw error;
    }

    session.state = "recording";
    lastError = null;
    session.completion.then(async (result) => {
      if (active !== session || session.state !== "recording") return;
      const error = new RecorderError(
        500,
        `录音进程意外退出（退出码 ${result.code ?? "未知"}）`
      );
      await cleanFailedSession(session, error, "recorder.unexpected_exit");
    });
    await log("info", "recorder.started", {
      sessionId,
      deviceName: normalizedDevice,
      gainDb: normalizedGainDb,
      startedAt: session.startedAt
    }).catch(() => {});
    return status();
  }

  async function stop({ forShutdown = false } = {}) {
    if (!active) {
      if (forShutdown) return null;
      throw new RecorderError(409, "当前没有正在进行的录音");
    }
    const session = active;
    if (session.state === "stopping") {
      throw new RecorderError(409, "录音正在停止，请稍候");
    }
    session.state = "stopping";
    await log("info", "recorder.stop_requested", {
      sessionId: session.sessionId,
      deviceName: session.deviceName
    }).catch(() => {});

    session.child.stdin?.write("q\n");
    let result = await waitForCompletion(
      session.completion,
      options.stopTimeoutMs ?? STOP_TIMEOUT_MS
    );
    if (!result) {
      await log("warn", "recorder.stop_timeout", {
        sessionId: session.sessionId
      }).catch(() => {});
      session.child.kill();
      result = await waitForCompletion(
        session.completion,
        options.killTimeoutMs ?? KILL_TIMEOUT_MS
      );
    }
    if (!result) {
      const error = new RecorderError(500, "FFmpeg录音进程无法停止");
      await cleanFailedSession(session, error);
      throw error;
    }
    if (result.error || result.code !== 0) {
      const error = new RecorderError(
        500,
        `录音进程异常退出（退出码 ${result.code ?? "未知"}）`
      );
      await cleanFailedSession(session, error);
      throw error;
    }

    try {
      const fileInfo = await stat(session.temporaryPath);
      if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error("录音文件为空");
      const probe = await probeAudio(session.temporaryPath);
      await rename(session.temporaryPath, session.finalPath);
      const endedAt = now().toISOString();
      const record = await addAudio(config, log, {
        title: session.title,
        inputPath: session.finalPath,
        startedAt: session.startedAt,
        endedAt,
        durationSeconds: probe.durationSeconds,
        deviceName: session.deviceName,
        sessionId: session.sessionId
      });
      active = null;
      lastError = null;
      await log("info", "recorder.completed", {
        sessionId: session.sessionId,
        sourceId: record.id,
        deviceName: session.deviceName,
        durationSeconds: record.durationSeconds,
        audioBytes: fileInfo.size,
        exitCode: result.code
      }).catch(() => {});
      return record;
    } catch (error) {
      await rm(session.finalPath, { force: true }).catch(() => {});
      const wrapped = error instanceof RecorderError
        ? error
        : new RecorderError(500, `录音文件校验或入库失败：${error.message}`);
      await cleanFailedSession(session, wrapped);
      throw wrapped;
    }
  }

  async function shutdown() {
    if (!active) return;
    try {
      await stop({ forShutdown: true });
    } catch (error) {
      await log("error", "recorder.shutdown_failed", {
        errorName: error.name,
        errorMessage: error.message
      }).catch(() => {});
    }
  }

  return { listDevices, status, start, stop, shutdown };
}