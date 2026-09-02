import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(relativePath, encoding = "utf8") {
  return readFile(new URL(`../${relativePath}`, import.meta.url), encoding);
}

test("AISteph Voice客户端具备单实例、托盘、快捷键和内嵌工作台", async () => {
  const [project, app, window, hotkey, service, desktopSettings, iconSvg, recordingIconSvg, recordingIconBytes, webHtml, webStyles, webScript] = await Promise.all([
    read("client/AIStephVoice/AIStephVoice.csproj"),
    read("client/AIStephVoice/App.xaml.cs"),
    read("client/AIStephVoice/MainWindow.xaml.cs"),
    read("client/AIStephVoice/GlobalHotkey.cs"),
    read("client/AIStephVoice/ServiceManager.cs"),
    read("client/AIStephVoice/DesktopSettings.cs"),
    read("assets/branding/aisteph-voice-icon.svg"),
    read("assets/branding/aisteph-voice-recording-icon.svg"),
    read("client/AIStephVoice/Assets/AIStephVoiceRecording.ico", null),    read("src/web/index.html"),
    read("src/web/styles.css"),
    read("src/web/app.js")
  ]);

  assert.match(project, /<Version>0\.7\.0<\/Version>/);
  assert.match(project, /<Product>AISteph Voice<\/Product>/);
  assert.match(project, /<UseWPF>true<\/UseWPF>/);
  assert.match(project, /Microsoft\.Web\.WebView2/);
  assert.match(project, /<ApplicationIcon>Assets\\AIStephVoice\.ico<\/ApplicationIcon>/);
  assert.match(project, /AIStephVoiceRecording\.ico/);
  assert.match(project, /AIStephVoiceRecording\.png/);
  assert.match(app, /Local\\\\AIStephVoice\.App\.v1/);
  assert.match(app, /EventWaitHandle\.OpenExisting/);
  assert.match(app, /window\.ShowAndActivate/);
  assert.match(app, /if \(ownsInstanceMutex\)/);
  assert.match(app, /--background/);
  assert.match(app, /window\.Hide/);
  assert.match(window, /NotifyIcon/);
  assert.match(window, /EnsureCoreWebView2Async/);
  assert.match(window, /TimeSpan\.FromHours\(12\)/);
  assert.match(window, /检查在线更新/);
  assert.match(window, /WebMessageReceived/);
  assert.match(window, /settings:set-startup/);
  assert.match(window, /IsTrustedMessageSource/);
  assert.match(window, /OpenRecordingsDirectory/);
  assert.match(window, /settings:set-hotkey/);
  assert.match(window, /TryUpdate/);
  assert.match(window, /AIStephVoiceRecording\.ico/);
  assert.match(window, /SetRecordingVisual/);
  assert.match(window, /recorder:state/);
  assert.match(hotkey, /RegisterHotKey/);
  assert.match(hotkey, /ModNoRepeat/);
  assert.match(hotkey, /TryUpdate/);
  assert.match(hotkey, /TryNormalize/);
  assert.match(hotkey, /ModShift/);
  assert.match(hotkey, /modifierCount < 2/);
  assert.match(desktopSettings, /RecordingHotkey/);
  assert.match(desktopSettings, /SetHotkey/);
  assert.match(service, /Process\.Start/);
  assert.match(service, /runtime.*src.*server\.js/s);
  assert.match(service, /SpecialFolder\.LocalApplicationData/);
  assert.match(service, /AISTEPH_DESKTOP_CLIENT/);
  assert.match(service, /RecordingsDirectory/);
  assert.match(desktopSettings, /CurrentVersion\\Run/);
  assert.match(desktopSettings, /--background/);
  assert.match(desktopSettings, /explorer\.exe/);
  assert.match(iconSvg, /fill="#2E9B64"/);
  assert.match(iconSvg, /text-anchor="end"/);
  assert.match(iconSvg, /y="128"/);
  assert.match(recordingIconSvg, /fill="#C83F49"/);
  assert.match(recordingIconSvg, /text-anchor="end"/);
  assert.equal(recordingIconBytes[0], 0x00);
  assert.equal(recordingIconBytes[1], 0x00);
  assert.equal(recordingIconBytes[2], 0x01);
  assert.equal(recordingIconBytes[3], 0x00);
  assert.match(webHtml, /<title>AISteph Voice · 录音工作台<\/title>/);
  assert.match(webHtml, /class="brand-mark" aria-hidden="true">S<\/span>/);
  assert.match(webHtml, /class="brand-version">v__AISTEPH_VERSION__/);
  assert.match(webHtml, /id="app-settings-panel"/);
  assert.match(webHtml, /class="hotkey-capture-button"/);
  assert.doesNotMatch(webHtml, /id="service-status"/);
  assert.match(webStyles, /place-items: center end/);
  assert.match(webStyles, /background: var\(--success\)/);
  assert.match(webStyles, /\.app-settings-panel/);
  assert.match(webStyles, /\.hotkey-capture-button\.capturing/);
  assert.match(webScript, /settings:set-startup/);
  assert.match(webScript, /settings:set-hotkey/);
  assert.match(webScript, /captureHotkey/);
  assert.match(webScript, /recorder:state/);
  assert.match(webScript, /settings:open-recordings/);
});

test("AISteph Voice在线更新使用GitHub稳定发布页且发布包自带录音运行组件", async () => {
  const [update, publishScript, server, iconBytes] = await Promise.all([
    read("client/AIStephVoice/UpdateService.cs"),
    read("scripts/publish-voice-client.ps1"),
    read("src/server.js"),
    read("client/AIStephVoice/Assets/AIStephVoice.ico", null)
  ]);

  assert.match(update, /repos\/Walhy2020\/AISteph\/releases\/latest/);
  assert.match(update, /application\/vnd\.github\+json/);
  assert.match(update, /Version\.TryParse/);
  assert.match(publishScript, /--self-contained true/);
  assert.match(publishScript, /PublishSingleFile=true/);
  assert.match(publishScript, /"node", "ffmpeg", "ffprobe"/);
  assert.match(publishScript, /outputRoot.*StartsWith/s);
  assert.doesNotMatch(server, /AIStephHotkey\.exe/);
  assert.equal(iconBytes[0], 0x00);
  assert.equal(iconBytes[1], 0x00);
  assert.equal(iconBytes[2], 0x01);
  assert.equal(iconBytes[3], 0x00);
});