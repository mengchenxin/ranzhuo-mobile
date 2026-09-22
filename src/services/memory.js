function memoryTokens(text) {
  const units =
    String(text || "")
      .toLowerCase()
      .match(/[a-z0-9_]+|[\u3400-\u9fff]/g)?.map(String) || [];
  const tokens = [...units];
  for (let index = 0; index < units.length - 1; index += 1) {
    if (
      /[\u3400-\u9fff]/.test(units[index]) &&
      /[\u3400-\u9fff]/.test(units[index + 1])
    ) {
      tokens.push(units[index] + units[index + 1]);
    }
  }
  return tokens;
}

export function selectRelevantMemories(query, character, limit = 5) {
  const memories = character?.memoryItems?.length
    ? character.memoryItems
    : character?.memory
      ? [
          {
            type: "summary",
            content: character.memory,
            importance: 4,
            confidence: 1,
          },
        ]
      : [];
  const queryTokens = new Set(memoryTokens(query));

  const ranked = memories
    .map((memory, index) => {
      const contentTokens = new Set(memoryTokens(memory.content));
      let overlap = 0;
      for (const token of queryTokens) {
        if (contentTokens.has(token)) overlap += 1;
      }
      const lexical = overlap / Math.sqrt(Math.max(1, queryTokens.size));
      const importance = (Number(memory.importance) || 3) / 5;
      const confidence = Number(memory.confidence) || 0.8;
      const recency = 1 - index / Math.max(1, memories.length);
      return {
        ...memory,
        score:
          lexical * 0.62 +
          importance * 0.16 +
          confidence * 0.12 +
          recency * 0.1,
      };
    })
    .sort((left, right) => right.score - left.score);
  const relevant = ranked.filter((memory) => memory.score >= 0.34);
  return (relevant.length ? relevant : ranked.slice(0, 1)).slice(0, limit);
}

export function buildLocalDemoReply(text, character) {
  const normalized = String(text || "").trim();
  const name = character?.name || "角色";

  if (/你好|嗨|在吗|早上好|晚上好/.test(normalized)) {
    return `${name}在。这里是本地演示模式，不需要 API Key 也能体验聊天界面。你可以在“我的 -> 模型与接口”中填写自己的 DeepSeek Key，切换到真实模型回复。`;
  }

  if (/模型|deepseek|openai|ollama|rag|agent|网关/i.test(normalized)) {
    return "这个项目通过 AI Gateway 统一接入 DeepSeek、OpenAI 和 Ollama，并包含 SSE 流式输出、工具调用 Agent、BM25 + 向量混合 RAG、长期记忆和调用评测。当前是离线演示回复，真实模型回答需要你自己的 API Key。";
  }

  if (/记忆|记得|上次|之前/.test(normalized)) {
    const memories = selectRelevantMemories(normalized, character, 2);
    if (memories.length) {
      const memoryText = memories
        .map((memory) => memory.content.replace(/[。！？；;]+$/, ""))
        .join("；");
      return `我记得这些：${memoryText}。这是基于本地记忆相关性筛选出的演示回复。`;
    }
  }

  return `我收到你说的“${normalized.slice(
    0,
    80,
  )}”。当前运行在本地演示模式，我可以展示界面、记忆检索和工程流程；填写自己的 DeepSeek Key 后，我会用真实模型继续回应。`;
}
