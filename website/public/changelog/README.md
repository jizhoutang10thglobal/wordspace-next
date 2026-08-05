# changelog 配图

CHANGELOG.md / CHANGELOG.en.md 里的配图放这儿，命名 `<版本号去点>-<短名>.png`（如 `0122-multi-color.png`）。

正本里写**仓库根相对路径**（GitHub 上看 CHANGELOG.md 图也能显示），官网构建时把前缀映射成站点根：

```markdown
![选中四行后一起改颜色](website/public/changelog/0122-multi-color.png)
```

规则（什么时候才配图、alt 必填、必须独立成行）见 `docs/releasing.md`「Changelog 文案规范 · 配图」。
文件缺失或路径写错 → `next build` 直接挂（`website/app/lib/changelog.ts`）。

`fixture-render-check.png` 不是真配图，是 `/changelog/fixture` 那道渲染门用的夹具图，别删。
