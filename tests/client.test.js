import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(relativePath, encoding = "utf8") {
  return readFile(new URL(`../${relativePath}`, import.meta.url), encoding);
}

test("AISteph Voice客户端具备单实例、托盘、快捷键和内嵌工作台", async () => {
  const [project, app, window, hotkey, service, iconSvg, webHtml, webStyles] = await Promise.all([
    read("client/AIStephVoice/AIStephVoice.csproj"),
    read("client/AIStephVoice/App.xaml.cs"),
    read("client/AIStephVoice/MainWindow.xaml.cs"),
    read("client/AIStephVoice/GlobalHotkey.cs"),
    read("client/AIStephVoice/ServiceManager.cs"),
    read("assets/branding/aisteph-voice-icon.svg"),
    read("src/web/index.html"),
    read("src/web/styles.css")
  ]);

  assert.match(project, /<Version>0\.7\.0<\/Version>/);
  assert.match(project, /<Product>AISteph Voice<\/Product>/);
  assert.match(project, /<UseWPF>true<\/UseWPF>/);
  assert.match(project, /Microsoft\.Web\.WebView2/);
  assert.match(project, /<ApplicationIcon>Assets\\AIStephVoice\.ico<\/ApplicationIcon>/);
  assert.match(app, /Local\\\\AIStephVoice\.App\.v1/);
  assert.match(app, /EventWaitHandle\.OpenExisting/);
  assert.match(app, /window\.ShowAndActivate/);
  assert.match(app, /if \(ownsInstanceMutex\)/);
  assert.match(window, /NotifyIcon/);
  assert.match(window, /EnsureCoreWebView2Async/);
  assert.match(window, /Ctrl \+ Alt \+ R/);
  assert.match(window, /TimeSpan\.FromHours\(12\)/);
  assert.match(window, /检查在线更新/);
  assert.match(hotkey, /RegisterHotKey/);
  assert.match(hotkey, /ModNoRepeat/);
  assert.match(service, /Process\.Start/);
  assert.match(service, /runtime.*src.*server\.js/s);
  assert.match(service, /SpecialFolder\.LocalApplicationData/);
  assert.match(service, /AISTEPH_DESKTOP_CLIENT/);
  assert.match(iconSvg, /fill="#2E9B64"/);
  assert.match(iconSvg, /text-anchor="end"/);
  assert.match(iconSvg, /y="128"/);
  assert.match(webHtml, /<title>AISteph Voice · 录音工作台<\/title>/);
  assert.match(webHtml, /class="brand-mark" aria-hidden="true">S<\/span>/);
  assert.match(webStyles, /place-items: center end/);
  assert.match(webStyles, /background: var\(--success\)/);
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