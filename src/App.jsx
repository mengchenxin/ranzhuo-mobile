import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Bookmark,
  BookOpen,
  Bot,
  BrainCircuit,
  Camera,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Heart,
  Image as ImageIcon,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Mic,
  Moon,
  MoreHorizontal,
  Music2,
  Paperclip,
  PenLine,
  Phone,
  Play,
  Plus,
  Radio,
  Search,
  SendHorizontal,
  Settings2,
  Share2,
  Square,
  FileText,
  Gauge,
  RefreshCw,
  Server,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  UsersRound,
  Video,
  Volume2,
  Wifi,
} from "lucide-react";
import { Avatar } from "./components/Avatar";
import { BottomNav } from "./components/BottomNav";
import { IconButton } from "./components/IconButton";
import { Sheet } from "./components/Sheet";
import { StatusBar } from "./components/StatusBar";
import {
  forumTopics,
  initialCharacters,
  initialThreads,
  moments as initialMoments,
  quickReplies,
} from "./data";
import { useLocalStorage } from "./hooks/useLocalStorage";
import {
  deleteKnowledgeDocument,
  extractMemories,
  getEvaluationCatalog,
  getGatewayHealth,
  getGatewayLogs,
  getGatewayMetrics,
  getGatewayProviderConfig,
  ingestKnowledgeDocument,
  listKnowledgeDocuments,
  runAgent,
  runEvaluationSuite,
  saveGatewayProviderConfig,
  searchKnowledge,
  streamGatewayChat,
  testProviderConnection,
} from "./services/aiGateway";

const runtimeGatewayUrl =
  import.meta.env.VITE_GATEWAY_URL ||
  (import.meta.env.DEV
    ? "http://127.0.0.1:8787"
    : typeof window !== "undefined"
      ? window.location.origin
      : "");

const defaultSettings = {
  api: {
    enabled: false,
    transport: "gateway",
    provider: "deepseek",
    gatewayUrl: runtimeGatewayUrl,
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-flash",
    temperature: 0.85,
  },
  voice: {
    autoPlay: true,
    voiceName: "跟随角色设定",
  },
  memory: {
    enabled: true,
    longTerm: true,
  },
  appearance: {
    compact: false,
    motion: true,
  },
};

function formatNow() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function formatLogTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function App() {
  const [characters, setCharacters] = useLocalStorage(
    "ranzhuo:characters",
    initialCharacters,
  );
  const [threads, setThreads] = useLocalStorage("ranzhuo:threads", initialThreads);
  const [moments, setMoments] = useLocalStorage("ranzhuo:moments", initialMoments);
  const [settings, setSettings] = useLocalStorage(
    "ranzhuo:settings",
    defaultSettings,
  );
  const [activeTab, setActiveTab] = useState("messages");
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState("");
  const [typingThreadId, setTypingThreadId] = useState(null);
  const activeRequestRef = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let active = true;
    const hydrateProviderConfig = async () => {
      if (!settings.api.gatewayUrl) return;
      try {
        const result = await getGatewayProviderConfig(settings.api.gatewayUrl);
        const stored = result.config || {};
        if (!active || !stored.configured) return;
        setSettings((current) => ({
          ...current,
          api: {
            ...current.api,
            ...stored,
            apiKey: "",
            enabled: Boolean(stored.enabled),
            transport: "gateway",
          },
        }));
      } catch {
        // The Gateway may be offline; local settings remain usable.
      }
    };
    hydrateProviderConfig();
    return () => {
      active = false;
    };
  }, []);

  const selectedThread = threads.find((thread) => thread.id === selectedThreadId);
  const selectedCharacter = characters.find(
    (character) => character.id === selectedCharacterId,
  );
  const unreadCount = characters.reduce(
    (total, character) => total + (character.unread || 0),
    0,
  );

  const activeCharacter = useMemo(() => {
    if (!selectedThread) return null;
    return characters.find(
      (character) => character.id === selectedThread.characterId,
    );
  }, [characters, selectedThread]);

  const openThread = (threadId) => {
    const thread = threads.find((item) => item.id === threadId);
    setSelectedThreadId(threadId);
    setSelectedCharacterId(null);
    if (thread) {
      setCharacters((current) =>
        current.map((character) =>
          character.id === thread.characterId
            ? { ...character, unread: 0 }
            : character,
        ),
      );
    }
  };

  const startCharacterChat = (characterId) => {
    const existing = threads.find((thread) => thread.characterId === characterId);
    if (existing) {
      openThread(existing.id);
      return;
    }

    const character = characters.find((item) => item.id === characterId);
    if (!character) return;

    const thread = {
      id: makeId("thread"),
      characterId,
      updatedAt: formatNow(),
      preview: "新的会话",
      messages: [
        {
          id: makeId("message"),
          role: "assistant",
          text: `我是${character.name}。你可以从任何一件小事开始说。`,
          time: formatNow(),
        },
      ],
    };
    setThreads((current) => [thread, ...current]);
    setSelectedThreadId(thread.id);
    setSelectedCharacterId(null);
  };

  const appendMessage = (threadId, message) => {
    setThreads((current) =>
      current.map((thread) => {
        if (thread.id !== threadId) return thread;

        const preview =
          message.type === "voice"
            ? `[语音] 00:${String(message.duration || 0).padStart(2, "0")}`
            : message.type === "image"
              ? "[图片]"
              : message.text;

        return {
          ...thread,
          updatedAt: message.time,
          preview,
          messages: [...thread.messages, message],
        };
      }),
    );
  };

  const handleSendMessage = async (thread, payload) => {
    const character = characters.find(
      (item) => item.id === thread.characterId,
    );
    const outgoing = {
      id: makeId("message"),
      role: "user",
      time: formatNow(),
      read: true,
      ...payload,
    };

    appendMessage(thread.id, outgoing);

    if (!settings.api.enabled) {
      notify("消息已保存在本机，连接模型后可继续对话");
      return;
    }

    const api = settings.api;
    const transport = api.transport || "gateway";
    const hasRequiredConfig =
      api.model &&
      (transport === "gateway"
        ? Boolean(api.gatewayUrl)
        : Boolean(api.baseUrl) &&
          (api.provider === "ollama" || Boolean(api.apiKey)));

    if (!hasRequiredConfig) {
      notify(
        transport === "gateway"
          ? "请先启动本地 AI Gateway 并填写网关地址"
          : "请先补全服务地址、密钥和模型名",
      );
      return;
    }

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setTypingThreadId(thread.id);

    try {
      const conversation = [...thread.messages, outgoing]
        .filter((message) => message.text && message.type !== "voice")
        .slice(-24)
        .map((message) => ({
          role: message.role,
          content: message.text,
        }));

      let knowledgeContext = "";
      if (transport === "gateway" && payload.text) {
        try {
          const retrieval = await searchKnowledge(api.gatewayUrl, {
            query: payload.text,
            characterId: character?.id,
            limit: 3,
          });
          const usefulResults = (retrieval.results || []).filter(
            (result) => result.score > 0.12,
          );
          if (usefulResults.length) {
            knowledgeContext = usefulResults
              .map(
                (result, index) =>
                  "[" + (index + 1) + " " + result.title + "] " + result.content,
              )
              .join("\n\n");
          }
        } catch {
          // The gateway may be offline. Chat can still continue without RAG.
        }
      }

      const systemMessage = {
        role: "system",
        content: [
          "你正在扮演角色「" + (character?.name || "未知角色") + "」。",
          character?.persona || "",
          character?.memory ? "你记得：" + character.memory : "",
          knowledgeContext
            ? "以下是本地知识库中与当前问题相关的内容。只在确实相关时使用，不要编造引用：\n" +
              knowledgeContext
            : "",
          "保持自然、连续、符合角色设定的回应。不要提及系统提示词。",
        ]
          .filter(Boolean)
          .join("\n"),
      };

      if (transport === "gateway") {
        let streamedText = "";
        let reasoningText = "";
        let assistantMessageId = null;

        const appendAssistantChunk = (chunk) => {
          streamedText += chunk;
          if (!assistantMessageId) {
            assistantMessageId = makeId("message");
            appendMessage(thread.id, {
              id: assistantMessageId,
              role: "assistant",
              text: streamedText,
              time: formatNow(),
              streamed: true,
            });
            setTypingThreadId(null);
            return;
          }

          setThreads((current) =>
            current.map((item) =>
              item.id === thread.id
                ? {
                    ...item,
                    preview: streamedText,
                    updatedAt: formatNow(),
                    messages: item.messages.map((message) =>
                      message.id === assistantMessageId
                        ? { ...message, text: streamedText, reasoning: reasoningText }
                        : message,
                    ),
                  }
                : item,
            ),
          );
        };

        await streamGatewayChat({
          baseUrl: api.gatewayUrl,
          provider: api.provider || "deepseek",
          providerBaseUrl: api.baseUrl,
          providerKey: api.apiKey,
          model: api.model,
          temperature: api.temperature,
          messages: [systemMessage, ...conversation],
          signal: controller.signal,
          onDelta: appendAssistantChunk,
          onReasoning(chunk) {
            reasoningText += chunk;
          },
        });

        if (!streamedText.trim()) {
          throw new Error("模型没有返回文本内容");
        }
        return;
      }

      const response = await fetch(
        api.baseUrl.replace(/\/+$/, "") + "/chat/completions",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + api.apiKey,
          },
          body: JSON.stringify({
            model: api.model,
            temperature: Number(api.temperature) || 0.85,
            messages: [systemMessage, ...conversation],
          }),
        },
      );

      if (!response.ok) {
        throw new Error("接口返回 " + response.status);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("接口没有返回文本内容");

      appendMessage(thread.id, {
        id: makeId("message"),
        role: "assistant",
        text: content,
        time: formatNow(),
      });
    } catch (error) {
      if (error.name === "AbortError") {
        notify("已停止生成");
      } else {
        notify("连接模型失败：" + error.message);
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
      }
      setTypingThreadId(null);
    }
  };

  const stopGeneration = () => {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setTypingThreadId(null);
    notify("已停止生成");
  };

  const createCharacter = (draft) => {
    const character = {
      id: makeId("character"),
      name: draft.name.trim() || "未命名角色",
      handle: draft.handle.trim() || "刚刚来到你的小手机",
      avatar: "",
      accent: draft.accent,
      online: true,
      affinity: 12,
      lastSeen: "刚刚在线",
      tags: draft.tags
        .split(/[,\s，]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 4),
      persona: draft.persona.trim() || "这个角色还没有写下自我介绍。",
      memory: "你们的故事刚刚开始。",
      unread: 0,
    };

    setCharacters((current) => [character, ...current]);
    setSheet(null);
    notify(`已创建角色「${character.name}」`);
  };

  const applyCharacterMemories = (characterId, memories) => {
    setCharacters((current) =>
      current.map((character) => {
        if (character.id !== characterId) return character;

        const existing = character.memoryItems?.length
          ? character.memoryItems
          : character.memory
            ? [
                {
                  type: "summary",
                  content: character.memory,
                  importance: 4,
                  confidence: 1,
                },
              ]
            : [];
        const merged = [...existing];

        for (const memory of memories) {
          const content = String(memory.content || "").trim();
          if (!content) continue;
          if (merged.some((item) => item.content === content)) continue;
          merged.push({
            type: memory.type || "fact",
            content,
            importance: Number(memory.importance) || 3,
            confidence: Number(memory.confidence) || 0.8,
            createdAt: new Date().toISOString(),
          });
        }

        return {
          ...character,
          memoryItems: merged.slice(-30),
          memory: merged
            .slice(-5)
            .map((item) => item.content)
            .join("；"),
        };
      }),
    );
  };

  const likeMoment = (momentId) => {
    setMoments((current) =>
      current.map((moment) =>
        moment.id === momentId
          ? {
              ...moment,
              liked: !moment.liked,
              likes: Math.max(0, moment.likes + (moment.liked ? -1 : 1)),
            }
          : moment,
      ),
    );
  };

  const renderTab = () => {
    if (selectedCharacter) {
      return (
        <CharacterDetail
          character={selectedCharacter}
          onBack={() => setSelectedCharacterId(null)}
          onChat={() => startCharacterChat(selectedCharacter.id)}
          onEdit={() => setSheet("edit-character")}
          notify={notify}
        />
      );
    }

    if (activeTab === "messages") {
      return (
        <MessagesView
          characters={characters}
          threads={threads}
          onOpenThread={openThread}
          onCompose={() => setSheet("create-character")}
          notify={notify}
        />
      );
    }

    if (activeTab === "contacts") {
      return (
        <ContactsView
          characters={characters}
          onSelectCharacter={setSelectedCharacterId}
          onCreate={() => setSheet("create-character")}
          notify={notify}
        />
      );
    }

    if (activeTab === "discover") {
      return (
        <DiscoverView
          characters={characters}
          moments={moments}
          onLikeMoment={likeMoment}
          onOpenCharacter={setSelectedCharacterId}
          notify={notify}
        />
      );
    }

    return (
      <MeView
        characters={characters}
        moments={moments}
        settings={settings}
        onOpenSheet={setSheet}
        notify={notify}
      />
    );
  };

  return (
    <div className="app-stage">
      <div className={`phone-shell ${sheet === "ai-lab" ? "is-expanded" : ""}`}>
        <StatusBar />
        {selectedThread && activeCharacter ? (
          <ChatView
            thread={selectedThread}
            character={activeCharacter}
            settings={settings}
            typing={typingThreadId === selectedThread.id}
            onBack={() => setSelectedThreadId(null)}
            onSend={(payload) => handleSendMessage(selectedThread, payload)}
            onStop={stopGeneration}
            onOpenSettings={() => setSheet("settings")}
            notify={notify}
          />
        ) : (
          <>
            <main className="app-content">{renderTab()}</main>
            <BottomNav
              activeTab={activeTab}
              unreadCount={unreadCount}
              onChange={(tab) => {
                setActiveTab(tab);
                setSelectedCharacterId(null);
              }}
            />
          </>
        )}

        {sheet === "ai-lab" ? (
          <AILabSheet
            settings={settings}
            characters={characters}
            onClose={() => setSheet(null)}
            notify={notify}
          />
        ) : null}

        {sheet === "settings" ? (
          <SettingsSheet
            settings={settings}
            onClose={() => setSheet(null)}
            onSave={(next) => {
              setSettings(next);
              setSheet(null);
              notify("设置已保存在本机");
            }}
          />
        ) : null}

        {sheet === "create-character" ? (
          <CreateCharacterSheet
            onClose={() => setSheet(null)}
            onCreate={createCharacter}
          />
        ) : null}

        {sheet === "memory" ? (
          <MemorySheet
            characters={characters}
            threads={threads}
            settings={settings}
            onClose={() => setSheet(null)}
            notify={notify}
            onApplyMemories={applyCharacterMemories}
          />
        ) : null}

        {sheet === "local-data" ? (
          <LocalDataSheet
            onClose={() => setSheet(null)}
            notify={notify}
            counts={{
              characters: characters.length,
              threads: threads.length,
              messages: threads.reduce(
                (total, thread) => total + thread.messages.length,
                0,
              ),
            }}
          />
        ) : null}

        {sheet === "edit-character" && selectedCharacter ? (
          <EditCharacterSheet
            character={selectedCharacter}
            onClose={() => setSheet(null)}
            onSave={(next) => {
              setCharacters((current) =>
                current.map((character) =>
                  character.id === next.id ? next : character,
                ),
              );
              setSheet(null);
              notify("角色设定已更新");
            }}
          />
        ) : null}

        {toast ? (
          <div className="toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AppHeader({ eyebrow, title, actions, className = "" }) {
  return (
    <header className={`app-header ${className}`}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
      </div>
      <div className="app-header__actions">{actions}</div>
    </header>
  );
}

function MessagesView({
  characters,
  threads,
  onOpenThread,
  onCompose,
  notify,
}) {
  const orderedThreads = [...threads].sort((a, b) => {
    const aCharacter = characters.find((item) => item.id === a.characterId);
    const bCharacter = characters.find((item) => item.id === b.characterId);
    if ((bCharacter?.unread || 0) !== (aCharacter?.unread || 0)) {
      return (bCharacter?.unread || 0) - (aCharacter?.unread || 0);
    }
    return 0;
  });

  return (
    <div className="view messages-view">
      <AppHeader
        eyebrow="RANZHUO"
        title="消息"
        actions={
          <>
            <IconButton
              icon={Search}
              label="搜索消息"
              onClick={() => notify("搜索会在会话较多时自动展开")}
            />
            <IconButton icon={Plus} label="发起会话" onClick={onCompose} />
          </>
        }
      />

      <section className="daily-note">
        <div className="daily-note__icon">
          <Sparkles size={20} />
        </div>
        <div>
          <span>今天也在小手机里</span>
          <p>不必想好要说什么，分享一个瞬间就够了。</p>
        </div>
        <ChevronRight size={18} />
      </section>

      <div className="section-heading">
        <span>最近会话</span>
        <span>{threads.length} 个房间</span>
      </div>

      <section className="conversation-list">
        {orderedThreads.map((thread) => {
          const character = characters.find(
            (item) => item.id === thread.characterId,
          );
          if (!character) return null;

          return (
            <button
              type="button"
              className="conversation-row"
              key={thread.id}
              onClick={() => onOpenThread(thread.id)}
            >
              <Avatar
                src={character.avatar}
                name={character.name}
                accent={character.accent}
                online={character.online}
                size={52}
              />
              <span className="conversation-row__body">
                <span className="conversation-row__top">
                  <strong>
                    {character.name}
                    {character.group ? <i>群聊</i> : null}
                  </strong>
                  <time>{thread.updatedAt}</time>
                </span>
                <span className="conversation-row__bottom">
                  <span>{thread.preview}</span>
                  {character.unread ? (
                    <b className="unread-dot">{character.unread}</b>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}

function ContactsView({
  characters,
  onSelectCharacter,
  onCreate,
  notify,
}) {
  const onlineCount = characters.filter((character) => character.online).length;

  return (
    <div className="view contacts-view">
      <AppHeader
        eyebrow={`${onlineCount} 位角色在线`}
        title="角色"
        actions={
          <>
            <IconButton icon={Search} label="搜索角色" onClick={() => notify("可以在下方角色列表中查找")} />
            <IconButton icon={UserPlus} label="创建角色" onClick={onCreate} />
          </>
        }
      />

      <section className="quick-actions">
        <button type="button" className="quick-action" onClick={onCreate}>
          <span className="quick-action__icon coral">
            <UserPlus size={21} />
          </span>
          <span>
            <strong>创建角色</strong>
            <small>写下新的相遇</small>
          </span>
        </button>
        <button
          type="button"
          className="quick-action"
          onClick={() => notify("群聊创建已保留在导航入口")}
        >
          <span className="quick-action__icon green">
            <UsersRound size={21} />
          </span>
          <span>
            <strong>创建群聊</strong>
            <small>让角色彼此认识</small>
          </span>
        </button>
      </section>

      <div className="section-heading">
        <span>你的角色</span>
        <button type="button" onClick={onCreate}>
          管理
        </button>
      </div>

      <section className="character-list">
        {characters.map((character) => (
          <button
            type="button"
            key={character.id}
            className="character-row"
            onClick={() => onSelectCharacter(character.id)}
          >
            <Avatar
              src={character.avatar}
              name={character.name}
              accent={character.accent}
              online={character.online}
              size={52}
            />
            <span className="character-row__copy">
              <span className="character-row__name">
                <strong>{character.name}</strong>
                {character.group ? <i>群聊</i> : null}
              </span>
              <span>{character.handle}</span>
            </span>
            <span className="affinity-mini">
              <i style={{ width: `${character.affinity}%` }} />
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
      </section>
    </div>
  );
}

function DiscoverView({
  characters,
  moments,
  onLikeMoment,
  onOpenCharacter,
  notify,
}) {
  return (
    <div className="view discover-view">
      <AppHeader
        eyebrow="发现一点新的共同经历"
        title="发现"
        actions={
          <>
            <IconButton
              icon={Music2}
              label="一起听"
              onClick={() => notify("一起听房间已准备好，可以从下方进入")}
            />
            <IconButton icon={Camera} label="发布动态" onClick={() => notify("动态发布入口将在下一版开放")} />
          </>
        }
      />

      <section className="listen-feature">
        <img
          src="https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=1200&q=84"
          alt=""
        />
        <div className="listen-feature__overlay" />
        <div className="listen-feature__top">
          <span>
            <Radio size={13} /> 一起听
          </span>
          <span>3 人房间</span>
        </div>
        <div className="listen-feature__content">
          <p>今晚 21:30</p>
          <h2>把耳机分给你一半</h2>
          <div className="listen-feature__track">
            <span className="playing-cover">
              <Music2 size={18} />
            </span>
            <span>
              <strong>Orange Ocean</strong>
              <small>夏日漱石</small>
            </span>
            <button
              type="button"
              aria-label="播放"
              onClick={() => notify("播放控制已就绪")}
            >
              <Play size={18} fill="currentColor" />
            </button>
          </div>
        </div>
      </section>

      <div className="section-heading">
        <span>朋友圈</span>
        <span>来自你的角色</span>
      </div>

      <section className="moment-feed">
        {moments.map((moment) => {
          const character = characters.find(
            (item) => item.id === moment.characterId,
          );
          if (!character) return null;

          return (
            <article className="moment" key={moment.id}>
              <button
                type="button"
                className="moment__author"
                onClick={() => onOpenCharacter(character.id)}
              >
                <Avatar
                  src={character.avatar}
                  name={character.name}
                  accent={character.accent}
                  size={42}
                />
                <span>
                  <strong>{character.name}</strong>
                  <small>{moment.time}</small>
                </span>
              </button>
              <p className="moment__content">{moment.content}</p>
              {moment.image ? (
                <img className="moment__image" src={moment.image} alt="" />
              ) : null}
              <div className="moment__meta">
                {moment.location ? (
                  <span>
                    <MapPin size={13} /> {moment.location}
                  </span>
                ) : (
                  <span />
                )}
                <span>{moment.comments} 条回应</span>
              </div>
              <div className="moment__actions">
                <button
                  type="button"
                  className={moment.liked ? "is-liked" : ""}
                  onClick={() => onLikeMoment(moment.id)}
                >
                  <Heart size={18} fill={moment.liked ? "currentColor" : "none"} />
                  {moment.likes}
                </button>
                <button type="button" onClick={() => notify("回应输入框已准备好")}>
                  <MessageCircle size={18} /> 回应
                </button>
                <button type="button" onClick={() => notify("已收藏这条动态")}>
                  <Bookmark size={18} />
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <div className="section-heading section-heading--spaced">
        <span>论坛热帖</span>
        <button type="button" onClick={() => notify("论坛内容取自本地示例数据")}>
          更多
        </button>
      </div>

      <section className="topic-list">
        {forumTopics.map((topic) => (
          <button
            type="button"
            className="topic-row"
            key={topic.id}
            onClick={() => notify(`已打开话题「${topic.title}」`)}
          >
            <span
              className="topic-row__label"
              style={{ "--topic-color": topic.color }}
            >
              {topic.label}
            </span>
            <strong>{topic.title}</strong>
            <small>{topic.meta}</small>
          </button>
        ))}
      </section>
    </div>
  );
}

function MeView({ characters, moments, settings, onOpenSheet, notify }) {
  const memoryCount = characters.filter((character) => character.memory).length;
  const enabledText = settings.api.enabled ? settings.api.model : "尚未连接";

  return (
    <div className="view me-view">
      <AppHeader
        eyebrow="你的私人空间"
        title="我的"
        actions={
          <IconButton
            icon={Bell}
            label="通知中心"
            onClick={() => notify("当前没有新的提醒")}
          />
        }
      />

      <section className="profile-panel">
        <div className="profile-panel__avatar">酌</div>
        <div className="profile-panel__copy">
          <span>夜航员</span>
          <strong>把普通的一天留下来</strong>
          <small>
            <i className={settings.api.enabled ? "online" : ""} />
            {enabledText}
          </small>
        </div>
        <button type="button" onClick={() => notify("个人资料编辑入口已准备")}>
          <PenLine size={17} />
        </button>
      </section>

      <section className="profile-stats">
        <div>
          <strong>{characters.length}</strong>
          <span>角色</span>
        </div>
        <div>
          <strong>{memoryCount}</strong>
          <span>长期记忆</span>
        </div>
        <div>
          <strong>{moments.length}</strong>
          <span>角色动态</span>
        </div>
        <div>
          <strong>42</strong>
          <span>陪伴天数</span>
        </div>
      </section>

      <div className="section-heading">
        <span>模型与数据</span>
        <span>仅保存在本机</span>
      </div>

      <section className="settings-list">
        <SettingRow
          icon={Activity}
          color="#2e9c78"
          title="AI 工作台"
          detail="Agent、RAG、调用指标与工程调试"
          onClick={() => onOpenSheet("ai-lab")}
        />
        <SettingRow
          icon={Bot}
          color="#ef6a5b"
          title="模型与接口"
          detail={settings.api.enabled ? settings.api.model : "配置第三方或本地模型"}
          onClick={() => onOpenSheet("settings")}
        />
        <SettingRow
          icon={BrainCircuit}
          color="#6678d7"
          title="长期记忆"
          detail={settings.memory.enabled ? `${memoryCount} 个角色正在记忆` : "已关闭"}
          onClick={() => onOpenSheet("memory")}
        />
        <SettingRow
          icon={Database}
          color="#2e9c78"
          title="本地数据"
          detail="查看、导出或清理本机内容"
          onClick={() => onOpenSheet("local-data")}
        />
      </section>

      <div className="section-heading">
        <span>体验</span>
      </div>

      <section className="settings-list">
        <SettingRow
          icon={Volume2}
          color="#c88c3f"
          title="声音与语音"
          detail={settings.voice.autoPlay ? "自动播放角色语音" : "仅手动播放"}
          onClick={() => onOpenSheet("settings")}
        />
        <SettingRow
          icon={Moon}
          color="#8b72b7"
          title="安静模式"
          detail="减少主动提醒和动态红点"
          onClick={() => notify("安静模式已切换为演示状态")}
        />
        <SettingRow
          icon={ShieldCheck}
          color="#547f9d"
          title="隐私与安全"
          detail="没有云端账号，密钥留在本机"
          onClick={() => notify("应用不上传角色与聊天数据")}
        />
      </section>

      <p className="me-footer">染酌 小手机 · Local First</p>
    </div>
  );
}

function SettingRow({ icon: Icon, color, title, detail, onClick }) {
  return (
    <button type="button" className="setting-row" onClick={onClick}>
      <span className="setting-row__icon" style={{ "--setting-color": color }}>
        <Icon size={19} />
      </span>
      <span className="setting-row__copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

function ChatView({
  thread,
  character,
  settings,
  typing,
  onBack,
  onSend,
  onStop,
  onOpenSettings,
  notify,
}) {
  const [input, setInput] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState(0);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.messages, typing]);

  const sendText = () => {
    const text = input.trim();
    if (!text) return;
    onSend({ type: "text", text });
    setInput("");
    setEmojiOpen(false);
    setToolsOpen(false);
  };

  const sendVoice = () => {
    const duration = Math.max(
      1,
      Math.min(60, Math.round((Date.now() - recordStartedAt) / 1000)),
    );
    setRecording(false);
    onSend({
      type: "voice",
      duration,
      text: "语音消息",
    });
  };

  return (
    <div className="chat-view">
      <header className="chat-header">
        <IconButton icon={ChevronLeft} label="返回" onClick={onBack} />
        <button
          type="button"
          className="chat-header__identity"
          onClick={() => notify(`${character.name} · ${character.lastSeen}`)}
        >
          <Avatar
            src={character.avatar}
            name={character.name}
            accent={character.accent}
            online={character.online}
            size={38}
          />
          <span>
            <strong>{character.name}</strong>
            <small>{typing ? "正在输入..." : character.lastSeen}</small>
          </span>
        </button>
        <div className="chat-header__actions">
          <IconButton
            icon={Phone}
            label="语音通话"
            onClick={() => notify("语音通话需要在 Android 端接入音频服务")}
          />
          <IconButton icon={MoreHorizontal} label="更多" onClick={onOpenSettings} />
        </div>
      </header>

      <div className="chat-context">
        <span className="chat-context__line" />
        <span>
          <LockKeyhole size={12} />
          会话仅保存在本机
        </span>
        <span className="chat-context__line" />
      </div>

      <section className="message-stream">
        {thread.messages.map((message, index) => {
          const previous = thread.messages[index - 1];
          const showTime = !previous || previous.time !== message.time;
          return (
            <div key={message.id}>
              {showTime ? (
                <div className="message-time">{message.time}</div>
              ) : null}
              <MessageBubble
                message={message}
                character={character}
                onPlay={() => notify("正在播放语音消息")}
              />
            </div>
          );
        })}
        {typing ? (
          <div className="message-row message-row--assistant">
            <Avatar
              src={character.avatar}
              name={character.name}
              accent={character.accent}
              size={30}
            />
            <div className="typing-bubble" aria-label="正在输入">
              <i />
              <i />
              <i />
            </div>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </section>

      <div className="quick-replies">
        {quickReplies.map((reply) => (
          <button
            type="button"
            key={reply}
            onClick={() => setInput((current) => `${current}${reply}`)}
          >
            {reply}
          </button>
        ))}
      </div>

      {emojiOpen ? (
        <div className="emoji-panel">
          {["☺", "♡", "☾", "✦", "☂", "☕", "♫", "❀"].map((emoji) => (
            <button
              type="button"
              key={emoji}
              onClick={() => setInput((current) => current + emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      {toolsOpen ? (
        <div className="tool-panel">
          {[
            { icon: ImageIcon, label: "相册" },
            { icon: Camera, label: "拍摄" },
            { icon: MapPin, label: "位置" },
            { icon: Music2, label: "音乐" },
          ].map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                type="button"
                key={tool.label}
                onClick={() =>
                  notify(`${tool.label}功能需要在 Capacitor 原生层继续接入`)
                }
              >
                <span>
                  <Icon size={21} />
                </span>
                {tool.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <footer className="composer">
        <IconButton
          icon={Mic}
          label={voiceMode ? "切换到文字输入" : "切换到语音输入"}
          active={voiceMode}
          onClick={() => {
            setVoiceMode((current) => !current);
            setEmojiOpen(false);
            setToolsOpen(false);
          }}
        />
        {voiceMode ? (
          <button
            type="button"
            className={`hold-to-talk ${recording ? "is-recording" : ""}`}
            onPointerDown={() => {
              setRecordStartedAt(Date.now());
              setRecording(true);
            }}
            onPointerUp={sendVoice}
            onPointerCancel={() => setRecording(false)}
          >
            {recording ? "松开 发送" : "按住 说话"}
          </button>
        ) : (
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendText();
              }
            }}
            placeholder={
              settings.api.enabled ? "和角色说点什么..." : "消息会保存在本机..."
            }
            aria-label="消息输入框"
          />
        )}
        {typing ? (
          <button
            type="button"
            className="stop-generation"
            onClick={onStop}
            aria-label="停止生成"
          >
            <Square size={15} fill="currentColor" />
          </button>
        ) : !voiceMode ? (
          <>
            <IconButton
              icon={Smile}
              label="表情"
              active={emojiOpen}
              onClick={() => {
                setEmojiOpen((current) => !current);
                setToolsOpen(false);
              }}
            />
            {input.trim() ? (
              <button
                type="button"
                className="send-button"
                onClick={sendText}
                aria-label="发送"
              >
                <SendHorizontal size={19} />
              </button>
            ) : (
              <IconButton
                icon={Plus}
                label="更多功能"
                active={toolsOpen}
                onClick={() => {
                  setToolsOpen((current) => !current);
                  setEmojiOpen(false);
                }}
              />
            )}
          </>
        ) : null}
      </footer>
    </div>
  );
}

function MessageBubble({ message, character, onPlay }) {
  const isUser = message.role === "user";

  return (
    <div className={`message-row ${isUser ? "message-row--user" : "message-row--assistant"}`}>
      {!isUser ? (
        <Avatar
          src={character.avatar}
          name={character.name}
          accent={character.accent}
          size={30}
        />
      ) : null}
      <div className="message-stack">
        {message.sender ? (
          <span className="message-sender">{message.sender}</span>
        ) : null}
        <div className={`message-bubble ${message.type === "voice" ? "message-bubble--voice" : ""}`}>
          {message.type === "image" && message.image ? (
            <img src={message.image} alt="" className="message-image" />
          ) : null}
          {message.type === "voice" ? (
            <button type="button" className="voice-message" onClick={onPlay}>
              <Volume2 size={18} />
              <span className="voice-wave">
                {Array.from({ length: 9 }).map((_, index) => (
                  <i key={index} style={{ "--wave": `${index % 4}px` }} />
                ))}
              </span>
              <small>{message.duration}s</small>
            </button>
          ) : null}
          {message.text && message.type !== "voice" ? (
            <p>{message.text}</p>
          ) : null}
        </div>
        {isUser ? (
          <span className="message-read">
            {message.read ? <CheckCheck size={13} /> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CharacterDetail({ character, onBack, onChat, onEdit, notify }) {
  return (
    <div className="character-detail">
      <header className="detail-header">
        <IconButton icon={ChevronLeft} label="返回" onClick={onBack} />
        <span>角色资料</span>
        <IconButton icon={MoreHorizontal} label="更多" onClick={onEdit} />
      </header>

      <section
        className="detail-cover"
        style={{
          "--character-accent": character.accent,
          backgroundImage: character.avatar ? `url(${character.avatar})` : "none",
        }}
      >
        <div className="detail-cover__shade" />
        <div className="detail-cover__bottom">
          <Avatar
            src={character.avatar}
            name={character.name}
            accent={character.accent}
            size={76}
          />
          <div>
            <h2>{character.name}</h2>
            <p>{character.handle}</p>
          </div>
        </div>
      </section>

      <section className="detail-actions">
        <button type="button" className="primary-button" onClick={onChat}>
          <MessageCircle size={18} /> 发消息
        </button>
        <button
          type="button"
          className="secondary-icon-button"
          onClick={() => notify("语音通话需要 Android 音频能力")}
        >
          <Phone size={19} />
        </button>
        <button
          type="button"
          className="secondary-icon-button"
          onClick={() => notify("视频通话需要 Android 相机与音频能力")}
        >
          <Video size={19} />
        </button>
        <button type="button" className="secondary-icon-button" onClick={onEdit}>
          <Settings2 size={19} />
        </button>
      </section>

      <section className="affinity-panel">
        <div>
          <span>熟悉程度</span>
          <strong>{character.affinity}%</strong>
        </div>
        <div className="affinity-bar">
          <i style={{ width: `${character.affinity}%` }} />
        </div>
        <p>最近常聊：生活、音乐、今天发生的小事</p>
      </section>

      <section className="detail-section">
        <div className="detail-section__title">
          <span>
            <BrainCircuit size={17} /> 角色记忆
          </span>
          <button type="button" onClick={onEdit}>
            编辑
          </button>
        </div>
        <div className="memory-note">{character.memory}</div>
      </section>

      <section className="detail-section">
        <div className="detail-section__title">
          <span>
            <BookOpen size={17} /> 角色设定
          </span>
        </div>
        <p className="persona-copy">{character.persona}</p>
      </section>

      <section className="detail-section">
        <div className="detail-section__title">
          <span>
            <Sparkles size={17} /> 关键词
          </span>
        </div>
        <div className="tag-cloud">
          {character.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <div className="detail-section__title">
          <span>
            <Star size={17} /> 最近动态
          </span>
        </div>
        <div className="character-quote">
          <p>“有些话可以晚一点说，但今晚的月亮不能错过。”</p>
          <small>来自角色动态 · 今天 20:11</small>
        </div>
      </section>
    </div>
  );
}

function AILabSheet({ settings, characters, onClose, notify }) {
  const [section, setSection] = useState("agent");
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [goal, setGoal] = useState("查找本地知识库，说明染酌小手机支持哪些模型，然后计算 128 * 3。");
  const [agentResult, setAgentResult] = useState(null);
  const [agentError, setAgentError] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [evaluationCatalog, setEvaluationCatalog] = useState(null);
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [evaluationRunning, setEvaluationRunning] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedAgentCharacterId, setSelectedAgentCharacterId] = useState(
    characters[0]?.id || "",
  );
  const [knowledgeCharacterId, setKnowledgeCharacterId] = useState("shared");
  const [logFilter, setLogFilter] = useState("all");
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");

  const api = settings.api;
  const gatewayUrl = api.gatewayUrl || "http://127.0.0.1:8787";
  const providerPayload = {
    provider: api.provider || "deepseek",
    baseUrl: api.baseUrl || "",
    apiKey: api.apiKey || "",
    model: api.model || "deepseek-flash",
    temperature: api.temperature,
  };
  const selectedAgentCharacter =
    characters.find((character) => character.id === selectedAgentCharacterId) ||
    null;
  const knowledgeScopeName =
    knowledgeCharacterId === "shared"
      ? "共享知识库"
      : characters.find((character) => character.id === knowledgeCharacterId)
          ?.name || "当前角色";
  const filteredLogs = logs.filter((log) => {
    if (logFilter === "all") return true;
    return log.status === logFilter;
  });

  const refresh = async () => {
    setBusy(true);
    try {
      const [
        healthPayload,
        metricsPayload,
        logsPayload,
        documentsPayload,
        evaluationPayload,
      ] =
        await Promise.all([
          getGatewayHealth(gatewayUrl),
          getGatewayMetrics(gatewayUrl),
          getGatewayLogs(gatewayUrl, 30),
          listKnowledgeDocuments(gatewayUrl),
          getEvaluationCatalog(gatewayUrl),
        ]);
      setHealth(healthPayload);
      setMetrics(metricsPayload);
      setLogs(logsPayload.logs || []);
      setDocuments(documentsPayload.documents || []);
      setEvaluationCatalog(evaluationPayload);
      setLastRefreshedAt(formatNow());
    } catch (error) {
      setHealth(null);
      setLastRefreshedAt("");
      notify("AI Gateway 未连接：" + error.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [gatewayUrl]);

  const executeAgent = async () => {
    setAgentRunning(true);
    setAgentError("");
    setAgentResult(null);
    try {
      const result = await runAgent(gatewayUrl, {
        ...providerPayload,
        goal,
        maxSteps: 5,
        character: selectedAgentCharacter,
      });
      setAgentResult(result);
      await refresh();
    } catch (error) {
      setAgentError(error.message);
    } finally {
      setAgentRunning(false);
    }
  };

  const executeEvaluation = async (includeLive) => {
    if (includeLive && !api.apiKey) {
      notify("真实模型评测需要先在模型设置中填写 API 密钥");
      return;
    }

    setEvaluationRunning(true);
    try {
      const result = await runEvaluationSuite(gatewayUrl, {
        ...providerPayload,
        providerKey: api.apiKey,
        includeLive,
      });
      setEvaluationResult(result);
      await refresh();
      notify(
        "评测完成：" + result.passed + "/" + result.total + " 项通过",
      );
    } catch (error) {
      notify("评测失败：" + error.message);
    } finally {
      setEvaluationRunning(false);
    }
  };

  const addDocument = async () => {
    if (!documentTitle.trim() || !documentText.trim()) {
      notify("请填写资料标题和内容");
      return;
    }
    setBusy(true);
    try {
      await ingestKnowledgeDocument(gatewayUrl, {
        title: documentTitle.trim(),
        text: documentText.trim(),
        characterId: knowledgeCharacterId,
      });
      setDocumentTitle("");
      setDocumentText("");
      setDocuments((await listKnowledgeDocuments(gatewayUrl)).documents || []);
      notify("资料已完成切块、向量化和入库");
    } catch (error) {
      notify("入库失败：" + error.message);
    } finally {
      setBusy(false);
    }
  };

  const removeDocument = async (documentId) => {
    setBusy(true);
    try {
      await deleteKnowledgeDocument(gatewayUrl, documentId);
      setDocuments((current) =>
        current.filter((document) => document.id !== documentId),
      );
    } catch (error) {
      notify("删除失败：" + error.message);
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setBusy(true);
    try {
      const payload = await searchKnowledge(gatewayUrl, {
        query: searchQuery.trim(),
        limit: 5,
        characterId: knowledgeCharacterId,
      });
      setSearchResults(payload.results || []);
    } catch (error) {
      notify("检索失败：" + error.message);
    } finally {
      setBusy(false);
    }
  };

  const statusText = health ? "Gateway 在线" : "Gateway 离线";
  const sections = [
    { id: "agent", label: "Agent", icon: Bot },
    { id: "knowledge", label: "RAG 知识库", icon: FileText },
    { id: "observability", label: "调用观测", icon: Gauge },
    { id: "evaluation", label: "评测", icon: Check },
  ];

  return (
    <Sheet
      title="AI 工作台"
      eyebrow="Agent Runtime · RAG · Observability"
      variant="lab"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="text-button" onClick={refresh}>
            <RefreshCw className={busy ? "is-spinning" : ""} size={16} />
            {busy ? "刷新中..." : "刷新"}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={agentRunning || evaluationRunning}
            onClick={
              section === "evaluation"
                ? () => executeEvaluation(false)
                : executeAgent
            }
          >
            {section === "evaluation" ? <Check size={17} /> : <Play size={17} />}
            {section === "evaluation"
              ? evaluationRunning
                ? "评测运行中..."
                : "运行基础评测"
              : agentRunning
                ? "Agent 执行中..."
                : "运行 Agent"}
          </button>
        </>
      }
    >
      <section className="lab-status-strip">
        <div className={"lab-status " + (health ? "is-online" : "is-offline")}>
          <Server size={18} />
          <span>
            <strong>{statusText}</strong>
            <small>
              {gatewayUrl} · {api.provider || "deepseek"}/{api.model || "-"}
            </small>
          </span>
          <i />
        </div>
        <div>
          <span>调用次数</span>
          <strong>{metrics?.totalCalls || 0}</strong>
        </div>
        <div>
          <span>成功率</span>
          <strong>
            {metrics ? Math.round((metrics.successRate || 0) * 100) + "%" : "--"}
          </strong>
        </div>
        <div>
          <span>平均延迟</span>
          <strong>{metrics?.averageLatencyMs || 0}ms</strong>
        </div>
        <div>
          <span>最近刷新</span>
          <strong>{lastRefreshedAt || "--"}</strong>
        </div>
      </section>

      <nav className="lab-tabs" aria-label="AI 工作台功能">
        {sections.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              className={section === item.id ? "is-active" : ""}
              onClick={() => setSection(item.id)}
            >
              <Icon size={17} /> {item.label}
            </button>
          );
        })}
      </nav>

      {section === "agent" ? (
        <div className="lab-grid lab-grid--agent">
          <section className="lab-panel">
            <div className="lab-panel__title">
              <span>
                <Bot size={18} /> Agent 目标
              </span>
              <small>最多 5 个工具执行步骤</small>
            </div>
            <label className="lab-field">
              <span>角色上下文</span>
              <select
                value={selectedAgentCharacterId}
                onChange={(event) =>
                  setSelectedAgentCharacterId(event.target.value)
                }
              >
                <option value="">不绑定角色设定</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedAgentCharacter ? (
              <p className="lab-field-hint">
                {selectedAgentCharacter.handle} · {selectedAgentCharacter.memory}
              </p>
            ) : null}
            <textarea
              className="lab-textarea"
              rows={5}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="描述一个需要检索、计算或获取时间的任务..."
            />
            <div className="lab-tool-list">
              {(health?.agentTools || ["search_knowledge", "calculate", "get_current_time"]).map(
                (tool) => (
                  <span key={tool}>{tool}</span>
                ),
              )}
            </div>
            {agentError ? <div className="lab-error">{agentError}</div> : null}
            {agentResult ? (
              <div className="agent-answer">
                <span>最终回答</span>
                <p>{agentResult.answer}</p>
                <small>
                  {agentResult.trace.length} 个执行步骤 ·{" "}
                  {agentResult.stoppedReason}
                  {agentResult.usage?.total_tokens
                    ? ` · ${agentResult.usage.total_tokens} tokens`
                    : ""}
                </small>
              </div>
            ) : (
              <div className="lab-empty">
                <Activity size={24} />
                <p>运行后会在右侧显示工具调用轨迹与最终回答。</p>
              </div>
            )}
          </section>
          <section className="lab-panel lab-panel--trace">
            <div className="lab-panel__title">
              <span>
                <Sparkles size={17} /> 执行轨迹
              </span>
              <small>Trace</small>
            </div>
            {agentResult?.trace?.length ? (
              <div className="trace-list">
                {agentResult.trace.map((step, index) => (
                  <div className="trace-item" key={step.step + "-" + step.type + "-" + index}>
                    <span className={"trace-item__dot trace-" + step.type} />
                    <div>
                      <strong>
                        Step {step.step} · {step.type}
                      </strong>
                      {step.toolCalls?.map((tool) => (
                        <p key={tool.id}>
                          {tool.name}({tool.arguments})
                        </p>
                      ))}
                      {step.content ? <p>{step.content}</p> : null}
                      {step.result ? (
                        <code>{JSON.stringify(step.result).slice(0, 280)}</code>
                      ) : null}
                      {step.latencyMs ? <small>{step.latencyMs}ms</small> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="lab-empty">
                <Activity size={24} />
                <p>尚未产生 Agent 调用记录。</p>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {section === "knowledge" ? (
        <div className="lab-grid lab-grid--knowledge">
          <section className="lab-panel">
            <div className="lab-panel__title">
              <span>
                <FileText size={18} /> 导入本地资料
              </span>
              <small>自动切块与向量化</small>
            </div>
            <label className="lab-field">
              <span>资料标题</span>
              <input
                value={documentTitle}
                onChange={(event) => setDocumentTitle(event.target.value)}
                placeholder="例如：项目技术说明"
              />
            </label>
            <label className="lab-field">
              <span>正文内容</span>
              <textarea
                className="lab-textarea"
                rows={8}
                value={documentText}
                onChange={(event) => setDocumentText(event.target.value)}
                placeholder="粘贴产品文档、角色设定、知识资料..."
              />
            </label>
            <label className="lab-field">
              <span>知识范围</span>
              <select
                value={knowledgeCharacterId}
                onChange={(event) =>
                  setKnowledgeCharacterId(event.target.value)
                }
              >
                <option value="shared">共享知识库（所有角色）</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name} 的专属知识
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary-button primary-button--wide"
              disabled={busy}
              onClick={addDocument}
            >
              <Database size={17} /> 建立索引
            </button>
            {searchResults.length ? (
              <div className="retrieval-results">
                <strong>检索 Top {searchResults.length}</strong>
                {searchResults.map((result) => (
                  <div key={result.chunkId}>
                    <span>
                      {result.title} · {Math.round(result.score * 100)}%
                    </span>
                    <p>{result.content}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <section className="lab-panel lab-panel--documents">
            <div className="lab-panel__title">
              <span>
                <Database size={18} /> 知识库文档
              </span>
              <small>{documents.length} 份 · 当前检索 {knowledgeScopeName}</small>
            </div>
            <p className="lab-scope-note">
              {knowledgeCharacterId === "shared"
                ? "检索所有共享资料，不包含角色专属知识。"
                : `${knowledgeScopeName} 可检索专属资料与共享资料。`}
            </p>
            <div className="knowledge-search">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runSearch();
                }}
                placeholder="输入问题进行相似度检索"
              />
              <button type="button" onClick={runSearch} aria-label="执行检索">
                <Search size={17} />
              </button>
            </div>
            <div className="document-list">
              {documents.length ? (
                documents.map((document) => {
                  const owner =
                    document.characterId === "shared"
                      ? "共享"
                      : characters.find(
                          (character) => character.id === document.characterId,
                        )?.name || "未知角色";
                  return (
                    <div className="document-row" key={document.id}>
                      <span className="document-row__icon">
                        <FileText size={18} />
                      </span>
                      <span>
                        <strong>{document.title}</strong>
                        <small>
                          {owner} · {document.chunks} 个知识块 ·{" "}
                          {document.textLength} 字符
                        </small>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeDocument(document.id)}
                        aria-label={"删除 " + document.title}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })
              ) : (
                <div className="lab-empty">
                  <Database size={24} />
                  <p>知识库为空，左侧导入第一份资料。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {section === "observability" ? (
        <div className="lab-grid lab-grid--observability">
          <section className="lab-panel lab-panel--logs">
            <div className="lab-panel__title">
              <span>
                <Gauge size={18} /> 最近调用
              </span>
              <small>保留最近 300 条</small>
            </div>
            <div className="lab-filter-bar" aria-label="调用日志筛选">
              {[
                { id: "all", label: "全部", count: logs.length },
                {
                  id: "ok",
                  label: "成功",
                  count: logs.filter((log) => log.status === "ok").length,
                },
                {
                  id: "error",
                  label: "失败",
                  count: logs.filter((log) => log.status === "error").length,
                },
              ].map((filter) => (
                <button
                  type="button"
                  key={filter.id}
                  className={logFilter === filter.id ? "is-active" : ""}
                  onClick={() => setLogFilter(filter.id)}
                >
                  {filter.label} <span>{filter.count}</span>
                </button>
              ))}
            </div>
            <div className="call-log-list">
              {filteredLogs.length ? (
                filteredLogs.map((log) => (
                  <div className="call-log-row" key={log.id}>
                    <span className={"call-status call-status--" + log.status} />
                    <span>
                      <strong>{log.route}</strong>
                      <small>
                        {formatLogTime(log.createdAt)} · {log.provider || "-"} /{" "}
                        {log.model || "-"} · {log.latencyMs || 0}ms
                      </small>
                    </span>
                    <span className="call-log-row__metric">
                      <strong>
                        {log.usage?.total_tokens || log.outputChars || "-"}
                      </strong>
                      <small>
                        {log.usage?.total_tokens ? "tokens" : "chars"}
                      </small>
                    </span>
                  </div>
                ))
              ) : (
                <div className="lab-empty">
                  <Activity size={24} />
                  <p>
                    {logs.length ? "当前筛选没有调用记录。" : "还没有模型调用数据。"}
                  </p>
                </div>
              )}
            </div>
          </section>
          <section className="lab-panel">
            <div className="lab-panel__title">
              <span>
                <Activity size={18} /> 工程信号
              </span>
              <small>Request telemetry</small>
            </div>
            <div className="observability-grid">
              <div>
                <span>成功调用</span>
                <strong>{metrics?.successfulCalls || 0}</strong>
              </div>
              <div>
                <span>失败调用</span>
                <strong>{metrics?.failedCalls || 0}</strong>
              </div>
              <div>
                <span>P95 延迟</span>
                <strong>{metrics?.p95LatencyMs || 0}ms</strong>
              </div>
              <div>
                <span>平均延迟</span>
                <strong>{metrics?.averageLatencyMs || 0}ms</strong>
              </div>
              <div>
                <span>Token 总量</span>
                <strong>{metrics?.totalTokens || 0}</strong>
              </div>
              <div>
                <span>输入 / 输出字符</span>
                <strong>
                  {(metrics?.totalInputChars || 0).toLocaleString()} /{" "}
                  {(metrics?.totalOutputChars || 0).toLocaleString()}
                </strong>
              </div>
            </div>
            <div className="lab-note">
              <ShieldCheck size={17} />
              <p>
                Gateway 只监听本机地址。调用日志不保存提示词正文和 API 密钥。
              </p>
            </div>
          </section>
        </div>
      ) : null}

      {section === "evaluation" ? (
        <div className="lab-grid lab-grid--evaluation">
          <section className="lab-panel evaluation-summary">
            <div className="lab-panel__title">
              <span>
                <Check size={18} /> AI 工程评测
              </span>
              <small>Regression Suite</small>
            </div>
            <div className="evaluation-score">
              <strong>
                {evaluationResult
                  ? Math.round((evaluationResult.score || 0) * 100) + "%"
                  : "--"}
              </strong>
              <span>
                {evaluationResult
                  ? evaluationResult.passed +
                    " / " +
                    evaluationResult.total +
                    " 项通过"
                  : "等待运行"}
              </span>
            </div>
            <div className="evaluation-dimensions">
              {(evaluationCatalog?.suites?.[0]?.dimensions || [
                "Tool Calling",
                "RAG",
                "Provider",
              ]).map((dimension) => (
                <span key={dimension}>{dimension}</span>
              ))}
            </div>
            <div className="evaluation-actions">
              <button
                type="button"
                className="primary-button"
                disabled={evaluationRunning}
                onClick={() => executeEvaluation(false)}
              >
                <Check size={17} /> 基础评测
              </button>
              <button
                type="button"
                className="secondary-eval-button"
                disabled={evaluationRunning}
                onClick={() => executeEvaluation(true)}
              >
                <Activity size={17} /> 包含真实模型
              </button>
            </div>
            <div className="lab-note">
              <ShieldCheck size={17} />
              <p>
                基础评测不消耗模型额度；真实模型评测会调用当前配置的 DeepSeek
                或其他供应商。
              </p>
            </div>
          </section>
          <section className="lab-panel lab-panel--evaluation-results">
            <div className="lab-panel__title">
              <span>
                <Activity size={18} /> 测试用例
              </span>
              <small>
                {evaluationResult
                  ? evaluationResult.durationMs + "ms"
                  : "4 个确定性用例"}
              </small>
            </div>
            {evaluationResult?.cases?.length ? (
              <div className="evaluation-case-list">
                {evaluationResult.cases.map((testCase) => (
                  <div className="evaluation-case" key={testCase.id}>
                    <span
                      className={
                        "evaluation-case__status " +
                        (testCase.passed ? "is-passed" : "is-failed")
                      }
                    >
                      {testCase.passed ? <Check size={14} /> : <Square size={12} />}
                    </span>
                    <span>
                      <strong>{testCase.name}</strong>
                      <small>{testCase.id}</small>
                      {testCase.error ? <p>{testCase.error}</p> : null}
                    </span>
                    <small>{testCase.latencyMs}ms</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="lab-empty">
                <Check size={24} />
                <p>
                  运行评测后，这里会显示工具调用、RAG 和模型连通性的通过情况。
                </p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </Sheet>
  );
}

function SettingsSheet({ settings, onClose, onSave }) {
  const [draft, setDraft] = useState(settings);
  const [showKey, setShowKey] = useState(false);
  const [connectionTest, setConnectionTest] = useState(null);
  const [keyStored, setKeyStored] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const updateApi = (patch) => {
    setDraft((current) => ({
      ...current,
      api: { ...current.api, ...patch },
    }));
  };

  const providerPresets = [
    {
      id: "deepseek",
      label: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
    },
    {
      id: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    },
    {
      id: "ollama",
      label: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
    },
    {
      id: "custom",
      label: "兼容接口",
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "",
    },
  ];
  const activePreset =
    providerPresets.find((preset) => preset.id === draft.api.provider) ||
    providerPresets[0];

  const runConnectionTest = async () => {
    setConnectionTest({ status: "loading", message: "正在请求模型..." });
    try {
      const result = await testProviderConnection(
        draft.api.gatewayUrl || "http://127.0.0.1:8787",
        {
          ...draft.api,
          providerKey: draft.api.apiKey,
        },
      );
      setConnectionTest({
        status: "success",
        message: `${result.model} 可用 · ${result.latencyMs}ms · ${result.attempts} 次请求`,
      });
    } catch (error) {
      setConnectionTest({
        status: "error",
        message: error.message,
      });
    }
  };

  useEffect(() => {
    let active = true;
    const loadStoredConfig = async () => {
      if (!draft.api.gatewayUrl) return;
      setConfigLoading(true);
      try {
        const result = await getGatewayProviderConfig(draft.api.gatewayUrl);
        if (!active) return;
        const config = result.config || {};
        setDraft((current) => ({
          ...current,
          api: {
            ...current.api,
            ...config,
            apiKey: "",
          },
        }));
        setKeyStored(Boolean(config.apiKeyConfigured));
      } catch {
        // Local storage settings remain the fallback when Gateway is offline.
      } finally {
        if (active) setConfigLoading(false);
      }
    };
    loadStoredConfig();
    return () => {
      active = false;
    };
  }, []);

  const saveSettings = async () => {
    setSaveError("");
    if (draft.api.transport !== "gateway") {
      onSave(draft);
      return;
    }

    setSaving(true);
    try {
      const result = await saveGatewayProviderConfig(draft.api.gatewayUrl, draft.api);
      const stored = result.config || {};
      setKeyStored(Boolean(stored.apiKeyConfigured));
      onSave({
        ...draft,
        api: {
          ...draft.api,
          ...stored,
          apiKey: "",
          enabled: draft.api.enabled,
          transport: draft.api.transport,
        },
      });
    } catch (error) {
      setSaveError("Gateway 配置保存失败：" + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="模型与接口"
      eyebrow="只保存在当前设备"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={saving}
            onClick={saveSettings}
          >
            <Check size={18} /> {saving ? "正在保存..." : "保存设置"}
          </button>
        </>
      }
    >
      <label className="toggle-row">
        <span>
          <strong>连接模型服务</strong>
          <small>关闭时仍可浏览和保存本地消息</small>
        </span>
        <input
          type="checkbox"
          checked={draft.api.enabled}
          onChange={(event) => updateApi({ enabled: event.target.checked })}
        />
        <i />
      </label>

      <div className="transport-switch">
        <button
          type="button"
          className={draft.api.transport === "gateway" ? "is-active" : ""}
          onClick={() => updateApi({ transport: "gateway" })}
        >
          <Server size={16} /> 本地 AI Gateway
        </button>
        <button
          type="button"
          className={draft.api.transport === "direct" ? "is-active" : ""}
          onClick={() => updateApi({ transport: "direct" })}
        >
          <Wifi size={16} /> 浏览器直连
        </button>
      </div>

      <div className="provider-presets">
        {providerPresets.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className={draft.api.provider === preset.id ? "is-active" : ""}
            onClick={() =>
              updateApi({
                provider: preset.id,
                baseUrl: preset.baseUrl,
                model: preset.model,
              })
            }
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="form-stack">
        {draft.api.transport === "gateway" ? (
          <label>
            <span>Gateway 地址</span>
            <input
              value={draft.api.gatewayUrl}
              onChange={(event) => updateApi({ gatewayUrl: event.target.value })}
              placeholder="http://127.0.0.1:8787"
              autoCapitalize="none"
            />
          </label>
        ) : (
          <label>
            <span>服务地址</span>
            <input
              value={draft.api.baseUrl}
              onChange={(event) => updateApi({ baseUrl: event.target.value })}
              placeholder="https://api.example.com/v1"
              autoCapitalize="none"
            />
          </label>
        )}
        <label>
          <span>API 密钥</span>
          <div className="secret-input">
            <input
              type={showKey ? "text" : "password"}
              value={draft.api.apiKey}
              onChange={(event) => updateApi({ apiKey: event.target.value })}
              placeholder={
                keyStored
                  ? "密钥已保存，留空表示不修改"
                  : draft.api.provider === "ollama"
                    ? "本地模型可填 ollama"
                    : "sk-..."
              }
              autoCapitalize="none"
            />
            <button
              type="button"
              onClick={() => setShowKey((current) => !current)}
              aria-label={showKey ? "隐藏密钥" : "显示密钥"}
            >
              {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </label>
        <label>
          <span>模型名称</span>
          <input
            value={draft.api.model}
            onChange={(event) => updateApi({ model: event.target.value })}
            placeholder={activePreset.model || "model-name"}
            autoCapitalize="none"
          />
        </label>
        <label>
          <span>
            回应温度 <b>{Number(draft.api.temperature).toFixed(1)}</b>
          </span>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.1"
            value={draft.api.temperature}
            onChange={(event) =>
              updateApi({ temperature: Number(event.target.value) })
            }
          />
        </label>
        <button
          type="button"
          className="test-connection-button"
          disabled={
            draft.api.transport !== "gateway" ||
            configLoading ||
            connectionTest?.status === "loading"
          }
          onClick={runConnectionTest}
        >
          <Wifi size={17} />
          {configLoading
            ? "正在读取本地配置..."
            : connectionTest?.status === "loading"
            ? "正在测试连接..."
            : "测试模型连通性"}
        </button>
        {connectionTest?.message ? (
          <div className={"connection-result connection-result--" + connectionTest.status}>
            {connectionTest.message}
          </div>
        ) : null}
        {saveError ? (
          <div className="connection-result connection-result--error">
            {saveError}
          </div>
        ) : null}
      </div>

      <div className="privacy-note">
        <ShieldCheck size={18} />
        <p>
          {draft.api.transport === "gateway"
            ? keyStored
              ? "模型密钥已持久化到本地 Gateway，服务重启和浏览器更换后仍可继续使用。"
              : "Gateway 在电脑本机代理模型请求，保存后密钥只写入本机配置，可跨浏览器复用。"
            : "直连模式由浏览器直接请求服务商，可能受 CORS 限制。"}
        </p>
      </div>

      <div className="form-section-title">语音与记忆</div>
      <label className="toggle-row">
        <span>
          <strong>自动播放角色语音</strong>
          <small>收到语音消息后直接播放</small>
        </span>
        <input
          type="checkbox"
          checked={draft.voice.autoPlay}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              voice: { ...current.voice, autoPlay: event.target.checked },
            }))
          }
        />
        <i />
      </label>
      <label className="toggle-row">
        <span>
          <strong>长期记忆</strong>
          <small>允许角色根据历史互动形成记忆摘要</small>
        </span>
        <input
          type="checkbox"
          checked={draft.memory.longTerm}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              memory: { ...current.memory, longTerm: event.target.checked },
            }))
          }
        />
        <i />
      </label>
    </Sheet>
  );
}

function CreateCharacterSheet({ onClose, onCreate }) {
  const [draft, setDraft] = useState({
    name: "",
    handle: "",
    persona: "",
    tags: "",
    accent: "#ef6a5b",
  });

  const update = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Sheet
      title="创建角色"
      eyebrow="从一句自我介绍开始"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!draft.name.trim()}
            onClick={() => onCreate(draft)}
          >
            <Plus size={18} /> 创建角色
          </button>
        </>
      }
    >
      <div className="create-preview">
        <Avatar
          name={draft.name || "新"}
          accent={draft.accent}
          size={66}
          online
        />
        <div>
          <strong>{draft.name || "未命名角色"}</strong>
          <span>{draft.handle || "刚刚来到你的小手机"}</span>
        </div>
      </div>

      <div className="form-stack">
        <label>
          <span>角色名称</span>
          <input
            value={draft.name}
            onChange={(event) => update("name", event.target.value)}
            placeholder="例如：江屿"
          />
        </label>
        <label>
          <span>身份与一句话简介</span>
          <input
            value={draft.handle}
            onChange={(event) => update("handle", event.target.value)}
            placeholder="例如：住在海边的旧书店老板"
          />
        </label>
        <label>
          <span>角色设定</span>
          <textarea
            value={draft.persona}
            onChange={(event) => update("persona", event.target.value)}
            placeholder="写清楚性格、说话方式、经历和边界..."
            rows={5}
          />
        </label>
        <label>
          <span>关键词</span>
          <input
            value={draft.tags}
            onChange={(event) => update("tags", event.target.value)}
            placeholder="温柔，慢热，会记住小事"
          />
        </label>
        <div className="color-field">
          <span>角色标识色</span>
          <div>
            {["#ef6a5b", "#6678d7", "#2e9c78", "#c88c3f", "#a969c9"].map(
              (color) => (
                <button
                  type="button"
                  key={color}
                  className={draft.accent === color ? "is-active" : ""}
                  style={{ "--swatch": color }}
                  onClick={() => update("accent", color)}
                  aria-label={`选择颜色 ${color}`}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function EditCharacterSheet({ character, onClose, onSave }) {
  const [draft, setDraft] = useState({
    ...character,
    tagsText: character.tags.join("，"),
  });

  return (
    <Sheet
      title={`编辑 ${character.name}`}
      eyebrow="角色设定与记忆"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              onSave({
                ...draft,
                tags: draft.tagsText
                  .split(/[,\s，]+/)
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
          >
            <Check size={18} /> 保存
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label>
          <span>角色名称</span>
          <input
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label>
          <span>身份简介</span>
          <input
            value={draft.handle}
            onChange={(event) =>
              setDraft((current) => ({ ...current, handle: event.target.value }))
            }
          />
        </label>
        <label>
          <span>角色设定</span>
          <textarea
            value={draft.persona}
            rows={5}
            onChange={(event) =>
              setDraft((current) => ({ ...current, persona: event.target.value }))
            }
          />
        </label>
        <label>
          <span>记忆摘要</span>
          <textarea
            value={draft.memory}
            rows={3}
            onChange={(event) =>
              setDraft((current) => ({ ...current, memory: event.target.value }))
            }
          />
        </label>
        <label>
          <span>关键词</span>
          <input
            value={draft.tagsText}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                tagsText: event.target.value,
              }))
            }
          />
        </label>
      </div>
    </Sheet>
  );
}

function MemorySheet({
  characters,
  threads,
  settings,
  onClose,
  notify,
  onApplyMemories,
}) {
  const [extractingId, setExtractingId] = useState(null);
  const [candidates, setCandidates] = useState({});

  const extractForCharacter = async (character) => {
    const thread = threads.find((item) => item.characterId === character.id);
    const messages = (thread?.messages || [])
      .filter((message) => message.text && message.type !== "voice")
      .slice(-24)
      .map((message) => ({
        role: message.role,
        content: message.text,
      }));

    if (!messages.length) {
      notify("这个角色还没有可用于提取记忆的对话");
      return;
    }
    if (!settings.api.enabled || !settings.api.gatewayUrl) {
      notify("请先连接本地 AI Gateway 和模型服务");
      return;
    }

    setExtractingId(character.id);
    try {
      const result = await extractMemories(settings.api.gatewayUrl, {
        ...settings.api,
        providerKey: settings.api.apiKey,
        character,
        messages,
      });
      setCandidates((current) => ({
        ...current,
        [character.id]: result.memories || [],
      }));
      notify(
        "已提取 " +
          (result.memories || []).length +
          " 条候选记忆，请确认后写入",
      );
    } catch (error) {
      notify("记忆提取失败：" + error.message);
    } finally {
      setExtractingId(null);
    }
  };

  const applyCandidates = (characterId) => {
    const memories = candidates[characterId] || [];
    onApplyMemories(characterId, memories);
    setCandidates((current) => {
      const next = { ...current };
      delete next[characterId];
      return next;
    });
    notify("候选记忆已写入角色长期记忆");
  };

  return (
    <Sheet
      title="长期记忆"
      eyebrow="Extract · Confirm · Persist"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="primary-button primary-button--wide"
          onClick={onClose}
        >
          <Check size={18} /> 完成
        </button>
      }
    >
      <div className="memory-overview">
        <BrainCircuit size={24} />
        <div>
          <strong>{characters.length} 个角色已开启记忆</strong>
          <span>模型只生成候选，写入前由你确认</span>
        </div>
      </div>
      <div className="memory-list">
        {characters.map((character) => (
          <div className="memory-item" key={character.id}>
            <Avatar
              src={character.avatar}
              name={character.name}
              accent={character.accent}
              size={42}
            />
            <div className="memory-item__body">
              <div className="memory-item__heading">
                <strong>{character.name}</strong>
                <button
                  type="button"
                  disabled={extractingId === character.id}
                  onClick={() => extractForCharacter(character)}
                >
                  <RefreshCw size={13} />
                  {extractingId === character.id ? "提取中..." : "提取记忆"}
                </button>
              </div>
              <p>{character.memory}</p>
              {character.memoryItems?.length ? (
                <div className="memory-facts">
                  {character.memoryItems.slice(-4).map((memory, index) => (
                    <span key={memory.content + index}>
                      {memory.type} · {memory.content}
                    </span>
                  ))}
                </div>
              ) : null}
              {candidates[character.id]?.length ? (
                <div className="memory-candidates">
                  <div>
                    <strong>模型候选</strong>
                    <small>{candidates[character.id].length} 条</small>
                  </div>
                  {candidates[character.id].map((memory, index) => (
                    <div key={memory.content + index}>
                      <span>{memory.type || "fact"}</span>
                      <p>{memory.content}</p>
                      <small>
                        重要度 {memory.importance || 3} · 置信度{" "}
                        {Math.round((Number(memory.confidence) || 0.8) * 100)}%
                      </small>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => applyCandidates(character.id)}
                  >
                    <Check size={15} /> 确认写入
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function LocalDataSheet({ onClose, notify, counts }) {
  return (
    <Sheet
      title="本地数据"
      eyebrow="Local First"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="danger-button danger-button--wide"
          onClick={() => notify("演示数据不会被自动删除")}
        >
          <Trash2 size={18} /> 清理本地数据
        </button>
      }
    >
      <div className="data-stats">
        <div>
          <strong>{counts.characters}</strong>
          <span>角色</span>
        </div>
        <div>
          <strong>{counts.threads}</strong>
          <span>会话</span>
        </div>
        <div>
          <strong>{counts.messages}</strong>
          <span>消息</span>
        </div>
      </div>
      <div className="data-actions">
        <button
          type="button"
          onClick={() => notify("已准备导出文件；原生端可调用系统分享")}
        >
          <Share2 size={19} />
          <span>
            <strong>导出本地数据</strong>
            <small>生成可迁移的 JSON 文件</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <button
          type="button"
          onClick={() => notify("备份功能可在 Android 端写入应用私有目录")}
        >
          <Database size={19} />
          <span>
            <strong>创建备份</strong>
            <small>保留角色设定、记忆与会话</small>
          </span>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="privacy-note">
        <Wifi size={18} />
        <p>应用不会自动上传你的角色、聊天记录与模型密钥。</p>
      </div>
    </Sheet>
  );
}

export default App;
