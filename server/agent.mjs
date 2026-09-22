import { z } from "zod";
import { createChatCompletionResilient } from "./providers.mjs";
import { searchKnowledge } from "./rag.mjs";

const toolSchemas = {
  search_knowledge: z
    .object({
      query: z.string().min(1).max(1000),
      limit: z.number().int().min(1).max(8).optional(),
    })
    .strict(),
  calculate: z
    .object({
      expression: z.string().min(1).max(80),
    })
    .strict(),
  get_current_time: z.object({}).strict(),
};

const tools = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description: "检索用户本地知识库，适用于需要事实资料的问答。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索问题" },
          limit: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "计算纯数学表达式，不执行代码。",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "仅包含数字、括号和 + - * / % 的表达式",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取当前本地日期与时间。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

export function validateToolArguments(toolName, args) {
  const schema = toolSchemas[toolName];
  if (!schema) throw new Error("未知工具：" + toolName);
  const validation = schema.safeParse(args);
  if (!validation.success) {
    throw new Error(
      "工具参数校验失败：" +
        validation.error.issues
          .map((issue) => issue.path.join(".") + " " + issue.message)
          .join("; "),
    );
  }
  return validation.data;
}

function safeCalculate(expression) {
  const normalized = String(expression || "").replace(/\s+/g, "");
  if (!/^[0-9+\-*/%.()]{1,80}$/.test(normalized)) {
    throw new Error("表达式包含不允许的字符");
  }

  const value = Function('"use strict"; return (' + normalized + ');')();
  if (!Number.isFinite(value)) throw new Error("计算结果不是有限数字");
  return value;
}

async function executeTool(toolName, args, context) {
  const validatedArgs = validateToolArguments(toolName, args);

  if (toolName === "search_knowledge") {
    const retrieval = await searchKnowledge(validatedArgs.query, {
      limit: validatedArgs.limit,
      characterId: context.characterId,
    });
    return {
      query: validatedArgs.query,
      results: retrieval.results.slice(0, 5),
      retrieval: retrieval.retrieval,
    };
  }

  if (toolName === "calculate") {
    return {
      expression: validatedArgs.expression,
      result: safeCalculate(validatedArgs.expression),
    };
  }

  if (toolName === "get_current_time") {
    return {
      iso: new Date().toISOString(),
      local: new Date().toLocaleString("zh-CN", {
        timeZone: process.env.TZ || "Asia/Shanghai",
      }),
    };
  }

  throw new Error("未知工具：" + toolName);
}

export async function runAgent({
  goal,
  providerConfig,
  fallbackProviderConfig,
  character,
  maxSteps = 4,
  maxToolCalls = Number(process.env.RANZHUO_AGENT_MAX_TOOL_CALLS || 8),
  timeoutMs = Number(process.env.RANZHUO_AGENT_TIMEOUT_MS || 60_000),
  signal,
}) {
  if (!goal?.trim()) throw new Error("请填写 Agent 目标");

  const messages = [
    {
      role: "system",
      content: [
        "你是染酌 AI 工作台中的任务执行 Agent。",
        "先判断是否需要工具，再逐步执行，不要编造工具结果。",
        "工具参数必须严格符合 Schema。",
        "最终回答要简洁，并说明哪些结论来自本地知识库。",
        character?.persona ? "当前角色设定：" + character.persona : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { role: "user", content: goal.trim() },
  ];
  const trace = [];
  const stepLimit = Math.max(1, Math.min(8, Number(maxSteps) || 4));
  const toolCallLimit = Math.max(1, Math.min(20, Number(maxToolCalls) || 8));
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 60_000);
  const totalUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  let hasUsage = false;
  let toolCallCount = 0;

  for (let step = 1; step <= stepLimit; step += 1) {
    if (signal?.aborted) throw new DOMException("Agent 已取消", "AbortError");
    if (Date.now() >= deadline) throw new Error("Agent 执行超时");

    const startedAt = Date.now();
    const remainingMs = Math.max(1, deadline - Date.now());
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(remainingMs)])
      : AbortSignal.timeout(remainingMs);
    const payload = await createChatCompletionResilient({
      providerConfig,
      fallbackProviderConfig,
      messages,
      tools,
      signal: requestSignal,
    });
    const message = payload.choices?.[0]?.message;
    if (!message) throw new Error("模型没有返回可执行结果");

    if (payload.usage) {
      hasUsage = true;
      totalUsage.prompt_tokens += Number(payload.usage.prompt_tokens) || 0;
      totalUsage.completion_tokens +=
        Number(payload.usage.completion_tokens) || 0;
      totalUsage.total_tokens += Number(payload.usage.total_tokens) || 0;
    }

    const toolCalls = message.tool_calls || [];
    trace.push({
      step,
      type: toolCalls.length ? "tool_call" : "answer",
      content: message.content || "",
      toolCalls: toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function?.name,
        arguments: toolCall.function?.arguments,
      })),
      latencyMs: Date.now() - startedAt,
      provider: payload.gatewayMeta?.provider,
      model: payload.gatewayMeta?.model,
      fallbackUsed: Boolean(payload.gatewayMeta?.fallbackUsed),
    });

    if (!toolCalls.length) {
      return {
        answer: message.content || "",
        trace,
        usage: hasUsage ? totalUsage : null,
        stoppedReason: "completed",
      };
    }

    messages.push(message);
    for (const toolCall of toolCalls) {
      toolCallCount += 1;
      if (toolCallCount > toolCallLimit) {
        throw new Error("Agent 工具调用次数超过上限");
      }

      const name = toolCall.function?.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || "{}");
      } catch {
        args = {};
      }

      try {
        const result = await executeTool(name, args, {
          characterId: character?.id,
        });
        trace.push({ step, type: "tool_result", name, result });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      } catch (error) {
        const result = {
          error: error.message,
          type: "validation_error",
        };
        trace.push({ step, type: "tool_error", name, result });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }
  }

  return {
    answer: "Agent 已达到最大执行步数，请缩小任务范围后重试。",
    trace,
    usage: hasUsage ? totalUsage : null,
    stoppedReason: "max_steps",
  };
}

export { executeTool, safeCalculate, tools };
