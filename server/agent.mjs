import { createChatCompletion } from "./providers.mjs";
import { searchKnowledge } from "./rag.mjs";

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
  if (toolName === "search_knowledge") {
    const retrieval = await searchKnowledge(args.query, {
      limit: args.limit,
      characterId: context.characterId,
    });
    return {
      query: args.query,
      results: retrieval.results.slice(0, 5),
      retrieval: retrieval.retrieval,
    };
  }

  if (toolName === "calculate") {
    return {
      expression: args.expression,
      result: safeCalculate(args.expression),
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
  character,
  maxSteps = 4,
}) {
  if (!goal?.trim()) throw new Error("请填写 Agent 目标");

  const messages = [
    {
      role: "system",
      content: [
        "你是染酌 AI 工作台中的任务执行 Agent。",
        "必要时调用工具，不要编造工具结果。",
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
  const totalUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  let hasUsage = false;

  for (let step = 1; step <= stepLimit; step += 1) {
    const startedAt = Date.now();
    const payload = await createChatCompletion({
      providerConfig,
      messages,
      tools,
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
        const result = { error: error.message };
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
