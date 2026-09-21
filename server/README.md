# Ranzhuo AI Gateway

本地 AI 能力网关，面向桌面端运行。它解决三个问题：

- 浏览器直连第三方模型时的 CORS 限制
- 不同模型供应商的协议差异
- Agent、RAG、日志与评测能力缺少统一入口

## 启动

```powershell
npm run gateway
```

默认监听 `http://127.0.0.1:8787`，不会对局域网开放。

## 环境变量

```powershell
$env:DEEPSEEK_API_KEY="sk-..."
$env:OPENAI_API_KEY="sk-..."
$env:RANZHUO_GATEWAY_PORT="8787"
```

也可以由桌面前端在本地请求中携带供应商密钥。

## API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态、可用供应商和工具 |
| POST | `/api/chat/stream` | SSE 流式模型对话 |
| POST | `/api/agent/run` | 带工具调用循环的 Agent |
| POST | `/api/memory/extract` | 从会话提取结构化长期记忆 |
| POST | `/api/rag/documents` | 文档切块、向量化与入库 |
| GET | `/api/rag/documents` | 知识库文档列表 |
| POST | `/api/rag/search` | 向量相似度检索 |
| GET | `/api/metrics` | 调用成功率、延迟和字符量 |
| GET | `/api/logs` | 最近 300 条调用记录 |

当前 RAG 使用本地字符 n-gram 哈希向量，适合离线演示和工程联调，不依赖额外模型服务。
