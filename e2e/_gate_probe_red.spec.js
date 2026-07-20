// [GATE-PROBE 临时] 一条恒失败的测试,验「真红测 → 对应分片红 → e2e-all 红 → PR 被挡」。验完删。
const { test, expect } = require('@playwright/test');
test('GATE PROBE: 恒失败(验门有牙)', async () => { expect(1).toBe(2); });
