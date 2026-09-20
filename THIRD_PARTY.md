# 第三方组件与资源

本仓库的发布不改变第三方组件、模型或数据的原有许可；依赖许可见各上游仓库及npm包。

- [Transformers.js](https://github.com/huggingface/transformers.js)：用于本地模型预处理和推理。
- [ONNX转换模型](https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593)：由安装脚本从上游下载，权重不保存在Git历史中。
- [原始MIT AST模型](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593)及[AST研究代码](https://github.com/YuanGongND/ast)：模型与算法来源。具体许可须查看对应上游版本。
- `public/cat_meow.wav`：[公开示例来源](https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/cat_meow.wav)，仅作为接口与推理演示，不是用户采集的音频。进一步分发或商用前核对该资源上游许可。
- [Leaflet](https://leafletjs.com/)：交互式地图组件。
- [OpenStreetMap](https://www.openstreetmap.org/copyright)：地图底图数据。地图上保留来源署名，使用公共瓦片服务须遵守[瓦片政策](https://operations.osmfoundation.org/policies/tiles/)，本仓库不包含离线瓦片包。
- Vite、wavefile、linkedom：分别用于原Demo构建、WAV解码和DOM测试，版本固定在 `package-lock.json`。
