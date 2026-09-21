import crypto from "node:crypto";
import { executeTool, safeCalculate } from "./agent.mjs";
import { createChatCompletion } from "./providers.mjs";
import {
  deleteDocument,
  ingestDocument,
  searchKnowledge,
} from "./rag.mjs";

async function runCase(id, name, runner) {
  const startedAt = Date.now();
  try {
    const details = await runner();
    return {
      id,
      name,
      passed: true,
      latencyMs: Date.now() - startedAt,
      details,
    };
  } catch (error) {
    return {
      id,
      name,
      passed: false,
      latencyMs: Date.now() - startedAt,
      error: error.message,
    };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runRagRoundtrip() {
  const marker = "RANZHUO_EVAL_" + crypto.randomUUID().replace(/-/g, "");
  const document = await ingestDocument({
    title: "AI 工程评测临时资料",
    text:
      "这条资料用于验证本地 RAG 检索链路。唯一验证标记是 " +
      marker +
      "。",
    characterId: "shared",
    source: "evaluation",
  });

  try {
    const results = await searchKnowledge(marker, {
      limit: 3,
      characterId: "shared",
    });
    assert(results.length > 0, "知识库检索没有返回结果");
    assert(
      results[0].content.includes(marker),
      "检索结果没有命中预期验证标记",
    );
    assert(results[0].score > 0, "检索相似度必须大于 0");
    return {
      topScore: Number(results[0].score.toFixed(4)),
      topTitle: results[0].title,
      chunks: document.chunks.length,
    };
  } finally {
    await deleteDocument(document.id);
  }
}

export async function runEvaluationSuite({
  providerConfig,
  includeLive = false,
}) {
  const startedAt = Date.now();
  const cases = [];

  cases.push(
    await runCase("tool.calculate.basic", "工具调用：基础计算", async () => {
      const result = await executeTool("calculate", {
        expression: "12 * (8 + 7)",
      });
      assert(result.result === 180, "计算结果应为 180");
      return result;
    }),
  );

  cases.push(
    await runCase("tool.calculate.guard", "工具调用：阻止代码执行", async () => {
      let blocked = false;
      try {
        safeCalculate("process.exit()");
      } catch {
        blocked = true;
      }
      assert(blocked, "危险表达式必须被拒绝");
      return { blocked };
    }),
  );

  cases.push(
    await runCase("tool.time.contract", "工具调用：时间返回结构", async () => {
      const result = await executeTool("get_current_time", {});
      assert(result.iso, "必须返回 ISO 时间");
      assert(!Number.isNaN(Date.parse(result.iso)), "ISO 时间必须可解析");
      return { iso: result.iso };
    }),
  );

  cases.push(
    await runCase("rag.roundtrip", "RAG：入库与检索闭环", runRagRoundtrip),
  );

  if (includeLive) {
    cases.push(
      await runCase("provider.live_reply", "模型：真实接口回复", async () => {
        const payload = await createChatCompletion({
          providerConfig: {
            ...providerConfig,
            temperature: 0,
          },
          messages: [
            {
              role: "user",
              content: "只回复：AI_EVAL_OK",
            },
          ],
          maxTokens: 12,
        });
        const content = payload.choices?.[0]?.message?.content?.trim() || "";
        assert(content.length > 0, "模型没有返回文本");
        return {
          sample: content.slice(0, 80),
          attempts: payload.gatewayMeta?.attempts || 1,
          usage: payload.usage || null,
        };
      }),
    );
  }

  const passed = cases.filter((testCase) => testCase.passed).length;
  return {
    suite: "ranzhuo-ai-foundation",
    includeLive,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    score: cases.length ? passed / cases.length : 0,
    cases,
  };
}
