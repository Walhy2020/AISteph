const VIRTUAL_DEVICE_PATTERN = /(虚拟|virtual|voicemeeter|vb-audio|cable input|cable output|stereo mix|立体声混音)/i;
const BLOCKED_DEVICE_PATTERN = /网易虚拟音频设备/i;
const HEADSET_DEVICE_PATTERN = /(huawei|耳机|headset|hands-free)/i;

export function isVirtualAudioDevice(name) {
  return VIRTUAL_DEVICE_PATTERN.test(String(name ?? ""));
}

export function isBlockedAudioDevice(name) {
  return BLOCKED_DEVICE_PATTERN.test(String(name ?? ""));
}

export function chooseAutomaticDevice(devices, { previous = "", preferred = "" } = {}) {
  const names = devices.map((device) => String(device.name ?? "")).filter(Boolean);
  if (previous && names.includes(previous) && !isBlockedAudioDevice(previous)) return previous;
  if (preferred) {
    return names.includes(preferred) && !isBlockedAudioDevice(preferred) ? preferred : "";
  }
  const trusted = names.filter(
    (name) => !isVirtualAudioDevice(name) && !isBlockedAudioDevice(name)
  );
  return trusted.find((name) => HEADSET_DEVICE_PATTERN.test(name)) ?? trusted[0] ?? "";
}
