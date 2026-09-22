import crypto from "node:crypto";
import goldSet from "./eval-gold-set.json" with { type: "json" };
import { executeTool, runAgent, safeCalculate } from "./agent.mjs";
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
    const retrieval = await searchKnowledge(marker, {
      limit: 3,
      characterId: "shared",
    });
    const results = retrieval.results;
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
      strategy: retrieval.retrieval.strategy,
    };
  } finally {
    await deleteDocument(document.id);
  }
}

async function runGoldSetCases() {
  const documentIds = [];
  const cases = [];

  try {
    for (const document of goldSet.documents) {
      const ingested = await ingestDocument({
        title: document.title,
        text: document.content,
        characterId: "shared",
        source: "gold-set",
      });
      documentIds.push(ingested.id);
    }

    const reciprocalRanks = [];
    const keywordCoverage = [];

    for (const testCase of goldSet.retrievalCases) {
      cases.push(
        await runCase(testCase.id, "RAG 金标：" + testCase.query, async () => {
          const retrieval = await searchKnowledge(testCase.query, {
            limit: 3,
            characterId: "shared",
          });
          const results = retrieval.results;
          const rank = results.findIndex(
            (result) => result.title === testCase.expectedTitle,
          );
          assert(rank >= 0, "Top 3 未命中期望文档：" + testCase.expectedTitle);

          const topResult = results[rank];
          const matchedKeywords = testCase.keywords.filter((keyword) =>
            topResult.content.includes(keyword),
          );
          const coverage =
            matchedKeywords.length / Math.max(1, testCase.keywords.length);
          assert(coverage >= 0.6, "命中文档的关键词覆盖率低于 60%");

          reciprocalRanks.push(1 / (rank + 1));
          keywordCoverage.push(coverage);
          return {
            expectedTitle: testCase.expectedTitle,
            rank: rank + 1,
            coverage: Number(coverage.toFixed(3)),
            score: Number(topResult.score.toFixed(4)),
            scores: topResult.scores,
            strategy: retrieval.retrieval.strategy,
          };
        }),
      );
    }

    const retrievalSummary = {
      hitRate:
        cases.filter((testCase) => testCase.passed).length /
        Math.max(1, cases.length),
      mrr:
        reciprocalRanks.reduce((total, value) => total + value, 0) /
        Math.max(1, reciprocalRanks.length),
      keywordCoverage:
        keywordCoverage.reduce((total, value) => total + value, 0) /
        Math.max(1, keywordCoverage.length),
    };
    return { cases, retrievalSummary };
  } finally {
    for (const documentId of documentIds) {
      await deleteDocument(documentId);
    }
  }
}

function traceTools(trace) {
  return trace.flatMap((step) =>
    (step.toolCalls || []).map((tool) => tool.name),
  );
}

async function runLiveCases(providerConfig) {
  const cases = [];

  cases.push(
    await runCase("live.deepseek.reply", "模型：真实接口回复", async () => {
      const payload = await createChatCompletion({
        providerConfig: {
          ...providerConfig,
          temperature: 0,
        },
        messages: [
          {
            role: "user",
            content: goldSet.liveCases[0].prompt,
          },
        ],
        maxTokens: 16,
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

  for (const testCase of goldSet.liveCases.slice(1)) {
    cases.push(
      await runCase(testCase.id, "Agent 金标：" + testCase.goal, async () => {
        const result = await runAgent({
          goal: testCase.goal,
          providerConfig: {
            ...providerConfig,
            temperature: 0,
          },
          maxSteps: 3,
        });
        const usedTools = traceTools(result.trace);
        assert(
          usedTools.includes(testCase.expectedTool),
          "Agent 未调用期望工具：" + testCase.expectedTool,
        );
        return {
          answer: result.answer.slice(0, 300),
          usedTools,
          traceSteps: result.trace.length,
          usage: result.usage,
        };
      }),
    );
  }

  return cases;
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
    await runCase("tool.schema.strict", "工具调用：拒绝额外参数", async () => {
      let blocked = false;
      try {
        await executeTool("calculate", {
          expression: "1 + 1",
          unexpected: true,
        });
      } catch {
        blocked = true;
      }
      assert(blocked, "工具必须拒绝 Schema 之外的字段");
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

  const goldResult = await runGoldSetCases();
  cases.push(...goldResult.cases);

  if (includeLive) {
    cases.push(...(await runLiveCases(providerConfig)));
  } else {
    cases.push({
      id: "live.suite",
      name: "真实模型金标（未启用）",
      passed: true,
      skipped: true,
      latencyMs: 0,
      details: {
        cases: goldSet.liveCases.length,
        reason: "includeLive=false",
      },
    });
  }

  const passed = cases.filter((testCase) => testCase.passed).length;
  const retrievalCases = cases.filter((testCase) =>
    testCase.id.startsWith("rag."),
  );
  const retrievalHitRate =
    retrievalCases.filter((testCase) => testCase.passed).length /
    Math.max(1, retrievalCases.length);

  return {
    suite: "ranzhuo-ai-foundation-v2",
    includeLive,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    score: cases.length ? passed / cases.length : 0,
    metrics: {
      retrievalHitRate,
      retrievalMrr: goldResult.retrievalSummary.mrr,
      keywordCoverage: goldResult.retrievalSummary.keywordCoverage,
      averageLatencyMs: Math.round(
        cases.reduce((total, testCase) => total + testCase.latencyMs, 0) /
          Math.max(1, cases.length),
      ),
    },
    cases,
  };
}
