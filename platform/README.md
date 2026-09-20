# 灵听生态声学监测平台 · 本地验证版

新增平台位于 `platform/`，原有 `index.html + src/` 单机 Demo 保留。

## 启动

在项目根目录运行：

```powershell
python platform/server.py
```

也可以双击根目录的 `start-platform.cmd`。打开 Edge，访问 **http://127.0.0.1:8765**。
保持服务窗口运行。原单机 Demo 的 `npm run dev` / 5173 地址与新平台不同。
要求 Python 3.10+ 和 Node.js；Python 后端不需要安装额外包，Node 复用项目现有依赖及本地 ONNX 模型。
从GitHub克隆后，在项目根目录执行 `npm ci` 和 `npm run setup:model`，再启动平台。正常推理不访问外部模型站点。

## 第一次使用（约5分钟）

1. 在“监测总览”点击“运行模拟终端样例”。系统会自动勾选“包含模拟数据”。
2. 在“音频档案”等待状态从排队、识别中变为已归档；首次加载模型可能较慢。
3. 点击“回放 / 详情”听归档猫叫；查看关联的真实 Meow / Cat 候选。
4. 在“识别与复核”点击“查看”，确认结果或填写纠正标签，然后保存。
5. 刷新页面再次查看，确认录音、复核和变更历史仍存在。
6. 在“趋势分析”查看小时分布、声音类别、逐日采集时长和点位对比。
7. 点击“上传 / 采集录音”，选择“本机采集站”，上传文件或录制10秒。
8. 测试敲门/咳嗽时，在安静环境连续发声数次。再次点击录音按钮会停止并上传，而不是取消。
9. 如果模型输出命中规则且超过阈值，进入“告警处理”，填写负责人、派单，再补充说明结案。
10. 猫叫/拍手没有配置告警规则，识别成功也不会自动出现告警；真实识别不保证每次命中。

模拟设备、模拟音频都显式标注；默认统计不含模拟数据。页面每3秒更新，打开对话框时不刷新表单。
本机采集站没有预设地理坐标。在“设备地图”登记有坐标的新终端可显示点位。

## 已实现与边界

| 模块 | 已实现 |
|---|---|
| 监测总览 | 在线终端、今日识别片段、待处理告警、归档时长、最近事件 |
| 设备地图 | Leaflet + OpenStreetMap真实底图、缩放/拖动、终端弹窗与录音入口、离线点位回退、90秒心跳判断 |
| 音频档案 | WAV持久保存、文件/终端/日期筛选、回放、下载、排队状态、失败重试 |
| 识别与复核 | 本地AST、10秒分段、Top-10存储/Top-5展示、确认/纠正/驳回、审计记录 |
| 趋势分析 | 昼夜分布、类别构成、逐日录音时长/片段数、每录音小时归一化、点位比较 |
| 告警处理 | 阈值与类别匹配、待处理/派单/结案/误报、负责人、说明、历史记录 |

地图已接入OpenStreetMap街道底图，**不是卫星影像或声源定位**；网络失败时可手动切回离线经纬度点位图。
派单目前是本地数据库记录，没有接通知、巡护账号或无人机控制接口。
没有实现具体鸟种/两栖物种模型、模型微调、生态恢复推断、连续后台麦克风监听。
长周期统计逻辑已具备基础，但目前没有真实季节数据，不能验证季节规律。
每条上传限制0.1～120秒，网页支持浏览器可解码的格式并转为16kHz单声道PCM WAV；终端须自行规范化。
此版本仅绑定127.0.0.1，不带账号系统，不用于直接公网部署。真实板子联网接入前需增加认证、HTTPS、网络配置和上传配额。

## 地图使用（2026-09-20更新）

打开“设备地图”，勾选“包含模拟数据”即可查看已有示例终端。拖动地图、使用＋/−缩放，点击终端查看状态、电量、事件与录音入口。“定位全部终端”会适配当前终端筛选；页面轮询不会重置用户视角或关闭弹窗。

目前按WGS84经纬度解释坐标，**没有自动进行GCJ-02/BD-09转换**。登记真实设备前先确认坐标来源。示例坐标不代表真实监测站。
Leaflet 1.9.4从本地node_modules提供，只有底图瓦片需要联网；地图请求不上传终端名称、录音或识别结果，但瓦片服务会收到浏览器常规网络信息和所请求的地图区域。
没有配置定位权限请求，也不会自动获取电脑位置。缺少地图依赖时在项目根目录运行 `npm install`，然后重启服务并刷新页面。

底图无法访问时，点击“离线点位图”；点击“重试在线地图”恢复。离线点位模式不包含下载的街道底图，不是离线地图缓存。
当前使用OSM官方标准瓦片，仅按用户当前视野加载，保留署名并采用浏览器正常HTTP缓存；不提供批量预取或离线下载。正式规模化部署应选择符合需求的瓦片服务或自托管开放数据。
参考：[Leaflet官方入门](https://leafletjs.com/examples/quick-start/)、[OSM瓦片使用政策](https://operations.osmfoundation.org/policies/tiles/)。

其余功能的实现路线、前置条件和验收标准见 [后续功能落地方案](ROADMAP.md)。

## 架构与模型

```text
网页录音/文件 或 终端模拟器
       ↓ HTTP JSON + WAV(base64)
Python HTTP 服务 → SQLite元数据 + data/audio/*.wav
       ↓ 单任务队列（重启恢复待处理任务）
持久 Node.js 进程 → 本地量化 AST / ONNX Runtime
       ↓ 每10秒片段结果
事件归档 → 人工复核 → 告警处理 / 时序统计
```

Python负责接口、验证、存储、任务和业务规则；为复用已有模型文件，推理进程使用Node.js和Transformers.js，不需要重新下载PyTorch权重。
模型为 `Xenova/ast-finetuned-audioset-10-10-0.4593`，它是MIT AST AudioSet权重的ONNX转换版本。
AST处理过程：16kHz波形 → 128维log-Mel特征 → 时频patch → Transformer → 527类logits。
新平台使用每类独立 **sigmoid** 得分，允许多个声音类别同时存在，不要求得分之和为1；通用Transformers.js音频pipeline默认softmax，平台已绕开该后处理。
依据：[AST官方训练/验证代码](https://github.com/YuanGongND/ast/blob/master/src/traintest.py)。
早期验证样例若使用旧得分方式，数据库保留 `score_method=softmax-legacy`；新记录为 `sigmoid`，两者阈值不可直接横比。
不足10秒的末段补零用于模型输入，但统计和回放保留真实时长。告警检查全部527类得分，页面只展示排名靠前候选。
每个窗口仅记录一个最优先命中的告警类型。复核保留原预测，不自动改写告警或训练模型。
数据库时间使用UTC ISO 8601，网页以本机时区显示；上传可填写原始采集时间。

## 终端模拟程序

```powershell
python platform/simulate_device.py
python platform/simulate_device.py --device sim-wetland --count 3 --interval 15
python platform/simulate_device.py --device sim-trail --file C:/audio/test.wav
```

模拟程序发送真实音频，不伪造模型识别。未运行时模拟终端会正常离线。
默认示例为项目自带猫叫，它用于验证接口，不是野外监测样本。

## 接口约定（对接学长）

所有写接口使用 `Content-Type: application/json`。错误以非2xx状态及 `{"error":"..."}` 返回。

| 接口 | 用途 / 关键字段 |
|---|---|
| `GET /api/state` | 查询设备、录音、事件、最近100条审计记录、模型状态 |
| `POST /api/devices` | 登记：`id,name,lat,lon,simulated`；坐标可同时为空 |
| `POST /api/heartbeat` | 心跳：`id,battery,storage`；后两项为百分比，可为空 |
| `POST /api/upload` | 上传：`device_id,audio,name,source,captured_at,threshold` |
| `POST /api/demo` | 上传内置猫叫样例到模拟林地终端 |
| `GET /audio/{id}.wav` | 获取归档音频 |
| `POST /api/retry/{recording_id}` | 仅重试失败任务 |
| `POST /api/events/{id}` | 复核或告警处理 |
| `GET /api/export` | 导出全部记录和审计历史，不包含音频二进制 |

上传 `audio` 是16kHz、16-bit PCM WAV的base64（单声道或双声道）。`captured_at` 可选，须带时区，如 `2026-09-18T16:00:00+08:00`；缺省使用服务器接收时间。`threshold` 默认0.25。
设备坐标在上传时保存快照，模拟标记继承注册设备，客户端不能通过上传字段伪装成真实设备。
复核示例：`{"action":"review","review":"corrected","label":"Knock"}`。
派单示例：`{"action":"alert","status":"assigned","assignee":"负责人","note":"待现场核实"}`。
结案示例：`{"action":"alert","status":"resolved","assignee":"负责人","note":"已现场核查"}`。

## 数据与测试

业务数据位于 `platform/data/`，停止服务后备份整个目录即可同时保存SQLite和录音。推理诊断在 `data/inference.log`。

```powershell
python -m unittest discover -s platform -p test_platform.py -v
node platform/test_frontend.mjs
node platform/test_map.mjs
```

后端测试使用独立临时数据库，覆盖音频校验、设备心跳、持久化、模拟标记、复核/派单/结案、同源限制和音频读取。
前端测试在DOM环境检查六页渲染、详情、输入转义、模拟/日期筛选及WAV编码；**不等于真实浏览器、麦克风权限或音频播放实测**。
地图测试使用模拟Leaflet接口验证坐标、弹窗转义、轮询保留视角/弹窗、底图失败提示、离线/在线切换及缺失组件回退；不自动请求公共地图瓦片。
