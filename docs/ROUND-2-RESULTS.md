# 第二轮 AI 工程升级结果

## Provider 熔断与自动降级

- 主模型连续失败达到阈值后自动打开熔断器
- 熔断期间跳过主模型，直接请求备用模型
- 冷却时间结束后允许半开恢复探测
- 流式响应开始产生内容后不再切换模型，避免拼接两个模型的回答
- AI 工作台展示每个 Provider 的失败次数和熔断状态

自动化测试模拟主模型连续返回 `503`，备用模型返回正常 SSE：

```text
主模型失败 9 次
备用模型恢复成功
熔断器已打开
```

## Agent 工程化

- 工具参数使用 Zod 严格校验，拒绝 Schema 之外的额外字段
- Agent 增加总执行超时
- Agent 增加最大工具调用次数
- 支持继承外部 AbortSignal 取消执行
- Trace 记录每一步使用的 Provider、模型、耗时和是否发生降级

## 文件知识库

支持拖拽或选择：

- PDF
- DOCX
- TXT
- Markdown
- CSV
- JSON

解析后先填充知识库编辑区供用户检查，再手动建立索引，避免文件内容直接污染知识库。

## 请求 Trace

- Gateway 为每次聊天请求生成 Trace ID
- SSE `start` 事件向前端返回 Trace ID
- 回复气泡显示 Trace 前缀
- SQLite 调用日志保存 Trace ID
- Agent 响应同时返回 Trace ID

## 第二轮验证

```text
Gateway 并发日志       通过
Provider 自动降级      通过
Provider 熔断器        通过
Zod 工具参数校验       通过
18 项 AI 评测          通过
记忆相关性测试          通过
Vite 生产构建          通过
PDF/DOCX 动态模块       构建通过
```
