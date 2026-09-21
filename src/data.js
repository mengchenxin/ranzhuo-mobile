export const initialCharacters = [
  {
    id: "jiang-yu",
    name: "江屿",
    handle: "住在海边的旧书店老板",
    avatar:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&q=80",
    accent: "#ef6a5b",
    online: true,
    affinity: 86,
    lastSeen: "刚刚在线",
    tags: ["温柔", "慢热", "会记住小事"],
    persona:
      "二十八岁，在海边经营一家旧书店。说话克制温和，会认真倾听。喜欢雨天、黑胶唱片和凌晨的便利店。",
    memory:
      "知道你最近在准备一个很重要的项目，也知道你不喜欢被反复催促。",
    unread: 0,
  },
  {
    id: "lin-wu",
    name: "林雾",
    handle: "夜班电台主播",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80",
    accent: "#6678d7",
    online: true,
    affinity: 72,
    lastSeen: "在线",
    tags: ["敏锐", "幽默", "夜猫子"],
    persona:
      "深夜电台主播，擅长用轻松的方式接住沉重的话题。习惯把生活里的细枝末节讲得很有趣。",
    memory: "你们约好每周五互相分享一首最近循环的歌。",
    unread: 2,
  },
  {
    id: "north-radio",
    name: "北岸电台",
    handle: "5 位成员的共同频道",
    avatar:
      "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=240&q=80",
    accent: "#2e9c78",
    online: true,
    affinity: 64,
    lastSeen: "阿澈、林雾在线",
    tags: ["群聊", "一起听"],
    persona:
      "一个由几位 AI 角色共同参与的小型夜间电台群聊，大家会分享音乐、电影和今天发生的琐事。",
    memory: "群成员记得你上次推荐的那张爵士专辑。",
    unread: 5,
    group: true,
  },
  {
    id: "chen-mian",
    name: "陈眠",
    handle: "看似冷淡的临床心理师",
    avatar:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&q=80",
    accent: "#c88c3f",
    online: false,
    affinity: 79,
    lastSeen: "2 小时前在线",
    tags: ["理性", "可靠", "边界感"],
    persona:
      "临床心理师，表达明确，不轻易给结论。比起安慰，更愿意陪你把事情一点点看清楚。",
    memory: "她记得你答应过，今天会早点结束工作。",
    unread: 0,
  },
  {
    id: "shen-lu",
    name: "沈鹿",
    handle: "在旅途中拍照的人",
    avatar:
      "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=240&q=80",
    accent: "#a969c9",
    online: false,
    affinity: 68,
    lastSeen: "昨天在线",
    tags: ["自由", "浪漫", "摄影"],
    persona:
      "一年里有一半时间在路上，喜欢用照片和很短的话记录遇见的人和天气。",
    memory: "她答应下次路过海边时，会替你看一场日落。",
    unread: 0,
  },
];

export const initialThreads = [
  {
    id: "jiang-yu",
    characterId: "jiang-yu",
    updatedAt: "18:42",
    preview: "刚到家。今天风很大，你那边呢？",
    messages: [
      {
        id: "jy-1",
        role: "assistant",
        text: "今天关店比平时早一点。",
        time: "18:36",
      },
      {
        id: "jy-2",
        role: "user",
        text: "那你现在在做什么？",
        time: "18:40",
        read: true,
      },
      {
        id: "jy-3",
        role: "assistant",
        text: "刚到家。今天风很大，你那边呢？",
        time: "18:42",
      },
    ],
  },
  {
    id: "lin-wu",
    characterId: "lin-wu",
    updatedAt: "17:58",
    preview: "[语音] 00:18",
    messages: [
      {
        id: "lw-1",
        role: "assistant",
        type: "voice",
        duration: 18,
        text: "我刚刚在节目里放了你上次说的那首歌。",
        time: "17:58",
      },
    ],
  },
  {
    id: "north-radio",
    characterId: "north-radio",
    updatedAt: "16:21",
    preview: "阿澈：今晚一起听这张吧",
    messages: [
      {
        id: "nr-1",
        role: "assistant",
        sender: "阿澈",
        text: "今晚一起听这张吧，第一首很适合散步。",
        time: "16:21",
      },
    ],
  },
  {
    id: "chen-mian",
    characterId: "chen-mian",
    updatedAt: "昨天",
    preview: "我记住了，下次提醒你。",
    messages: [
      {
        id: "cm-1",
        role: "assistant",
        text: "我记住了，下次提醒你。",
        time: "昨天 22:14",
      },
    ],
  },
  {
    id: "shen-lu",
    characterId: "shen-lu",
    updatedAt: "周一",
    preview: "[图片] 海边的落日",
    messages: [
      {
        id: "sl-1",
        role: "assistant",
        type: "image",
        image:
          "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=82",
        text: "替你先看了一场。",
        time: "周一 19:06",
      },
    ],
  },
];

export const moments = [
  {
    id: "moment-1",
    characterId: "shen-lu",
    content: "风把云吹开的时候，海面突然亮了一下。",
    time: "18 分钟前",
    location: "福建 · 平潭",
    image:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=84",
    likes: 12,
    comments: 3,
  },
  {
    id: "moment-2",
    characterId: "jiang-yu",
    content: "旧书里夹着一张 2012 年的车票。有人替它找到了新的故事。",
    time: "1 小时前",
    image:
      "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=84",
    likes: 8,
    comments: 1,
  },
];

export const forumTopics = [
  {
    id: "topic-1",
    label: "角色共创",
    title: "怎样让角色的长期记忆更自然，而不是像一本设定集？",
    meta: "38 个回应 · 12 分钟前",
    color: "#ef6a5b",
  },
  {
    id: "topic-2",
    label: "深夜电台",
    title: "今晚循环：适合下雨天一个人听的五张专辑",
    meta: "21 个回应 · 46 分钟前",
    color: "#6678d7",
  },
  {
    id: "topic-3",
    label: "生活碎片",
    title: "记录一下最近被 AI 角色记住的小事",
    meta: "53 个回应 · 昨天",
    color: "#2e9c78",
  },
];

export const quickReplies = [
  "我在。",
  "今天过得怎么样？",
  "想听听你的声音。",
  "慢慢说，不着急。",
];
