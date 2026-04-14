/* ═══════════════════════════════════════════
   NEXTFRAME STUDIO — Constants & Presets
   ═══════════════════════════════════════════ */

// ─── Theme System ───
const LIGHT = {
  bg: "#f5f5f0", bg1: "#ffffff", bg2: "#fafaf7", bg3: "#eeeee8",
  card: "#ffffff", cardHover: "#f8f8f4",
  border: "rgba(0,0,0,0.07)", borderL: "rgba(0,0,0,0.12)",
  text: "#3d3d3a", dim: "#8a8a82", muted: "#c5c5bc",
  hi: "#1a1a18",
  red: "#d9453a", redG: "rgba(217,69,58,0.08)",
  grn: "#1a9a6e", grnG: "rgba(26,154,110,0.08)",
  blu: "#3b7dd8", bluG: "rgba(59,125,216,0.08)",
  pur: "#7c5cbf", purG: "rgba(124,92,191,0.08)",
  amb: "#c8850a", ambG: "rgba(200,133,10,0.08)",
  cyn: "#0e8e9e", cynG: "rgba(14,142,158,0.08)",
};

const DARK = {
  bg: "#0f1117", bg1: "#1a1d27", bg2: "#14161f", bg3: "#1e2130",
  card: "#1a1d27", cardHover: "#22253a",
  border: "rgba(255,255,255,0.08)", borderL: "rgba(255,255,255,0.14)",
  text: "#c8cad0", dim: "#6b7084", muted: "#3e4255",
  hi: "#eef0f4",
  red: "#ef5350", redG: "rgba(239,83,80,0.12)",
  grn: "#4caf88", grnG: "rgba(76,175,136,0.12)",
  blu: "#5b9cf0", bluG: "rgba(91,156,240,0.12)",
  pur: "#9b7ed8", purG: "rgba(155,126,216,0.12)",
  amb: "#e8a830", ambG: "rgba(232,168,48,0.12)",
  cyn: "#26b5c5", cynG: "rgba(38,181,197,0.12)",
};

// Mutable theme reference — updated by setThemeMode()
export let T = { ...LIGHT };

export function setThemeMode(mode) {
  const src = mode === "dark" ? DARK : LIGHT;
  Object.assign(T, src);
}

export function getThemeMode() {
  return T.bg === DARK.bg ? "dark" : "light";
}

// ─── Pipeline Phases ───
export const PHASES = [
  { key: "script", label: "腳本", en: "Script", icon: "✎", color: T.blu, glow: T.bluG },
  { key: "assets", label: "美術設定", en: "Art Design", icon: "🎭", color: T.cyn, glow: T.cynG },
  { key: "storyboard", label: "分鏡", en: "Storyboard", icon: "▦", color: T.pur, glow: T.purG },
  { key: "video", label: "影片", en: "Video", icon: "⚡", color: T.red, glow: T.redG },
];

// ─── Directors ───
export const DIRECTORS = [
  { id: "nolan",      name: "Christopher Nolan",   desc: "IMAX 大場面、實拍、時間敘事、低角度仰拍" },
  { id: "deakins",    name: "Roger Deakins",       desc: "自然光大師、極簡構圖、負空間、精準單光源" },
  { id: "villeneuve", name: "Denis Villeneuve",     desc: "超寬建立鏡頭、霧氣氛圍、冷色調、壓迫感" },
  { id: "kubrick",    name: "Stanley Kubrick",      desc: "單點透視、對稱構圖、超廣角、長走廊跟拍" },
  { id: "fincher",    name: "David Fincher",        desc: "暗調低飽和、精密運鏡、頂光陰影" },
  { id: "lubezki",    name: "Emmanuel Lubezki",     desc: "超長單鏡頭、自然光、手持跟拍、magic hour" },
  { id: "wongkarwai", name: "王家衛 Wong Kar-wai",   desc: "抽格印刷、霓虹反射、慢動作、框中框" },
  { id: "kurosawa",   name: "黑澤明 Akira Kurosawa", desc: "動態構圖、雨雪天氣、多機位剪接" },
  { id: "parkCW",     name: "朴贊郁 Park Chan-wook", desc: "極端角度、色彩象徵、暴力美學" },
  { id: "scott",      name: "Ridley Scott",         desc: "工業科幻、煙霧體積光、逆光剪影" },
  { id: "spielberg",  name: "Steven Spielberg",     desc: "Spielberg Face、推軌變焦、情感高光" },
  { id: "anderson",   name: "Wes Anderson",         desc: "完美對稱、柔和粉彩、平移橫搖" },
  { id: "snyder",     name: "Zack Snyder",          desc: "Speed ramp、高對比、漫畫式構圖" },
  { id: "michaelbay", name: "Michael Bay",          desc: "低角度英雄鏡頭、360度環繞、爆炸特效、橘黃藍補色、Baysplosion" },
  { id: "miyazaki",   name: "宮崎駿 Hayao Miyazaki", desc: "自然飛行感、雲層光影、日常動作細節" },
  { id: "tarkovsky",  name: "Andrei Tarkovsky",     desc: "超長凝視、水面倒影、廢墟詩意" },
  { id: "satoshikon", name: "今敏 Satoshi Kon",      desc: "現實與夢境無縫轉場、Match Cut、心理蒙太奇" },
  { id: "shinkai",    name: "新海誠 Makoto Shinkai",  desc: "超精緻光影、雲與天空、情感色彩分級" },
  { id: "oshii",      name: "押井守 Mamoru Oshii",    desc: "靜態長鏡頭、都市廢墟、哲學獨白" },
  { id: "otomo",      name: "大友克洋 Katsuhiro Otomo", desc: "超高密度細節、爆炸崩壞動態" },
  { id: "tarantino",  name: "Quentin Tarantino",    desc: "低角度Trunk Shot、分章節、特寫對話" },
  { id: "coenBros",   name: "Coen Brothers",        desc: "荒誕構圖、廣角畸變、極端POV" },
  { id: "lynch",      name: "David Lynch",           desc: "超現實夢境、工業噪音、極度特寫" },
];

// ─── Cinematography Styles ───
export const CINE_STYLES = [
  { id: "cinematic",   name: "電影感",        desc: "Anamorphic 變形寬銀幕、淺景深、2.39:1、電影色彩分級、Arri Alexa 質感" },
  { id: "anime",       name: "動畫攝影",      desc: "多平面鏡頭、誇張透視、賽璐珞質感、動態模糊、速度線" },
  { id: "mv",          name: "MV 攝影",       desc: "快剪節奏、打光跳色、Speed ramp、風格化色彩、lens flare" },
  { id: "documentary", name: "紀錄片",        desc: "手持跟拍、自然光、長鏡頭、訪談構圖、真實感" },
  { id: "filmnoir",    name: "黑色電影",      desc: "高對比黑白、百葉窗光影、低調打光、剪影、煙霧" },
  { id: "commercial",  name: "商業廣告",      desc: "高飽和、產品微距、完美布光、slow motion、乾淨構圖" },
  { id: "indie",       name: "獨立電影",      desc: "自然主義、available light、16mm 膠片質感、手持呼吸感" },
  { id: "horror",      name: "恐怖/驚悚",     desc: "Dutch angle、不穩定手持、暗部曝光不足、jump scare 節奏" },
  { id: "scifi",       name: "科幻未來",      desc: "霓虹 cyberpunk、體積光、HUD overlay、冷藍色調、全息投影" },
  { id: "vintage",     name: "復古膠片",      desc: "8mm/Super 16 顆粒、褪色暖調、光漏 light leak、圓角暗角" },
  { id: "aerial",      name: "航拍/空拍",     desc: "鳥瞰構圖、FPV 穿越、大景深、地景人物對比" },
  { id: "gamecg",      name: "遊戲 CG",       desc: "Unreal Engine 風格、即時渲染、角色動態模糊、粒子特效" },
  { id: "vertical",    name: "垂直短影音",    desc: "9:16 直式構圖、快節奏剪輯、字幕疊加、hook 開場" },
];

// ─── Render Styles ───
export const RENDER_STYLES = [
  { id: "filmnoir",   name: "黑色電影",     prompt: "classic film noir style: high contrast black and white, deep shadows, venetian blind light patterns, 1940s detective movie aesthetic" },
  { id: "watercolor", name: "水彩畫",       prompt: "delicate watercolor painting style: soft washes, visible brush strokes, paper texture, bleeding colors, artistic and ethereal" },
  { id: "anime",      name: "日本動畫",     prompt: "Japanese anime cel-shaded illustration style: clean outlines, flat colors, expressive eyes, manga-influenced composition, Studio Ghibli quality" },
  { id: "oilpaint",   name: "油畫",         prompt: "classical oil painting style: thick impasto brush strokes, rich warm palette, renaissance chiaroscuro lighting, museum gallery quality" },
  { id: "comic",      name: "美式漫畫",     prompt: "American graphic novel style: bold ink outlines, Ben-Day dots halftone, dramatic panel composition, Marvel/DC comic book aesthetic" },
  { id: "cyberpunk",  name: "賽博龐克",     prompt: "cyberpunk neon style: glowing neon signs, rain-slicked streets, holographic overlays, Blade Runner 2049 color palette, futuristic dystopia" },
  { id: "pixel",      name: "像素藝術",     prompt: "retro pixel art style: 16-bit game aesthetic, limited color palette, visible pixels, nostalgic video game look" },
  { id: "3dcg",       name: "3D CG 渲染",   prompt: "Pixar/Disney 3D CG render style: subsurface scattering, global illumination, stylized realistic characters, soft ambient occlusion" },
  { id: "sketch",     name: "鉛筆素描",     prompt: "pencil sketch on white paper: detailed cross-hatching, graphite shading, loose gestural lines, concept art sketchbook style" },
  { id: "ukiyoe",     name: "浮世繪",       prompt: "Japanese ukiyo-e woodblock print style: flat areas of color, bold outlines, wave patterns, Hokusai and Hiroshige inspired" },
  { id: "infrared",   name: "紅外線攝影",   prompt: "infrared photography style: false color, white foliage, dark sky, surreal dreamlike atmosphere, IR film simulation" },
  { id: "miniature",  name: "微縮模型",     prompt: "tilt-shift miniature effect: extremely shallow depth of field, saturated colors, making real scenes look like tiny scale models" },
  { id: "vaporwave",  name: "蒸氣波",       prompt: "vaporwave aesthetic: pink and purple gradients, retro 80s/90s, glitch effects, Greek statues, sunset grid, nostalgic surrealism" },
  { id: "ghibli",     name: "吉卜力風",     prompt: "Studio Ghibli hand-drawn animation style: lush natural backgrounds, soft pastel colors, detailed environmental art, Miyazaki whimsical touch" },
  { id: "blueprint",  name: "藍圖/線稿",    prompt: "technical blueprint style: white lines on blue background, engineering drawing, orthographic projection, technical specifications" },
];

// ─── Lens & Lighting Presets ───
export const LENSES = [
  { id: "14mm",  name: "14mm 超廣角", desc: "extreme wide angle, deep depth of field, dramatic perspective distortion" },
  { id: "24mm",  name: "24mm 廣角",   desc: "wide angle lens 24mm, deep focus, establishing shot feel" },
  { id: "35mm",  name: "35mm 標準廣", desc: "35mm lens, natural perspective, slight wide angle, documentary feel" },
  { id: "50mm",  name: "50mm 標準",   desc: "50mm standard lens, natural human eye perspective, balanced" },
  { id: "85mm",  name: "85mm 人像",   desc: "85mm portrait lens, shallow depth of field, beautiful bokeh, compressed background" },
  { id: "135mm", name: "135mm 長焦",  desc: "135mm telephoto, very shallow DOF, background compression, intimate" },
  { id: "200mm", name: "200mm 壓縮",  desc: "200mm telephoto, extreme background compression, flattened perspective, voyeuristic" },
];

export const LIGHTINGS = [
  { id: "daytime",   name: "白天",     desc: "bright daylight, clear sky, natural sunlight, midday sun, even outdoor lighting, blue sky" },
  { id: "nighttime", name: "夜晚",     desc: "nighttime scene, dark sky, moonlight, street lights, ambient city glow, cool blue tones, night atmosphere" },
  { id: "golden",    name: "黃金時刻", desc: "warm golden hour sunlight, long shadows, golden rim light, magic hour" },
  { id: "blue",      name: "藍色時刻", desc: "cool blue hour twilight, ambient blue tone, city lights emerging" },
  { id: "rembrandt", name: "倫勃朗光", desc: "Rembrandt lighting, triangle of light on cheek, single key light 45 degrees, dramatic chiaroscuro" },
  { id: "rim",       name: "逆光",     desc: "strong backlight rim lighting, silhouette edge glow, hair light, lens flare" },
  { id: "highkey",   name: "高調光",   desc: "high key lighting, bright even exposure, minimal shadows, clean and airy" },
  { id: "lowkey",    name: "低調光",   desc: "low key lighting, deep shadows, single hard light source, noir atmosphere" },
  { id: "neon",      name: "霓虹光",   desc: "neon lighting, colorful neon reflections, cyan and magenta, wet street reflections, cyberpunk" },
  { id: "practical", name: "實景光源", desc: "practical lighting only, motivated light sources within the scene, naturalistic" },
  { id: "toplight",  name: "頂光",     desc: "harsh overhead top light, deep eye socket shadows, interrogation feel, dramatic" },
  { id: "volumetric",name: "體積光",   desc: "volumetric god rays, light shafts through haze, dust particles, atmospheric" },
];

// ─── Style Presets for Shot List generation (Claude) ───
export const STORYBOARD_STYLE_PRESETS = {
  anime: {
    label: "🎌 日式動漫",
    prompt: `【風格：日式動漫 Japanese Anime】
你必須以日本動畫的鏡頭語言來拆分鏡表。遵循以下原則：
- 景別偏好：善用「大遠景人物渺小」建立世界觀、「極端特寫眼睛/嘴唇」表達情緒
- 運鏡偏好：多用 Match Cut、靜止長鏡（留白凝望 3-5 秒）、快速閃回蒙太奇
- 光線偏好：丁達爾光束、散景光暈、黃昏逆光剪影
- 節奏：日式動漫慣用「靜→靜→突然爆發」的節奏
- 音效描述要包含：環境音層次、BGM 情緒`,
  },
  liveaction: {
    label: "🎬 真人電影",
    prompt: `【風格：真人電影 Live Action Film】
你必須以好萊塢/專業電影的鏡頭語言來拆分鏡表。遵循以下原則：
- 景別偏好：遵循「建立鏡頭→中景→近景→反應鏡頭」的經典剪輯邏輯
- 運鏡偏好：Dolly 推軌、Steadicam 跟拍、搖臂升降、手持（緊張場景）
- 角度偏好：180度軸線法則、正反打對話、Over-the-shoulder
- 節奏：遵循三幕劇結構，對話場景用中景正反打，動作場景加快剪輯`,
  },
};

// ─── AI System Prompt: Script → Shot List (Claude) ───
export const buildShotListPrompt = (styleKey) => {
  const styleBlock = STORYBOARD_STYLE_PRESETS[styleKey]?.prompt || STORYBOARD_STYLE_PRESETS.liveaction.prompt;
  return `你是專業的電影分鏡師，擅長將劇本文字拆解成結構化的分鏡表。

${styleBlock}

【任務】將使用者提供的腳本拆解為一格一格的分鏡，並按每 15 秒一組分配 Segment。

【輸出要求】
你必須只輸出一個 JSON 陣列，不要輸出任何其他文字、markdown 或解釋。
每個元素代表一格分鏡，格式如下：

[
  {
    "segment": 1,
    "segmentName": "段落名稱（例：開場環境建立）",
    "desc": "畫面描述：詳細描述這一格看到什麼（角色動作、表情、環境細節、光線氛圍）",
    "shotSize": "景別",
    "angle": "角度",
    "movement": "運鏡",
    "duration": "預估秒數（例：3s/5s/8s）",
    "audio": "音效或對白",
    "nbEn": "English Nano Banana prompt for image generation: detailed character/scene description, lighting, composition, cinematic quality, 16:9"
  }
]

【規則】
- 每個 Segment 總秒數約 15 秒
- 每格 desc 要夠具體，讓人閉眼就能想像畫面
- 景別要有變化（遠→近→特寫），不要全部都是中景
- nbEn 欄位必須是完整的英文提示詞，可直接用於 Nano Banana 生成分鏡圖
- 只輸出 JSON，不要輸出其他任何文字`;
};

// ─── AI System Prompt: Storyboard → Seedance 2.0 Prompts ───
export const STORYBOARD_TO_PROMPT_PROMPT = `你是頂級的 Seedance 2.0 AI 視頻提示詞專家。你的任務是將分鏡表轉換為可直接貼入 Seedance 2.0 的提示詞。

一、Seedance 2.0 提示詞公式（每一段必須嚴格遵循）：
主體(Subject) + 動作(Action) + 鏡頭語言(Camera Language) + @參考素材 + 風格美學 + 音頻與音效 + 限制條件(Negative Prompts)

二、時間結構（每段恰好15秒）：
[風格/美學定義]
0-Xs：[景別(Shot Size)][角度(Angle)][運動(Movement)] [主體(Subject)] [動作(Action)] [光效細節(Lighting)] [音效(SFX)]
Xs-Ys：[景別][角度][運動] [主體] [動作] [光效] [音效]
Ys-15s：[景別][角度][運動] [主體] [動作] [光效] [音效]
@參考素材：@圖片1=角色外觀首幀參考 ｜@圖片2=場景環境 ｜@視頻1=動作/節奏參考 ｜@音頻1=BGM/節奏同步
限制條件：[不要出現的元素，例如：避免閃爍、避免畫面跳切、無文字浮水印]

三、@素材參考系統規則：
- @圖片1 / @Image1 — 角色外觀、首幀參考、風格參考
- @圖片2 / @Image2 — 場景環境參考
- @視頻1 / @Video1 — 動作參考、鏡頭運動參考、節奏參考
- @音頻1 / @Audio1 — BGM、節奏同步、音效參考
- 每段提示詞的「@參考素材」要具體說明每個素材的用途

四、鏡頭語言詞彙表：
景別：大遠景(Extreme Wide Shot) / 遠景(Wide Shot) / 全景(Full Shot) / 中景(Medium Shot) / 中近景(Medium Close-up) / 近景(Close-up) / 特寫(Close-up Detail) / 大特寫(Extreme Close-up)
角度：平角(Eye Level) / 俯角(High Angle) / 仰角(Low Angle) / 鳥瞰(Bird's Eye) / 荷蘭角(Dutch Angle) / 主觀視角(POV)
運鏡：固定(Static) / 推(Push In) / 拉(Pull Out) / 橫移(Pan/Track) / 跟拍(Follow) / 環繞(Orbit) / 手持(Handheld) / 升降(Crane) / Dolly Zoom

五、輸出格式：
你必須只輸出一個 JSON 陣列，不要輸出任何其他文字。每個元素代表一個 Segment（15秒）：

[
  {
    "segment": 1,
    "title": "第1段｜0-15秒｜段落名稱",
    "prompt": "完整的 Seedance 2.0 提示詞（中文，含時間碼結構、@參考素材、限制條件）。可直接複製貼入 Seedance 2.0。",
    "upload": "上傳素材建議：@圖片1 應上傳角色正面全身照、@圖片2 應上傳場景環境圖",
    "bridge": "銜接建議：續寫@視頻1，下一段描述..."
  }
]

六、規則：
- 每段 prompt 必須是完整可貼入的提示詞，包含時間碼、@參考素材、限制條件
- 時間碼精確到秒，每段總和恰好 15 秒
- 根據分鏡表中的景別、角度、運鏡直接對應到提示詞的鏡頭語言
- 音效/對白整合到時間碼中
- 限制條件要具體（例如：避免閃爍、避免畫面跳切、無文字浮水印、無 3D 感）
- 只輸出 JSON，不要輸出其他任何文字`;

// ─── AI System Prompt: Script → Assets extraction (Claude) ───
export const SCRIPT_TO_ASSETS_PROMPT = `你是專業的電影製作資產分析師，擅長從腳本中提取所有需要製作的視覺素材。

【任務】從使用者提供的腳本中，提取所有出現的角色、場景、道具。

【輸出要求】
你必須只輸出一個 JSON 物件，不要輸出任何其他文字、markdown 或解釋。

{
  "characters": [
    {
      "name": "角色名稱（英文）",
      "nameZh": "角色名稱（中文）",
      "gender": "male / female",
      "age": "年齡數字",
      "height": "身高 cm",
      "bodyType": "slim / athletic / average / muscular / curvy",
      "skinTone": "fair / medium / tan / dark",
      "eyeColor": "眼睛顏色英文",
      "hairStyle": "髮型描述英文",
      "ethnicity": "種族/國籍外觀",
      "outfit": "服裝描述英文",
      "character": "角色性格特質英文（1-3個詞）",
      "voice": "聲線特質英文（1-2個詞）",
      "desc": "完整中文視覺描述"
    }
  ],
  "scenes": [
    { "name": "場景名稱", "desc": "場景環境詳細視覺描述", "promptEn": "English environment prompt" }
  ],
  "props": [
    { "name": "道具名稱", "desc": "道具詳細視覺描述", "promptEn": "English prop prompt" }
  ]
}

【角色規則】
- 提取所有有名字或有描述的角色
- 每個欄位都要填，如果腳本沒提到就根據劇情合理推測
- gender/age/height/bodyType/skinTone/eyeColor/hairStyle/ethnicity/outfit 都用英文
- character 和 voice 用 1-3 個英文詞描述性格和聲線
- desc 用繁體中文完整描述外觀

【場景/道具規則】
- 場景：同一地點不同時間算不同場景
- 道具：只提取劇情重要的道具
- promptEn 是完整英文提示詞
- 只輸出 JSON`;

// ─── Helpers ───
export const copyText = (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fbCopy(text));
    } else fbCopy(text);
  } catch { fbCopy(text); }
};
const fbCopy = (text) => {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;opacity:0;";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
};

export const downloadImg = (dataUrl, filename) => {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

// ─── Storage helpers ───
export const S = {
  async get(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
    catch { return null; }
  },
  async set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { console.error("Storage save failed:", k, e); return false; }
  },
  async del(k) {
    try { localStorage.removeItem(k); return true; }
    catch { return false; }
  },
  async list(prefix) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return keys;
    } catch { return []; }
  },
};

export const STATUS_LABELS = { empty: "未開始", wip: "進行中", done: "已完成" };
export const STATUS_COLORS = { empty: T.muted, wip: T.amb, done: T.grn };

export const newProject = (name) => ({
  id: "p_" + Date.now(),
  name,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  script: "",
  shotlist: [],
  refImages: [],
  storyboardSettings: {
    selDirs: [],
    selCine: "",
    model: "gemini-3.1-flash-image-preview",
    imgRes: "2k",
  },
  gallery: [],
  assets: { characters: [], scenes: [], props: [] },
  prompts: [],
  status: { script: "empty", assets: "empty", storyboard: "empty", video: "empty" },
});
