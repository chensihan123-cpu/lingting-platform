# 灵听：环境声感知 Demo

## 从GitHub下载后运行

环境：Python 3.10+、Node.js 22.12+（或更新的受支持LTS版本）、npm。

```powershell
git clone https://github.com/chensihan123-cpu/lingting-platform.git
cd lingting-platform
npm ci
npm run setup:model
npm run platform
```

在Edge中打开 **http://127.0.0.1:8765**，保持服务运行。私有仓库需要有访问权限才能克隆。
原单机Demo使用 `npm run dev`，地址为5173；六页平台使用上面的8765地址。

代码仓库包含前后端、测试、文档和公开演示音频；不包含 `node_modules`、构建产物、本机采集录音、数据库、日志及模型权重。
`npm run setup:model` 下载约91MB的量化ONNX文件，固定上游版本并校验SHA-256；已有完整模型会跳过下载，文件不匹配时停止而不覆盖。
默认从Hugging Face下载。如当前网络无法访问，可自行选择兼容镜像：`npm run setup:model -- --base https://hf-mirror.com`，下载内容仍须通过同一校验。
首次准备完成后，声音推理在本机运行；OpenStreetMap底图仍需要联网。

运行检查：`npm run test:platform`。功能清单见 [平台说明](platform/README.md)，规划见 [后续方案](platform/ROADMAP.md)，第三方来源见 [THIRD_PARTY.md](THIRD_PARTY.md)。

> 新增：六页生态声学监测平台位于 `platform/`。运行 `python platform/server.py`，用 Edge 打开 `http://127.0.0.1:8765`。包含后端归档、终端接口、复核与告警流程，详见 [平台使用说明](platform/README.md)。下文仍是原单机 Demo 的说明。

这是根据《灵听--智能自适应环境声识别系统》论文整理出的电脑端 MVP。它能直接在 VS Code 中启动，用浏览器麦克风或音频文件完成：

1. 音频采集；
2. 单声道转换、16 kHz 重采样、10 秒切片；
3. 真实 Audio Spectrogram Transformer（AST）推理；
4. Top-5 事件与置信度展示；
5. 火警、道路、照护、访客等特定场景唤醒；
6. 事件日志和伪标签样本池。

## 在 VS Code 运行

要求：Node.js 22.12 或更新的受支持LTS版本。

```powershell
npm install
npm run dev
```

在 VS Code 终端看到地址后，用浏览器打开 `http://127.0.0.1:5173`。点击“监听 10 秒”并允许麦克风权限，或上传 WAV / MP3 / M4A 等音频。

如果只是要快速展示，点击“运行演示样例”，系统会对项目内置的公开猫叫音频执行同一套真实 AST 推理，并显示 Top-5 结果。

也可以直接双击 `start-demo.cmd`；它会在首次运行时自动执行 `npm install`，随后启动开发服务器。

运行 `npm run setup:model` 后，量化 ONNX 模型位于 `public/models/`，浏览器直接从本地服务器加载，不需要在推理时连接模型网站。原单机Demo在浏览器中运行；新平台则将录音提交到本机Python服务归档和分析。

## 验证命令

```powershell
npm run build
npm run smoke:model
```

`build` 验证前端可构建；`smoke:model` 下载公开猫叫样例并验证模型能输出 `Meow/Cat`。模型冒烟测试需要联网。

## 这版与论文的对应关系

| 论文描述 | Demo 实现 |
| --- | --- |
| `torchaudio.load()` 与格式统一 | 浏览器 `decodeAudioData()` / 麦克风 PCM |
| 16 kHz、单声道 | Web Audio 解码后线性重采样 |
| 10 秒切片 | 文件自动分段，麦克风默认录制 10 秒 |
| AudioTransformer | MIT AST 的 Transformers.js/ONNX 版本 |
| 置信度筛选 | 可调阈值，默认 0.25，同时始终展示 Top-5 |
| 特定场景唤醒 | 标签模式 + 阈值规则 |
| 伪标签自适应 | 先写入本地待复核样本池，可导出 JSON |

## 为什么没有直接“在线微调”

论文只描述了伪标签、BCE 和 `optimizer.step()`，但没有给数据集、类别映射、权重、学习率、回放策略和防遗忘方案。未复核的伪标签直接在线更新会放大误判。因此 MVP 先完成“高置信度收集 → 人工复核 → 导出”，下一阶段再在 Python/PyTorch 训练端做增量微调。

## 后续迁移到树莓派 / ESP32

- 浏览器端先保留为展示与配置界面；
- 树莓派 5 使用 ONNX Runtime 或 PyTorch 执行同一 AST/轻量模型；
- INMP441 通过 I2S 采样，统一为 16 kHz 单声道 PCM；
- ESP32 负责采集/传输，不建议运行完整 AST；
- 多终端声源定位需要至少两台同步设备、实测时钟误差和 TDOA 算法，不能由单机 Demo 证明；
- ATGM336H 常见定位授时能力不等于论文宣称的多终端毫秒级音频同步，迁移前需要实测 PPS/串口时间戳链路。

## 目录

```text
index.html              页面结构
src/main.js             录音、预处理、规则、日志
src/model.worker.js     AST 模型加载与推理（Web Worker）
src/style.css           页面样式
scripts/smoke-model.mjs 模型冒烟测试
```
