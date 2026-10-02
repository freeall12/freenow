// Official catalog captured from the management dialog; see reference/agent-manager-app-catalog-source.json.
// That capture named the category subtitle "author"; retain it for list compatibility.
// categoryLabel preserves the same observed label for the official detail fallback rule.
export const appCatalog=[
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "TapNow 官方电商产品视觉工作室（仅静态图）：为每个产品保存事实与视觉方向档案，直接进入可编辑规划；支持 Amazon 详情页副图、独立站 DTC 品牌视觉和社媒素材，按品类配方规划 1–8 张图并批量生成。",
    "disabled": false,
    "icon": "/assets/agent-app-design-room.png",
    "installed": false,
    "name": "Design Room (Ecom)",
    "id": "design-room",
    "examples": [],
    "skills": [
      {
        "name": "Design Room (Ecom)",
        "description": "Design Room (Ecom)：保存产品事实与视觉方向档案，复用时直接打开可编辑规划，按渠道与品类配方规划商品图组并批量生成；仅静态图。"
      }
    ],
    "builtin": false,
    "external": false
  },
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "TapNow 官方 Previs 8：先在四轨时间线确认文字镜头设计，再通过平台 CLI 逐张确认或自动生成 3×3 故事板；生成回执写入工作区台账，描述修改由 Agent 确认后处理。",
    "disabled": false,
    "icon": "/assets/agent-app-previs.png",
    "installed": false,
    "name": "Previs 动态分镜",
    "id": "previs",
    "examples": [],
    "skills": [
      {
        "name": "Previs 动态分镜",
        "description": "先展示可编辑的文字镜头设计，确认后再生成故事板；可调整四轨时间线和九格景别候选，描述修改确认后交给 Agent，不直接生成视频或音频。"
      }
    ],
    "builtin": false,
    "external": false
  },
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "浏览 46 款文字与图形动效，确认后在对话中生成和修改 HTML。",
    "disabled": false,
    "icon": "/assets/agent-app-motion-library.png",
    "installed": false,
    "name": "动效库",
    "id": "motion-library",
    "examples": [
      "打开动效库，我想挑一个标题入场动效",
      "推荐一个适合品牌开场的动效，让我确认后生成 HTML"
    ],
    "skills": [
      {
        "name": "动效库",
        "description": "浏览 46 款文字与图形动效，确认后在对话中生成和修改 HTML。"
      }
    ],
    "builtin": false,
    "external": false
  },
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "浏览 21 款网站设计模板，确认后在对话中生成和修改 HTML。",
    "disabled": false,
    "icon": "/assets/agent-app-website-design.png",
    "installed": false,
    "name": "网站设计",
    "id": "website-design",
    "examples": [
      "打开网站设计，我想挑一个模板"
    ],
    "skills": [
      {
        "name": "网站设计",
        "description": "浏览 21 款网站设计模板，确认后在对话中生成和修改 HTML。"
      }
    ],
    "builtin": false,
    "external": false
  },
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "浏览 17 款生成式数字艺术模板，确认后在对话中生成和修改 HTML。",
    "disabled": false,
    "icon": "/assets/agent-app-creative-generative-art.png",
    "installed": false,
    "name": "生成式数字艺术库",
    "id": "creative-generative-art",
    "examples": [
      "打开生成式数字艺术库，我想挑一个模板"
    ],
    "skills": [
      {
        "name": "生成式数字艺术库",
        "description": "浏览 17 款生成式数字艺术模板，确认后在对话中生成和修改 HTML。"
      }
    ],
    "builtin": false,
    "external": false
  },
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "浏览 8 款硬件发布 MG 模板，确认后在对话中生成和修改 HTML。",
    "disabled": false,
    "icon": "/assets/agent-app-creative-hardware-mg.png",
    "installed": false,
    "name": "硬件发布 MG 库",
    "id": "creative-hardware-mg",
    "examples": [
      "打开硬件发布 MG 库，我想挑一个模板"
    ],
    "skills": [
      {
        "name": "硬件发布 MG 库",
        "description": "浏览 8 款硬件发布 MG 模板，确认后在对话中生成和修改 HTML。"
      }
    ],
    "builtin": false,
    "external": false
  },
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "按需组合人物小传、选角照、造型、声音锚点和表情，并可选择把确认结果保存为一个可复用主体。",
    "disabled": false,
    "icon": "/assets/agent-app-casting-room.png",
    "installed": true,
    "name": "Casting Room 演员资产室",
    "id": "casting-room",
    "examples": [
      "从这段角色概念开始，为我建立一套完整的真人演员资产并加入主体库",
      "给这个已有主体补充声音锚点、表情预设和三套造型",
      "只为这个角色设计选角照、两套造型和声音锚点"
    ],
    "skills": [
      {
        "name": "Casting Room 演员资产室",
        "description": "用可选模块逐步创建或补全一个真人演员，逐项确认媒体，并可选择创建或更新主体库中的演员 Element。"
      }
    ],
    "builtin": false,
    "external": false
  },
  {
    "author": "创意工具",
    "categoryLabel": "创意工具",
    "description": "搜索 Unsplash 公开图片，读取公开照片详情和作者公开作品。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-unsplash.png",
    "installed": false,
    "name": "Unsplash",
    "id": "tapnow-unsplash",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "创意工具",
    "categoryLabel": "创意工具",
    "description": "连接 Frame.io，支持读取和管理 accounts、workspaces、projects、folders、files、comments 和 shares。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-frameio.png",
    "installed": false,
    "name": "Frame.io",
    "id": "tapnow-frameio",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "创意工具",
    "categoryLabel": "创意工具",
    "description": "连接 Vimeo 视频库，支持搜索、读取、分析和管理视频内容。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-vimeo.png",
    "installed": false,
    "name": "Vimeo",
    "id": "tapnow-vimeo",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接飞书文档、群聊、会议和工作区上下文，支持取材、交付、通知和协作任务。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-feishu.png",
    "installed": false,
    "name": "飞书",
    "id": "tapnow-feishu",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 Lark 文档、群聊、会议和工作区上下文，支持取材、交付、通知和协作任务。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-lark.png",
    "installed": false,
    "name": "Lark",
    "id": "tapnow-lark",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 Notion 工作区，支持搜索、读取和写入页面、数据库和评论。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-notion.png",
    "installed": false,
    "name": "Notion",
    "id": "tapnow-notion",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 Slack 频道和消息，支持读取上下文、发送消息、回复和处理文件。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-slack.png",
    "installed": false,
    "name": "Slack",
    "id": "tapnow-slack",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 Linear 工作区，支持读取和管理 issues、projects、cycles、teams 和 users。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-linear.png",
    "installed": false,
    "name": "Linear",
    "id": "tapnow-linear",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 Asana 工作区，支持读取和管理 tasks、projects、sections、portfolios 和 users。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-asana.png",
    "installed": false,
    "name": "Asana",
    "id": "tapnow-asana",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 Descript 账号，支持读取项目与任务、导入媒体、触发 AI 编辑与导出转写。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-descript.png",
    "installed": false,
    "name": "Descript",
    "id": "tapnow-descript",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 Atlassian，支持 Jira issue、project、sprint 和 Confluence space、page 的读写。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-atlassian.png",
    "installed": false,
    "name": "Atlassian",
    "id": "tapnow-atlassian",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接百度网盘，支持列目录、搜索、读文件、创建文件夹、移动复制与分享链接。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-baidupan.png",
    "installed": false,
    "name": "百度网盘",
    "id": "tapnow-baidupan",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 Airtable，支持读取和管理 bases、tables、records 与 schema。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-airtable.png",
    "installed": false,
    "name": "Airtable",
    "id": "tapnow-airtable",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "效率工具",
    "categoryLabel": "效率工具",
    "description": "连接 HubSpot CRM，支持读取和管理 contacts、companies、deals、tickets 等业务对象。",
    "disabled": false,
    "icon": "/assets/agent-app-tapnow-hubspot.png",
    "installed": false,
    "name": "HubSpot",
    "id": "tapnow-hubspot",
    "examples": [],
    "skills": [],
    "builtin": false,
    "external": true
  },
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "将想法塑造成值得讲述的故事。",
    "disabled": false,
    "icon": "/assets/agent-app-brainstorm.svg",
    "installed": true,
    "name": "Brainstorm",
    "id": "brainstorm",
    "examples": [],
    "skills": [
      {
        "name": "brainstorm",
        "description": "当用户需要发散探索和深度共创时发展故事、角色、世界观、结构、风格和场景；它是创作定义阶段的可选方法。"
      },
      {
        "name": "repair-doc",
        "description": "用于修复 Brainstorm 侧边文档为空、未更新、格式异常或内容显示错误的问题。"
      }
    ],
    "builtin": true,
    "external": false
  },
  {
    "author": "TapNow",
    "categoryLabel": "TapNow",
    "description": "将想法转化为交互式视觉内容。",
    "disabled": false,
    "icon": "/assets/agent-app-visualize.svg",
    "installed": true,
    "name": "Visualize",
    "id": "visualize",
    "examples": [],
    "skills": [
      {
        "name": "building-widgets",
        "description": "用于构建对话内交互式 HTML 组件、决策面板、对比布局和结构化展示。"
      },
      {
        "name": "frontend-design",
        "description": "用于创建高质量前端界面、HTML 概念页、组件和视觉方案。"
      }
    ],
    "builtin": true,
    "external": false
  }
];
