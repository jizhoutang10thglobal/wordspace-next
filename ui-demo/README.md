# Wordspace UI Demo

Wordspace 产品形态的前端交互原型。纯前端,没有后端,所有数据都是模拟的,用来快速展示产品是什么:一个浏览器形态、本地优先的文档工具,文档即 HTML,人和 Agent 共用,可一键发布。

## 运行

需要 Node 18 或更新版本。

```bash
npm install
npm run dev
```

打开终端打印的地址(默认 http://localhost:5180)。

## 打包成静态版本

```bash
npm run build      # 产物在 dist/,可直接托管或打开
npm run preview    # 本地预览构建产物
```

构建用相对路径,`dist/` 可以放到任意静态托管,或直接双击 `dist/index.html` 打开。

## 说明

- 没有后端,也不需要任何环境变量或密钥。文档编辑、AI 生成、协作、发布、Agent、内置浏览器都是前端模拟,效果接近真实产品。
- 数据存在浏览器 localStorage,刷新保留。想恢复初始数据,在浏览器控制台运行 `__resetWordspace()`。
- 技术栈:Vite + React + TypeScript,手写 CSS。
