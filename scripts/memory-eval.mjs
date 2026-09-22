import {
  buildLocalDemoReply,
  selectRelevantMemories,
} from "../src/services/memory.js";

const character = {
  name: "江屿",
  memory: "用户最近在准备一个项目，不喜欢被催促。",
  memoryItems: [
    {
      type: "fact",
      content: "用户最近在准备一个很重要的项目。",
      importance: 5,
      confidence: 0.95,
    },
    {
      type: "preference",
      content: "用户喜欢晚上听爵士乐。",
      importance: 3,
      confidence: 0.9,
    },
    {
      type: "event",
      content: "用户上周去了海边。",
      importance: 2,
      confidence: 0.8,
    },
  ],
};

const relevant = selectRelevantMemories("我的项目最近进展怎么样", character, 2);
if (!relevant[0]?.content.includes("项目")) {
  throw new Error("Memory retrieval did not prioritize the project memory");
}

const demoReply = buildLocalDemoReply("你还记得我的项目吗？", character);
if (!demoReply.includes("项目")) {
  throw new Error("Demo reply did not use the relevant memory");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      selectedMemories: relevant.map((memory) => ({
        content: memory.content,
        score: Number(memory.score.toFixed(4)),
      })),
      demoReply,
    },
    null,
    2,
  ),
);
