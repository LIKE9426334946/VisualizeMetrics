# VisualizeMetrics

深度学习训练指标可视化工作台。选择或拖入训练得到的 CSV，自动识别表头、比较实验、查看最佳 Epoch，并导出高清 PNG / SVG。

**部署：`http://服务器IP:16045` → Nginx → `127.0.0.1:3045`。**

所有 CSV 均在浏览器内读取。Node.js 只提供静态文件和健康检查，没有上传接口、数据库或登录系统。页面代码与依赖均由自己的服务器提供，不依赖外部 CDN。文件、名称及设置只保存在当前页面内存中，刷新后需重新导入。

## 功能

- 点击上传或拖拽，一个或多个 CSV 同时导入；首次导入自己的文件时自动替换模拟示例。
- 自动识别所有数值指标，支持单选、多选、全选、取消全部、图例点击隐藏、整份文件隐藏。
- 每份文件可修改模型名称和 X 轴字段；默认使用 `epoch`，没有该列时使用从 1 开始的数据行号。
- 多文件比较同一指标，或同时绘制不同指标；每份文件保留自己的 Epoch 范围，不要求行数相等。
- 每条曲线独立选择不标记 / Max / Min / 两者，标注原始数值及 Epoch。
- 统计面板显示 Max、Min、对应 Epoch、Last、有效点数；下拉切换需要查看的曲线。
- 鼠标悬停显示原始 CSV 数值；Ctrl + 滚轮缩放，缩放后拖动平移，底部滑块选择范围；支持重置缩放。手机可使用滑块与双指手势。
- 修改标题、坐标轴名称、网格、数据点、图例和线宽，实时生效。
- PNG 支持 1600 × 960、2400 × 1440、4800 × 2880；SVG 为可缩放矢量图。导出保留当前缩放范围、可见曲线、标题、轴名称、图例设置和极值标记。
- 原始表格按 CSV 表头生成，支持横向滚动、列排序、全文搜索、分页、原始值及 2/4/6/8 位小数显示。
- 适配电脑和手机；示例数据明确标记为模拟数据，不代表真实训练结果。

## CSV 与计算规则

```csv
epoch,train_loss,val_loss,val_iou,val_f1,val_precision,val_recall
1,0.821,0.753,0.188029,0.316540,0.412,0.271
2,0.714,0.641,0.245671,0.394438,0.498,0.326
3,0.610,0.569,0.302167,0.464099,0.542,0.405
```

上面只是示例；应用并未将这些指标名写死。自定义字段如 `learning_rate`、`dice`、`custom_score` 均可识别。首次导入默认勾选前两个数值指标，标题使用第一个文件名（去掉 `.csv`）。多文件图例使用“模型名称 - 原始指标名称”；在左侧名称框中可将 `unetpp` 改为 `UNet++`。

- 支持 UTF-8（含 BOM）、Windows / Linux 换行、带逗号或换行的引号字段，以及 Papa Parse 识别的常见分隔符。
- 仅有限十进制数值参与计算，支持正负数、小数和科学计数法。空值、`NaN`、`Infinity`、文字不会被当成 0，不进行插值。
- 至少有一个有效数值的列可作为指标；纯文字、全空或全无效列保留在表格中。
- X 轴无效的行不参与绘图和统计，但保留在原始表格；Y 轴无效的位置显示断点。
- 被空值隔开的孤立有效点会保留点标记，避免单行或稀疏数据看起来像空图。
- 绘图按数值 X 轴升序排列；相同 X 值按原始行序保留，不自动平均或删除。
- 极值基于该指标全部有效点计算，与缩放、表格搜索及排序无关。并列时显示最早的 Epoch，并在统计中提示并列次数。Last 为最后一个有效 Epoch 的值；末行缺失时回退到前一个有效点。
- 缩放范围之外的极值不会显示在当前图中；点击“重置缩放”查看完整曲线及极值。
- 表格精度仅影响显示，不改变曲线、统计和原始数值。Tooltip 和极值标记保留原始 CSV 数值字符串；统计卡片显示 6 位小数，悬停可查看原始数值。
- 重复表头使用列号区分，空白表头生成名称；列数不一致时补空或保留额外列，并显示提示。
- 图表数值运算使用 JavaScript Number（IEEE 754 双精度）；原始字符串保留在表格 / Tooltip 中。
- 每个文件最大 50 MB。CSV 解析在 Web Worker 中进行，表格每页展示 10 行；大量文件/数据仍受浏览器可用内存限制。

## 项目结构

```text
VisualizeMetrics/
├── backend/server.js             # Node 原生 HTTP 静态服务；默认 127.0.0.1:3045
├── frontend/
│   ├── index.html                # 工作台、设置对话框
│   ├── public/favicon.svg
│   └── src/
│       ├── csv.js                # Papa Parse 解析、表头和列检查
│       ├── csv-worker.js         # 后台解析线程
│       ├── data.js               # 曲线数据、极值统计、表格排序
│       ├── chart.js              # Apache ECharts 图表与交互
│       ├── export.js             # PNG 和 SVG 导出
│       ├── main.js               # 页面状态和交互
│       ├── styles.css            # 响应式页面样式
│       ├── demo.js               # 有明确标注的模拟训练数据
│       ├── icons.js
│       └── utils.js
├── deploy/
│   ├── VisualizeMetrics.service
│   ├── VisualizeMetrics.nginx
│   └── install.sh
├── tests/data.test.js
├── package.json
├── package-lock.json
└── vite.config.js
```

技术栈：原生 JavaScript + Vite、Apache ECharts、Papa Parse、Node.js 原生 HTTP 模块。运行时不需要复杂后端。`dist/` 由构建生成，不提交到 Git。

## Ubuntu 服务器部署

所有命令使用 **root** 执行，项目放在 `/opt/VisualizeMetrics`。已有其他项目时无需修改它们的端口或 Nginx 配置。

### 1. 环境准备

需要 Node.js **22.12 或更高**，推荐 Node.js 24。systemd 配置使用 `/usr/bin/node`，请确认该路径存在且版本符合要求；如果使用 nvm，请安装系统级 Node.js 或将服务文件的 `ExecStart` 改为实际绝对路径。

```bash
apt-get update
apt-get install -y git nginx curl ca-certificates
/usr/bin/node --version
npm --version
```

如果尚未安装符合要求的 Node.js，可使用 NodeSource 安装 Node.js 24（已有符合要求的版本则跳过）：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-24-setup.sh
bash /tmp/nodesource-24-setup.sh
apt-get install -y nodejs
```

### 2. 拉取 main 分支并部署

```bash
mkdir -p /opt/VisualizeMetrics
git clone --branch main https://github.com/LIKE9426334946/VisualizeMetrics.git /opt/VisualizeMetrics
cd /opt/VisualizeMetrics
bash deploy/install.sh
```

脚本依次安装依赖、构建前端、复制 systemd / Nginx 配置、建立软链接、执行 `nginx -t`、启用并启动服务。已运行的 Nginx 使用 reload 应用配置。

### 3. 手动部署步骤

与上面的脚本二选一即可；以下列出完整操作供排查或手动维护。

```bash
cd /opt/VisualizeMetrics
npm ci
npm run build

cp deploy/VisualizeMetrics.service /etc/systemd/system/VisualizeMetrics.service
cp deploy/VisualizeMetrics.nginx /etc/nginx/sites-available/VisualizeMetrics
ln -sfn /etc/nginx/sites-available/VisualizeMetrics /etc/nginx/sites-enabled/VisualizeMetrics

nginx -t
systemctl daemon-reload
systemctl enable VisualizeMetrics
systemctl start VisualizeMetrics
systemctl enable nginx
systemctl start nginx
systemctl reload nginx
```

服务配置使用 `User=root`、`WorkingDirectory=/opt/VisualizeMetrics`、`NODE_ENV=production`、`HOST=127.0.0.1`、`PORT=3045`、`Restart=always`。Node 内部端口只监听回环地址。Nginx 独立监听 `16045`，代理到 `3045`，包含 Host、真实 IP、转发协议和 WebSocket 请求头。

### 4. 检查与访问

```bash
systemctl status VisualizeMetrics --no-pager
nginx -t
curl http://127.0.0.1:3045/health
curl http://127.0.0.1:16045/health
ss -lntp | grep -E ':(3045|16045)\b'
```

浏览器访问：

```text
http://服务器IP:16045
```

如果服务器启用了 UFW 或云安全组，放行 TCP `16045`；不需要向公网开放 `3045`。

```bash
# 仅在已经启用 UFW 时执行
ufw allow 16045/tcp
```

## 更新、日志和本地开发

更新已部署项目：

```bash
cd /opt/VisualizeMetrics
git pull --ff-only origin main
bash deploy/install.sh
```

查看日志或重启：

```bash
journalctl -u VisualizeMetrics -n 100 --no-pager
systemctl restart VisualizeMetrics
```

本地开发（开发服务只监听本机）：

```bash
npm ci
npm run dev
```

生产构建与本机服务：

```bash
npm test
npm run build
npm start
# http://127.0.0.1:3045
```

测试覆盖 CSV BOM/引号/换行、自定义/重复表头、行宽不一致、空值与非数值、无效 Epoch、极值并列、Last、不同模型 Epoch 长度及数值排序。
