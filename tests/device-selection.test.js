import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseAutomaticDevice,
  isBlockedAudioDevice,
  isVirtualAudioDevice
} from "../src/web/device-selection.js";

const huawei = "耳机 (HUAWEI FreeClip 2 Hands-Free AG Audio)";
const netease = "麦克风阵列 (网易虚拟音频设备)";
const builtIn = "麦克风阵列 (Realtek(R) Audio)";

test("自动选择实体麦克风并禁用网易虚拟音频设备", () => {
  const devices = [{ name: netease }, { name: huawei }];
  assert.equal(isVirtualAudioDevice(netease), true);
  assert.equal(isBlockedAudioDevice(netease), true);
  assert.equal(chooseAutomaticDevice(devices), huawei);
});

test("上次使用的耳机未出现时不回退到其他或虚拟设备", () => {
  assert.equal(
    chooseAutomaticDevice([{ name: netease }, { name: builtIn }], { preferred: huawei }),
    ""
  );
});

test("上次使用的耳机重新出现后自动恢复选择", () => {
  assert.equal(
    chooseAutomaticDevice([{ name: netease }, { name: huawei }], { preferred: huawei }),
    huawei
  );
});

test("刷新时保留用户当前选择但不会保留被禁用设备", () => {
  const devices = [{ name: netease }, { name: builtIn }, { name: huawei }];
  assert.equal(chooseAutomaticDevice(devices, { previous: builtIn }), builtIn);
  assert.equal(chooseAutomaticDevice(devices, { previous: netease }), huawei);
});
