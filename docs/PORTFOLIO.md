# 染酌小手机：AI 应用工程师项目说明

## 项目定位

染酌小手机是一个 Local First 的 AI Roleplay 与长期陪伴应用。项目将移动端拟真聊天、多模型适配、Agent 工具调用、长期记忆、本地 RAG 和调用观测整合在同一个产品中。

它不是简单的 Chat UI Demo，核心工程问题包括：

- 第三方模型接入的协议差异与浏览器 CORS
- 多轮角色一致性与上下文组装
- 长对话中的记忆提取与知识检索
- Agent 工具调用的循环控制、错误恢复和轨迹展示
- 本地优先场景下的数据、密钥和可观测性设计

## 系统架构

```text
React + Vite + Capacitor
        |
        | SSE / REST
        v
Ranzhuo AI Gateway (Node.js, 127.0.0.1)
        |
        +-- Provider Adapter
        |     +-- DeepSeek
        |     +-- OpenAI-compatible
        |     +-- Ollama
        |     +-- Custom endpoint
        |
        +-- Agent Runtime
        |     +-- search_knowledge
        |     +-- calculate
        |     +-- get_current_time
        |     +-- Zod argument validation
        |     +-- timeout and cancellation
        |
        +-- Local RAG
        |     +-- Document chunking
        |     +-- Configurable embedding provider
        |     +-- BM25 + vector hybrid search
        |     +-- Reranking and citations
        |
        +-- Observability
              +-- Latency
              +-- Success rate
              +-- Token usage
              +-- Tool trace
              +-- Golden-set evaluation
              +-- Request trace IDs
              +-- Provider circuit breaker

        +-- SQLite persistence
              +-- Documents and chunks
              +-- RAG indexes
              +-- Call logs
              +-- Evaluation suite
```

## 已实现的技术能力

### 1. 多模型供应商适配

统一的 OpenAI Chat Completions 协议适配层支持 DeepSeek、OpenAI、Ollama 和自定义兼容接口。前端只关心模型与角色，供应商鉴权和服务地址由适配层解析。

本地 Gateway 可持久化供应商、模型和密钥配置，并只向前端返回 `apiKeyConfigured` 状态，不返回原始密钥。服务重启和浏览器切换后仍可继续使用同一套模型配置。

### 2. 本地 Gateway 与 SSE 流式输出

本地 Gateway 固定监听 `127.0.0.1`，解决浏览器直连模型时的 CORS 限制。客户端通过 SSE 接收增量文本，实现流式角色回复。

### 3. Tool-calling Agent

Agent 会在模型与工具之间循环执行，最多运行 5 个业务步骤。每次模型调用、工具调用和工具结果都会形成可视化 Trace，且限制工具参数，避免执行任意代码。

### 4. 本地 RAG

文档经过重叠切块后转为本地字符 n-gram 哈希向量，通过余弦相似度检索。聊天请求会先检索角色相关知识，再以结构化上下文注入提示词。

### 5. AI 工作台

桌面端新增 AI 工作台，用于演示：

- Agent 目标输入与执行轨迹
- 知识文档导入、删除与语义检索
- 模型调用成功率、平均延迟和字符量
- 最近 300 条请求日志

### 6. 工程评测与可靠性

AI 工作台内置可重复运行的评测套件，覆盖：

- Tool Calling 基础正确性与危险参数拦截
- Agent 工具返回结构契约
- RAG 入库、检索、命中与清理的完整闭环
- 可选真实模型连通性和回复验证

Provider 层对 429、5xx 和网络错误执行指数退避重试，并记录实际请求次数。用户在设置中可以主动测试模型连通性，聊天生成过程中也可以随时停止。

### 7. 长期记忆工作流

模型不会直接改写角色记忆。应用先从最近会话中提取结构化候选，展示类型、重要度和置信度，再由用户确认、去重后写入角色长期记忆。

### 8. 生产可靠性

- 主模型失败后在未产生增量输出时自动切换备用模型
- 连续失败达到阈值后打开 Provider 熔断器，冷却后自动恢复探测
- Agent 工具参数经过 Zod Schema 严格校验
- Agent 支持执行超时、工具调用上限和取消信号
- 聊天请求返回 Trace ID，并在消息来源区域展示
- 知识库支持 PDF、DOCX、TXT、Markdown、CSV 和 JSON 文件导入

## 可以写进简历的项目描述

> 基于 React、Capacitor 与 Node.js 设计 Local First AI Roleplay 应用，构建统一模型网关，支持 DeepSeek、OpenAI、Ollama 等接口的 SSE 流式对话；实现工具调用 Agent、本地 RAG、角色长期记忆与调用链路观测，解决第三方 API CORS、多供应商协议差异和角色上下文一致性问题。

## 简历要点

- 设计并实现多供应商 LLM Gateway，通过统一 Chat Completions 适配层支持 DeepSeek、OpenAI 与 Ollama，并通过 SSE 实现低延迟流式输出。
- 实现最多 5 步的 Tool-calling Agent Runtime，包含工具 Schema、执行循环、参数约束、错误回传和可视化执行 Trace。
- 构建 Local First RAG 流程，完成文档切块、可配置 Embedding、BM25 + 向量混合检索、重排序、来源引用和角色级知识隔离。
- 实现角色上下文组装、长期记忆抽取和相关性检索，将角色设定、知识检索结果和当前问题需要的记忆动态注入模型输入。
- 建立调用观测面板，统计成功率、延迟、Token/字符量和接口状态，并保留最近 300 条无敏感正文的调用日志。
- 构建 18 项确定性 AI 工程评测套件，覆盖 Tool Calling、Schema 校验、RAG Hit@3、MRR、关键词覆盖和真实模型连通性；当前 Hit@3 与 MRR 均为 100%。
- 为 Provider 层增加指数退避重试、停止生成和 SQLite 调用日志持久化，并提供无需额外 Token 的本地演示模式。
- 使用 React、Vite 与 Capacitor 构建移动端优先、桌面端增强的跨端应用，Android 原生工程可同步运行。

## 验证方式

```powershell
npm run test:gateway
npm run eval:ai
npm run build
```

`test:gateway` 会启动独立测试端口，验证健康检查、RAG 入库、相似度检索和删除链路，不需要消耗第三方模型额度。

`eval:ai` 会运行 4 个确定性的 AI 工程评测用例。添加 `-- --live` 且配置 `DEEPSEEK_API_KEY` 后，会追加一次真实模型调用测试。

## 后续工程路线

1. 使用真实 Embedding 模型替换哈希向量，并加入重排序。
2. 为记忆系统增加事实去重、时间衰减和冲突处理。
3. 增加角色一致性、工具选择准确率和 RAG 命中率等在线模型评测。
4. 增加熔断、模型自动降级和跨供应商回退策略。
5. 使用 SQLite 替换 JSON 存储，增加事务和迁移机制。
6. 将本地 Gateway 打包为桌面 sidecar，增加系统托盘与安全密钥存储。
