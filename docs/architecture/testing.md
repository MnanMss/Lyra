# 测试

三层，各自答不同的问题。

| 跑什么 | 答什么 | 多久 |
| --- | --- | --- |
| `pnpm test` | 规则对不对：分组、风险判定、路径、diff 解析、组件渲染出什么 | 约 25 秒 |
| `pnpm arch` | 谁可以 import 谁 | 约 2 秒 |
| `pnpm test:e2e` | 真实窗口里，点下去会怎样 | 约 20 分钟 |

## 单元测试

用 Node 自带的 `node:test`，不引测试框架。跑在 `--experimental-strip-types` 下，所以测试文件
是 `.ts` 而不能是 `.tsx`。

## 组件测试

在 `packages/desktop/test/ui/`，`pnpm --filter @lyra/desktop test:ui`。用 happy-dom 真的挂载再
断言，一秒跑完。写法用 `createElement` 而不是 JSX，辅助函数在 `test/helpers/mount.ts`。

断言要对着**用户能观察到的东西**——渲染出的属性、文字、可访问名——而不是内部状态。
`test/ui/tooltip-contract.test.ts` 是这个原则最清楚的例子：它不断言「组件设置了 data-ly-tip」，
而是断言「组件写出来的东西，能被 tooltip.ts 实际用的那个选择器找到」。这两句话听起来一样，
但只有后者能抓住那次真实事故——属性改了名，读的那一侧没跟上，全应用的 tooltip 静默失效。

见 [ADR-0008](../adr/0008-node-test-and-happy-dom.md)。

## 端到端

对话滚动与切换的回归约束见 [对话渲染与阅读位置](conversation-rendering.md)。聚焦验证可运行：

```bash
pnpm build
pnpm --filter @lyra/desktop exec node --test --experimental-strip-types e2e/transcript-stability.test.ts
```

`packages/desktop/e2e/`，跑真实的 Electron 窗口，经 DevTools 协议驱动。一次一个应用
（`--test-concurrency=1`）：三个窗口抢一台笔记本会让量布局的测试失败，而那是最糟的红——被测
的代码本身没问题。

测试直接启动 Electron 二进制，由 desktop 的 `package.json` 定位 `out/main/index.js`，保留
原来的 `app.getAppPath()`。运行前先 `pnpm build`；每个测试文件
不会再经 `electron-vite preview` 重建，因而测的是同一个构建，Windows 也不需要通过 shell
启动 `pnpm.cmd`。退出时 Windows 用 `taskkill /T` 回收 Electron 的进程树，启动失败同样清理
临时 profile。

### Windows 桌面回归

CI 的 `windows-ui` 在 push、PR 和手动执行时运行真实 Windows Electron，并纳入 `all-green`。
它跑 `desktop-compatibility.test.ts`、`transcript-stability.test.ts`、`interaction-polish.test.ts`、
`session-startup.test.ts` 与 `definition-actions.test.ts`：

- 100%、125%、150%、200% Chromium 显示缩放，深浅主题和 380px 起的窗口宽度。
- 从 Window Controls Overlay API 读取系统按钮区域，验证应用按钮没有进入它。
- 检查原生 overlay 与工具栏中心线，以及侧栏切换前后、终端标签增多后的图标和按钮对齐。
- 输入框边界、Tab 焦点标记、Windows 快捷键提示、终端标签和新建/关闭入口。
- 长对话滚动范围、思考行去重、历史展开状态、会话切换首帧和阅读位置。
- 问题刻度导航、设置路由、渐隐、跨 Tab 保留、Git Index 统计与 C# 高亮。
- 慢 MCP 初始化前的首条提交、取消、折叠状态、同名隔离及后台完成。
- 列表删除的悬停渐变、键盘确认、触摸可见性、固定布局，以及命令、技能目录和规则移入系统废纸篓。

设置 `LYRA_E2E_ARTIFACTS` 可以保存真实应用截图；CI 保留 7 天。测试使用临时项目和合成会话
日志，经真实应用加载，退出后清理。模型请求只发给测试启动的本地协议服务，不使用用户密钥。

本地聚焦运行：

```bash
pnpm build
pnpm --filter @lyra/desktop exec node --test --test-concurrency=1 --experimental-strip-types e2e/desktop-compatibility.test.ts e2e/transcript-stability.test.ts e2e/interaction-polish.test.ts e2e/session-startup.test.ts e2e/definition-actions.test.ts
```

macOS 上运行这些测试可验证共享 Chromium 布局，不能证明 Windows 的 DirectWrite、GPU 驱动、
原生 IME 或多屏 DPI 切换都正常。Windows CI 的强制缩放也不替代跨显示器拖动的实机测试。
平台行为约束见 [Windows 桌面适配](windows-desktop.md)。

### macOS 原生标题栏

CDP 截图不包含原生红绿灯，无法发现它们与 HTML 图标之间的 1pt 偏差。有屏幕录制权限的
macOS 环境可运行 `pnpm --filter @lyra/desktop exec node --experimental-strip-types e2e/header-native-probe.ts`。
它启动隔离窗口，用系统截图取原生灯像素，与真实 DOM 图标中心线比较；截图中的灯高度也必须
落在有效范围，避免截图缺失产生假绿。`LYRA_E2E_ARTIFACTS` 可保留原始截图，临时 profile 自动清理。

### 定位端到端失败

每条失败都要解释，历史失败数量不能代替本次证据。先读断言针对的可见元素，再单独重跑；仍不能
区分实现回归与既有问题时，在隔离 worktree 对同一个测试、同样条件做比较。不要用总失败数相同
推断没有回归，也不要放宽断言阈值来接受一条未解释的失败。

Activity 会保留隐藏页面的 DOM。全局 `querySelectorAll` 可能读到已隐藏分区；视觉断言必须限定
当前页面，或使用 `checkVisibility({ visibilityProperty: true })`。工具组的详情需要先展开，
中途切换模型需要完成真实确认步骤；不能根据旧 UI 的行为读取未展示的内容。

测试只清理自己创建的 Electron 进程及临时目录。不要用全局 `pkill` 回收用户正在运行的应用。
同一机器一次运行一份 Electron E2E，运行期间不重建 `out`，避免删除仍在读取的懒加载 chunk。

首次读取的骨架屏要用真实慢输入或受控 deferred 响应验证；缓存命中不应被要求重播骨架。
数值证据与本次范围见 [交互质量与验证](interaction-quality.md)。
