import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // 全部判定/换算逻辑均为纯函数单测，不依赖 DOM；
    // node 环境同时规避 jsdom 内置 undici 在 Node 20 下的加载报错。
    environment: 'node',
  },
});
