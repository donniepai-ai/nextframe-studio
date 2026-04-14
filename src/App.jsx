import { useState, useEffect, useRef, useCallback } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FileText, Palette, Film, Zap, Plus, Trash2, Download, Upload, RefreshCw, ChevronLeft, ChevronRight, X, ImagePlus, Sparkles, Play, Camera, Clapperboard, Image as ImageIcon, MoreHorizontal, Copy, ArrowRight, Sun, Moon, LayoutGrid, Move3d, User, LogOut } from "lucide-react";
import {
  T, PHASES, DIRECTORS, CINE_STYLES, RENDER_STYLES, LENSES, LIGHTINGS,
  STORYBOARD_STYLE_PRESETS, buildShotListPrompt, STORYBOARD_TO_PROMPT_PROMPT,
  SCRIPT_TO_ASSETS_PROMPT, setThemeMode, getThemeMode,
  S, STATUS_LABELS, STATUS_COLORS, newProject, copyText, downloadImg,
} from "./constants.js";

/* ═══════════════════════════════════════════
   NEXTFRAME STUDIO — Unified Film Pipeline
   ═══════════════════════════════════════════ */

const R2_WORKER_URL = import.meta.env.VITE_R2_WORKER_URL || "";
const API_KEY = import.meta.env?.VITE_ANTHROPIC_API_KEY || "";
const API_HEADERS = {
  "Content-Type": "application/json",
  ...(API_KEY ? {
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  } : {}),
};

// Retry wrapper for Anthropic API (handles 529 Overloaded)
const fetchWithRetry = async (url, options, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.status === 529 || res.status === 503) {
      const wait = (i + 1) * 3000;
      console.log(`[API] Overloaded (${res.status}), retrying in ${wait/1000}s... (${i+1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  throw new Error("API 持續過載，請稍後再試");
};

// ─── Reusable Components ───
const Btn = ({ children, onClick, color = T.red, disabled, small, outline, ghost, icon, style }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: small ? "6px 14px" : "10px 22px",
    background: ghost ? "transparent" : outline ? "transparent" : disabled ? T.bg3 : color,
    color: ghost ? color : outline ? color : disabled ? T.dim : "#fff",
    border: outline ? `1.5px solid ${color}33` : ghost ? "none" : "1px solid transparent",
    borderRadius: 8, fontSize: small ? 12 : 14, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
    transition: "all 0.2s ease", fontFamily: "inherit", letterSpacing: 0.2,
    display: "inline-flex", alignItems: "center", gap: 6,
    boxShadow: ghost || outline || disabled ? "none" : "0 1px 3px rgba(0,0,0,0.1)",
    ...style,
  }}>{icon}{children}</button>
);

const TArea = ({ value, onChange, placeholder, rows = 8, readOnly, style }) => (
  <textarea value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder}
    readOnly={readOnly} rows={rows}
    style={{
      width: "100%", boxSizing: "border-box", background: T.bg1, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: 14, color: T.text, fontSize: 13, lineHeight: 1.75,
      resize: "vertical", fontFamily: "'Noto Sans TC', monospace", outline: "none", ...style,
    }}
  />
);

const Badge = ({ children, color = T.dim }) => (
  <span style={{
    display: "inline-block", fontSize: 10, fontWeight: 600, padding: "2px 8px",
    borderRadius: 4, background: color + "18", color, letterSpacing: 0.5,
  }}>{children}</span>
);

// ─── File base64 helper ───
const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result.split(",")[1]);
  r.onerror = rej;
  r.readAsDataURL(file);
});

// ─── R2 Upload ───
const uploadToR2 = async (dataUrl, filename) => {
  if (!R2_WORKER_URL) return null;
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const resp = await fetch(`${R2_WORKER_URL}/upload/${filename}`, {
    method: "PUT", body: blob, headers: { "Content-Type": blob.type },
  });
  if (!resp.ok) throw new Error("上傳失敗: " + resp.statusText);
  const data = await resp.json();
  // Ensure full URL — worker may return relative path like "/file/..."
  let url = data.url || `/file/${filename}`;
  if (url.startsWith("/")) url = `${R2_WORKER_URL}${url}`;
  return url;
};

// Compress image if too large (max 1536px, target < 2MB)
const compressImage = (dataUrl, maxSize = 1536, quality = 0.85) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width <= maxSize && height <= maxSize && dataUrl.length < 2 * 1024 * 1024) {
      resolve(dataUrl); return;
    }
    if (width > height) { if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; } }
    else { if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; } }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    resolve(canvas.toDataURL("image/jpeg", quality));
  };
  img.onerror = () => resolve(dataUrl);
  img.src = dataUrl;
});

// Save image to R2, return URL. Falls back to dataUrl if R2 not configured.
const saveImageToR2 = async (dataUrl, path) => {
  if (!R2_WORKER_URL || !dataUrl?.startsWith("data:")) return dataUrl;
  try {
    const url = await uploadToR2(dataUrl, path);
    return url || dataUrl;
  } catch (e) {
    console.warn("[R2] Upload failed:", e.message);
    return dataUrl;
  }
};

// ─── CDN Script loader ───
const _scriptCache = {};
const loadCDNScript = (name, url, getLib) => new Promise((resolve, reject) => {
  if (_scriptCache[name]) { resolve(_scriptCache[name]); return; }
  const el = document.createElement("script");
  el.src = url;
  el.onload = () => {
    try { const lib = getLib(); _scriptCache[name] = lib; resolve(lib); }
    catch (e) { reject(e); }
  };
  el.onerror = () => reject(new Error(`${name} 載入失敗`));
  document.head.appendChild(el);
});

// ─── Asset Card Component (for art design phase) ───
function AssetCard({ asset, type, aspect, color, isGenning, onUpdate, onRemove, onGenImg, onLightbox }) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const isChar = type === "characters";

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true); setUploadStatus("壓縮中...");
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((res) => { reader.onload = () => res(reader.result); reader.readAsDataURL(file); });
      setUploadStatus("壓縮中...");
      const compressed = await compressImage(dataUrl);
      setUploadStatus("上傳至 R2...");
      const url = await saveImageToR2(compressed, `upload/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      onUpdate("image", url);
      setUploadStatus("");
    } catch (e) { setUploadStatus("上傳失敗"); }
    setUploading(false);
  };

  const miniInput = (field, ph, w) => (
    <input value={asset[field] || ""} onChange={e => onUpdate(field, e.target.value)} placeholder={ph}
      style={{ width: w || "100%", boxSizing: "border-box", background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 3, padding: "3px 6px", color: T.text, fontSize: 10, outline: "none", fontFamily: "inherit" }} />
  );

  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      {/* Image */}
      <div style={{ aspectRatio: isChar ? "16/9" : aspect, background: asset.image ? "none" : T.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}
        onClick={() => asset.image ? onLightbox({ img: asset.image, label: asset.name }) : null}>
        {(isGenning || uploading) && (
          <div style={{ position: "absolute", inset: 0, zIndex: 3, background: T.bg + "dd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, border: `3px solid ${T.border}`, borderTopColor: color, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 11, color: T.dim }}>{uploading ? uploadStatus : "角色卡生成中..."}</div>
          </div>
        )}
        {asset.image ? (
          <>
            <img src={asset.image} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 8px 6px", background: "linear-gradient(transparent, rgba(0,0,0,0.5))", display: "flex", gap: 4, justifyContent: "center" }}>
              <div onClick={e => { e.stopPropagation(); onGenImg(); }} style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 9, borderRadius: 16, padding: "3px 8px", cursor: "pointer", backdropFilter: "blur(4px)" }}>🔄 重新生成</div>
              <label onClick={e => e.stopPropagation()} style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 9, borderRadius: 16, padding: "3px 8px", cursor: "pointer", backdropFilter: "blur(4px)" }}>
                📁 上傳替換
                <input type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => { handleUpload(e.target.files[0]); e.target.value = ""; }} />
              </label>
              <div onClick={e => { e.stopPropagation(); downloadImg(asset.image, `${asset.name}.png`); }} style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 9, borderRadius: 16, padding: "3px 8px", cursor: "pointer", backdropFilter: "blur(4px)" }}>⬇ 下載</div>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 22, opacity: 0.3 }}>{isChar ? "🧑" : type === "scenes" ? "🏞" : "🔧"}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn small color={color} onClick={e => { e.stopPropagation(); onGenImg(); }} disabled={isGenning}>
                🍌 {isChar ? "生成角色卡" : "生成概念圖"}
              </Btn>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: T.bg3, border: `1px solid ${T.border}`, color: T.text }}>
                📁 上傳圖片
                <input type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => { handleUpload(e.target.files[0]); e.target.value = ""; }} />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: "8px 10px" }}>
        {isChar ? (
          <>
            {/* Character Card structured fields */}
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input value={asset.name} onChange={e => onUpdate("name", e.target.value)} placeholder="英文名 Name"
                style={{ flex: 1, background: "transparent", border: "none", borderBottom: `1px solid ${T.border}`, color: T.hi, fontSize: 14, fontWeight: 700, padding: "4px 0", outline: "none", fontFamily: "'Share Tech Mono', sans-serif" }} />
              {miniInput("nameZh", "中文名", 80)}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginBottom: 6 }}>
              {miniInput("gender", "Gender")}
              {miniInput("age", "Age")}
              {miniInput("height", "Height cm")}
              {miniInput("bodyType", "Body")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginBottom: 6 }}>
              {miniInput("skinTone", "Skin")}
              {miniInput("eyeColor", "Eyes")}
              {miniInput("ethnicity", "Ethnicity")}
              {miniInput("hairStyle", "Hair")}
            </div>
            <div style={{ marginBottom: 6 }}>
              {miniInput("outfit", "Outfit 服裝描述")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
              {miniInput("character", "性格 Trait")}
              {miniInput("voice", "聲線 Voice")}
            </div>

            <textarea value={asset.desc} onChange={e => onUpdate("desc", e.target.value)} placeholder="完整中文視覺描述..." rows={2}
              style={{ width: "100%", boxSizing: "border-box", background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 4, padding: 6, color: T.text, fontSize: 10, lineHeight: 1.5, resize: "none", outline: "none", fontFamily: "inherit" }} />
          </>
        ) : (
          <>
            <input value={asset.name} onChange={e => onUpdate("name", e.target.value)} placeholder="名稱..."
              style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", borderBottom: `1px solid ${T.border}`, color: T.hi, fontSize: 13, fontWeight: 600, padding: "4px 0", outline: "none", fontFamily: "inherit" }} />
            <textarea value={asset.desc} onChange={e => onUpdate("desc", e.target.value)} placeholder="視覺描述..." rows={2}
              style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", color: T.text, fontSize: 11, lineHeight: 1.6, resize: "none", outline: "none", marginTop: 4, fontFamily: "inherit" }} />
            <div onClick={() => setExpanded(!expanded)} style={{ fontSize: 10, color: T.dim, cursor: "pointer", marginTop: 2 }}>
              {expanded ? "▲ 收起提示詞" : "▼ 展開提示詞"}
            </div>
            {expanded && (
              <textarea value={asset.promptEn || ""} onChange={e => onUpdate("promptEn", e.target.value)} placeholder="English prompt..."
                rows={3} style={{ width: "100%", boxSizing: "border-box", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, padding: 6, color: T.text, fontSize: 10, lineHeight: 1.5, resize: "vertical", outline: "none", marginTop: 4, fontFamily: "'Share Tech Mono', monospace" }} />
            )}
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6, gap: 4 }}>
          <Btn small ghost color={T.dim} onClick={onRemove} style={{ fontSize: 10, padding: "2px 6px" }}>刪除</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Shot Card Component (for storyboard phase) ───
function ShotCard({ panel, idx, isGenning, genStatusText, shotLens, shotLight, onSetLens, onSetLight, onGenImg, onSpecial, onLightbox }) {
  const [expandedPanel, setExpandedPanel] = useState(null); // "style" | "retake" | null
  const [hover, setHover] = useState(false);
  const id = `S${String(idx + 1).padStart(2, "0")}`;

  const toolBtn = (icon, label, onClick, color = T.dim) => (
    <div onClick={e => { e.stopPropagation(); onClick(); }} title={label || ""} style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: label ? 5 : 0,
      padding: label ? "5px 12px" : "7px", borderRadius: label ? 8 : 10,
      cursor: "pointer", fontSize: 11, color: color, transition: "all 0.2s",
      background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)",
      border: "1px solid rgba(255,255,255,0.18)",
      width: label ? "auto" : 34, height: label ? "auto" : 34,
      WebkitBackdropFilter: "blur(12px)",
    }}>{icon}{label && <span style={{ color: "#fff" }}>{label}</span>}</div>
  );

  return (
    <>
      {/* Image area */}
      <div
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ aspectRatio: "16/9", background: T.bg3, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 6 }}>
        {isGenning && (
          <div style={{ position: "absolute", inset: 0, zIndex: 3, background: T.bg + "dd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, border: `3px solid ${T.border}`, borderTopColor: T.pur, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 11, color: T.dim }}>{genStatusText || "生成中..."}</div>
          </div>
        )}
        {panel.image ? (
          <>
            <img src={panel.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "pointer" }} onClick={() => onLightbox({ img: panel.image, label: `${id} ${panel.segmentName}` })} />
            {/* Top-right: download */}
            <div style={{ position: "absolute", top: 6, right: 6, opacity: hover ? 1 : 0, transition: "opacity 0.2s" }}>
              <div onClick={e => { e.stopPropagation(); downloadImg(panel.image, `${id}.png`); }} style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", backdropFilter: "blur(4px)" }}><Download size={14} /></div>
            </div>
            {/* Hover overlay toolbar */}
            {hover && (
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 8px 8px", background: "linear-gradient(transparent, rgba(0,0,0,0.7))", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, animation: "fadeIn 0.15s ease" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  {toolBtn(<RefreshCw size={14} />, null, () => onGenImg(panel.id), T.pur)}
                  {toolBtn(<Camera size={14} />, null, () => onGenImg(panel.id, "angle"), T.blu)}
                  {toolBtn(<Palette size={14} />, null, () => setExpandedPanel(expandedPanel === "style" ? null : "style"), T.amb)}
                  {toolBtn(<Sun size={14} />, null, () => setExpandedPanel(expandedPanel === "relight" ? null : "relight"), "#e8a830")}
                  {toolBtn(<Play size={14} />, null, () => setExpandedPanel(expandedPanel === "retake" ? null : "retake"), T.cyn)}
                  {toolBtn(<LayoutGrid size={14} />, null, () => onSpecial("grid9", panel.id), T.red)}
                  {toolBtn(<Move3d size={14} />, null, () => onSpecial("multiangle", panel.id), T.pur)}
                  {toolBtn(<ArrowRight size={14} />, null, () => onSpecial("shotreverse", panel.id), T.grn)}
                </div>
              </div>
            )}
          </>
        ) : !isGenning ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <Btn small color={T.pur} icon={<ImagePlus size={14} />} onClick={() => onGenImg(panel.id)}>生成圖片</Btn>
            <label style={{ fontSize: 10, color: T.dim, cursor: "pointer" }}>
              或上傳
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {}} />
            </label>
          </div>
        ) : null}
      </div>

      {/* Modal overlay for sub-options */}
      {expandedPanel && panel.image && (
        <div onClick={() => setExpandedPanel(null)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", animation: "fadeIn 0.15s ease" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 16, padding: "24px 28px", width: "90%", maxWidth: expandedPanel === "retake" ? 480 : 440, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>

            {/* Retake */}
            {expandedPanel === "retake" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: T.hi }}>重新構圖</span>
                  <span onClick={() => setExpandedPanel(null)} style={{ fontSize: 14, color: T.dim, cursor: "pointer", padding: 4 }}>✕</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    { id: "extreme_closeup", name: "大特寫" },
                    { id: "closeup", name: "特寫" },
                    { id: "medium", name: "中景" },
                    { id: "wide", name: "遠景" },
                    { id: "extreme_wide", name: "大遠景" },
                    { id: "pov", name: "主觀視角 POV" },
                    { id: "ots", name: "過肩鏡頭" },
                    { id: "dutch", name: "荷蘭角" },
                  ].map(s => (
                    <div key={s.id} onClick={() => { onGenImg(panel.id, `retake:${s.id}`); setExpandedPanel(null); }}
                      style={{ padding: "14px 16px", borderRadius: 10, cursor: "pointer", background: T.bg2, border: `1.5px solid ${T.border}`, color: T.text, transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = T.cynG; e.currentTarget.style.borderColor = T.cyn; }}
                      onMouseLeave={e => { e.currentTarget.style.background = T.bg2; e.currentTarget.style.borderColor = T.border; }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{s.name}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Style */}
            {expandedPanel === "style" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: T.hi }}>選擇渲染風格</span>
                  <span onClick={() => setExpandedPanel(null)} style={{ fontSize: 14, color: T.dim, cursor: "pointer", padding: 4 }}>✕</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {RENDER_STYLES.map(s => (
                    <div key={s.id} onClick={() => { onGenImg(panel.id, `style:${s.id}`); setExpandedPanel(null); }}
                      style={{ padding: "10px 8px", borderRadius: 10, cursor: "pointer", fontSize: 13, background: T.bg2, border: `1.5px solid ${T.border}`, color: T.text, textAlign: "center", fontWeight: 500, transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = T.ambG; e.currentTarget.style.borderColor = T.amb; e.currentTarget.style.fontWeight = 700; }}
                      onMouseLeave={e => { e.currentTarget.style.background = T.bg2; e.currentTarget.style.borderColor = T.border; e.currentTarget.style.fontWeight = 500; }}
                    >{s.name}</div>
                  ))}
                </div>
              </>
            )}

            {/* Relight */}
            {expandedPanel === "relight" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: T.hi }}>重新打光</span>
                  <span onClick={() => setExpandedPanel(null)} style={{ fontSize: 14, color: T.dim, cursor: "pointer", padding: 4 }}>✕</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {LIGHTINGS.map(l => (
                    <div key={l.id} onClick={() => { onGenImg(panel.id, `relight:${l.id}`); setExpandedPanel(null); }}
                      style={{ padding: "10px 8px", borderRadius: 10, cursor: "pointer", background: T.bg2, border: `1.5px solid ${T.border}`, color: T.text, textAlign: "center", fontSize: 13, fontWeight: 500, transition: "all 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = T.ambG; e.currentTarget.style.borderColor = "#e8a830"; e.currentTarget.style.fontWeight = 700; }}
                      onMouseLeave={e => { e.currentTarget.style.background = T.bg2; e.currentTarget.style.borderColor = T.border; e.currentTarget.style.fontWeight = 500; }}
                    >{l.name}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════
//              LOGIN PAGE
// ════════════════════════════════════════
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD || "nextframe2025";

function LoginPage({ onLogin }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("導演");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (password.trim() !== APP_PASSWORD.trim()) { setError("密碼錯誤"); setPassword(""); return; }
    setError("");
    const user = { name: name.trim(), role, loginAt: Date.now() };
    localStorage.setItem("nf_user", JSON.stringify(user));
    onLogin(user);
  };

  const roles = ["導演", "編劇", "攝影", "美術", "製片", "剪輯", "其他"];

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, ${T.bg} 0%, ${T.bg3} 100%)`, fontFamily: "'Noto Sans TC', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;600;700;800&family=Share+Tech+Mono&family=Instrument+Sans:wght@400;600;700&display=swap" rel="stylesheet"/>
      <div style={{ background: T.bg1, borderRadius: 20, padding: "48px 40px", boxShadow: "0 8px 40px rgba(0,0,0,0.08)", textAlign: "center", width: "100%", maxWidth: 420, border: `1px solid ${T.border}` }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: `linear-gradient(135deg, ${T.pur}, ${T.red})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", margin: "0 auto 16px", boxShadow: "0 4px 16px rgba(124,92,191,0.3)" }}>
          <Clapperboard size={28} />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: T.hi, marginBottom: 4, fontFamily: "'Instrument Sans', sans-serif" }}>NextFrame Studio</h1>
        <p style={{ color: T.dim, marginBottom: 28, fontSize: 14 }}>AI 電影前期製作工具</p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="你的名字" autoFocus
            style={{ padding: "14px 18px", border: `1.5px solid ${T.border}`, borderRadius: 12, fontSize: 15, outline: "none", background: T.bg2, color: T.hi, fontFamily: "inherit", textAlign: "center", transition: "border-color 0.2s" }}
            onFocus={e => e.target.style.borderColor = T.pur}
            onBlur={e => e.target.style.borderColor = T.border} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密碼"
            style={{ padding: "14px 18px", border: `1.5px solid ${error ? T.red : T.border}`, borderRadius: 12, fontSize: 15, outline: "none", background: T.bg2, color: T.hi, fontFamily: "inherit", textAlign: "center", letterSpacing: 2, transition: "border-color 0.2s" }}
            onFocus={e => e.target.style.borderColor = T.pur}
            onBlur={e => e.target.style.borderColor = error ? T.red : T.border} />
          {error && <div style={{ color: T.red, fontSize: 13, fontWeight: 500 }}>{error}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {roles.map(r => (
              <div key={r} onClick={() => setRole(r)} style={{
                padding: "6px 14px", borderRadius: 20, cursor: "pointer", fontSize: 13,
                background: role === r ? T.pur + "18" : T.bg2,
                border: `1.5px solid ${role === r ? T.pur : T.border}`,
                color: role === r ? T.pur : T.dim, fontWeight: role === r ? 600 : 400,
                transition: "all 0.15s",
              }}>{r}</div>
            ))}
          </div>
          <button type="submit" disabled={!name.trim() || !password} style={{
            padding: "14px", background: (name.trim() && password) ? `linear-gradient(135deg, ${T.pur}, ${T.red})` : T.bg3,
            color: (name.trim() && password) ? "#fff" : T.dim, border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700,
            cursor: (name.trim() && password) ? "pointer" : "not-allowed", boxShadow: (name.trim() && password) ? "0 4px 16px rgba(124,92,191,0.3)" : "none", fontFamily: "inherit",
            transition: "all 0.2s",
          }}>
            進入工作室
          </button>
        </form>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
//              MAIN APP
// ════════════════════════════════════════
function MainApp({ user, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const projectsRef = useRef([]);
  const activeIdRef = useRef(null);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const [activePhase, setActivePhase] = useState("script");
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("nf_darkmode");
    if (saved === "true") { setThemeMode("dark"); return true; }
    return false;
  });
  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    setThemeMode(next ? "dark" : "light");
    localStorage.setItem("nf_darkmode", String(next));
  };

  const proj = projects.find(p => p.id === activeId);

  // ─── Toast ───
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  // ─── Segment grouping for shot list ───
  const getSegmentGroups = () => {
    const panels = proj?.shotlist || [];
    const segMap = {};
    panels.forEach(p => {
      const s = p.segment || 1;
      if (!segMap[s]) segMap[s] = { name: p.segmentName || "", panels: [] };
      if (p.segmentName && !segMap[s].name) segMap[s].name = p.segmentName;
      segMap[s].panels.push(p);
    });
    const segKeys = Object.keys(segMap).map(Number).sort((a, b) => a - b);
    return { panels, segMap, segKeys };
  };

  // ─── Load projects ───
  useEffect(() => {
    (async () => {
      const keys = await S.list("proj:");
      const loaded = [];
      for (const k of keys) {
        const p = await S.get(k);
        if (!p) continue;
        // Migrate old format: storyboard → shotlist
        if (!p.shotlist && p.storyboard && Array.isArray(p.storyboard)) {
          p.shotlist = p.storyboard;
        }
        if (!p.shotlist) p.shotlist = [];
        if (!p.assets) p.assets = { characters: [], scenes: [], props: [] };
        if (!p.gallery) p.gallery = [];
        if (!p.prompts) p.prompts = [];
        if (!p.status) p.status = {};
        loaded.push(p);
      }
      loaded.sort((a, b) => b.updatedAt - a.updatedAt);
      setProjects(loaded);
      setLoading(false);
    })();
  }, []);

  // ─── Save project ───
  const saveProject = useCallback(async (p) => {
    const updated = { ...p, updatedAt: Date.now() };
    setSaving(true);
    const ok = await S.set("proj:" + p.id, updated);
    setSaving(false);
    if (!ok) showToast("⚠ 儲存失敗：儲存空間不足");
  }, []);

  const scheduleSave = useCallback(() => {
    clearTimeout(window._saveTimer);
    window._saveTargetId = activeIdRef.current;
    window._saveTimer = setTimeout(() => {
      window._saveTimer = null;
      const id = window._saveTargetId;
      const p = projectsRef.current.find(x => x.id === id);
      if (p) saveProject(p);
    }, 800);
  }, [saveProject]);

  const flushSave = useCallback(() => {
    if (window._saveTimer) {
      clearTimeout(window._saveTimer);
      window._saveTimer = null;
      const id = window._saveTargetId || activeIdRef.current;
      const p = projectsRef.current.find(x => x.id === id);
      if (p) saveProject(p);
    }
  }, [saveProject]);

  // ─── Update project helpers ───
  const updateProj = useCallback((field, value) => {
    setProjects(prev => {
      const id = activeIdRef.current;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      return prev.map(x => x.id === id ? { ...x, [field]: value, updatedAt: Date.now() } : x);
    });
    scheduleSave();
  }, [scheduleSave]);

  const updateMultiFields = useCallback((fields) => {
    setProjects(prev => {
      const id = activeIdRef.current;
      if (!id) return prev;
      return prev.map(x => x.id === id ? { ...x, ...fields, updatedAt: Date.now() } : x);
    });
    scheduleSave();
  }, [scheduleSave]);

  const updateStatus = useCallback((phase, status) => {
    setProjects(prev => {
      const id = activeIdRef.current;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      return prev.map(x => x.id === id ? { ...x, status: { ...x.status, [phase]: status }, updatedAt: Date.now() } : x);
    });
    scheduleSave();
  }, [scheduleSave]);

  // ─── Create / Delete project ───
  const createProject = async () => {
    if (!newName.trim()) return;
    const p = newProject(newName.trim());
    await S.set("proj:" + p.id, p);
    setProjects(prev => [p, ...prev]);
    setActiveId(p.id); setActivePhase("script");
    setNewName(""); setShowNewDialog(false);
    showToast("專案已建立");
  };

  const deleteProject = async (id) => {
    if (!confirm("確定要刪除此專案？")) return;
    await S.del("proj:" + id);
    setProjects(prev => prev.filter(x => x.id !== id));
    if (activeId === id) setActiveId(null);
    showToast("已刪除");
  };

  const duplicateProject = async (id) => {
    const src = projects.find(p => p.id === id);
    if (!src) return;
    const copy = {
      ...JSON.parse(JSON.stringify(src)),
      id: "p_" + Date.now(),
      name: src.name + " (副本)",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await S.set("proj:" + copy.id, copy);
    setProjects(prev => [copy, ...prev]);
    setActiveId(copy.id);
    showToast("✓ 已複製專案");
  };

  // ─── Script file import ───
  const [importing, setImporting] = useState(false);
  const scriptFileRef = useRef(null);

  const handleScriptFileImport = async (file) => {
    if (!file || !proj) return;
    setImporting(true);
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      let text = "";
      if (ext === "txt" || ext === "md" || ext === "csv") {
        text = await file.text();
      } else if (ext === "docx") {
        const arrayBuf = await file.arrayBuffer();
        const mam = await loadCDNScript("mammoth",
          "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
          () => window.mammoth);
        const result = await mam.extractRawText({ arrayBuffer: arrayBuf });
        text = result.value;
      } else if (ext === "xlsx" || ext === "xls") {
        const XLSX = await loadCDNScript("XLSX",
          "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
          () => window.XLSX);
        const arrayBuf = await file.arrayBuffer();
        const wb = XLSX.read(arrayBuf, { type: "array" });
        const lines = [];
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (wb.SheetNames.length > 1) lines.push(`【${sheetName}】`);
          lines.push(XLSX.utils.sheet_to_csv(ws)); lines.push("");
        }
        text = lines.join("\n").trim();
      } else if (ext === "pdf") {
        const arrayBuf = await file.arrayBuffer();
        const pdfjsLib = await loadCDNScript("pdfjsLib",
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
          () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; return window.pdfjsLib; });
        const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map(item => item.str).join(" "));
        }
        text = pages.join("\n\n");
      } else {
        showToast("不支援此格式，請使用 DOCX/XLSX/PDF/TXT");
        setImporting(false); return;
      }
      if (text.trim()) {
        const prev = proj.script || "";
        const merged = prev ? prev + "\n\n───── 匯入：" + file.name + " ─────\n\n" + text : text;
        updateProj("script", merged);
        showToast(`✓ 已匯入 ${file.name}`);
      } else showToast("檔案內容為空");
    } catch (e) { showToast("匯入失敗：" + (e.message || "未知錯誤")); }
    setImporting(false);
  };

  // ─── AI: Idea → Script (Claude) ───
  const [scriptIdea, setScriptIdea] = useState("");
  const [genScriptLoading, setGenScriptLoading] = useState(false);

  const generateScript = async () => {
    if (!scriptIdea.trim()) { showToast("請輸入故事概念"); return; }
    setGenScriptLoading(true);
    try {
      const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: API_HEADERS,
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 8000,
          system: `你是專業的電影編劇，擅長根據一句話概念生成完整的電影劇本大綱。

【任務】根據使用者提供的概念或一句話，生成一個完整的電影/短片腳本。

【輸出格式】
1. 先寫【角色設定】— 列出所有角色的名字、外觀描述、性格特徵
2. 再寫【整體視覺基調】— 場景風格、色調、攝影風格
3. 最後按 SEGMENT 寫出分段劇情，每段約 15 秒：
   【SEGMENT N】時間範圍｜段落名稱
   風格：拍攝風格描述
   Shot 1 (Xs): 景別，角度，畫面描述，音效描述
   Shot 2 ...

【規則】
- 角色描述要詳細到可以直接作為 AI 生圖的參考
- 每個 Shot 要有明確的景別、角度、時長
- 繁體中文輸出
- 直接輸出劇本內容，不要解釋`,
          messages: [{ role: "user", content: scriptIdea }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const raw = (data.content || []).map(c => c.text || "").join("");
      const prev = proj.script || "";
      const merged = prev ? prev + "\n\n───── AI 生成 ─────\n\n" + raw : raw;
      updateProj("script", merged);
      setScriptIdea("");
      showToast("✓ 劇本已生成");
    } catch (e) { showToast("生成失敗：" + (e.message || "未知錯誤")); }
    setGenScriptLoading(false);
  };

  // ─── AI: Script → Shot List (Claude) ───
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [filmStyle, setFilmStyle] = useState("liveaction");

  const generateShotList = async () => {
    const latestProj = projects.find(p => p.id === activeId);
    if (!latestProj?.script?.trim()) { showToast("請先輸入腳本"); return; }
    setAnalyzing(true); setAnalyzeProgress(10);
    try {
      setAnalyzeProgress(20);
      // Auto-continue: loop up to 3 times if response is truncated
      let messages = [{ role: "user", content: latestProj.script }];
      let fullText = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        setAnalyzeProgress(20 + attempt * 20);
        const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: API_HEADERS,
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 16000,
            system: buildShotListPrompt(filmStyle)
              + (selDirs.length > 0 ? `\n\n【導演風格參考 — 用大師的思維方式做分鏡決策】\n${selDirs.map(id => { const d = DIRECTORS.find(x => x.id === id); return d ? `• ${d.name}：${d.desc}` : ""; }).filter(Boolean).join("\n")}\n\n重要：不是裝飾性提及，而是用他們的思維方式決定景別、角度、運鏡。每個分鏡的 nbEn 也必須反映該導演的視覺風格。` : "")
              + (selCine ? (() => { const c = CINE_STYLES.find(x => x.id === selCine); return c ? `\n\n【攝影風格 — ${c.name}】\n所有分鏡必須嚴格遵循「${c.name}」攝影風格：${c.desc}。景別選擇、打光方式、色彩分級、剪輯節奏都要符合此風格。` : ""; })() : ""),
            messages,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        const chunk = (data.content || []).map(c => c.text || "").join("");
        fullText += chunk;
        if (data.stop_reason === "max_tokens") {
          // Truncated — ask to continue
          messages = [...messages,
            { role: "assistant", content: fullText },
            { role: "user", content: "你的回答被截斷了，請從斷點處繼續完成剩餘的 JSON。不要重複已寫的內容，直接從斷點繼續。" }
          ];
          setAnalyzeProgress(40 + attempt * 15);
        } else break;
      }
      setAnalyzeProgress(75);
      // Strip markdown code fences if present
      const cleaned = fullText.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "");
      let jsonStr = "";
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      } else {
        // Try to fix truncated JSON: find [ and append ]
        const startIdx = cleaned.indexOf("[");
        if (startIdx >= 0) {
          let truncated = cleaned.slice(startIdx).trimEnd();
          // Remove trailing incomplete object
          const lastComplete = truncated.lastIndexOf("}");
          if (lastComplete > 0) {
            truncated = truncated.slice(0, lastComplete + 1);
            if (!truncated.endsWith("]")) truncated += "]";
            jsonStr = truncated;
          }
        }
        if (!jsonStr) {
          console.error("AI raw response (first 500):", fullText.slice(0, 500));
          throw new Error("AI 回傳格式異常，無法解析 JSON");
        }
      }
      let panels;
      try { panels = JSON.parse(jsonStr); }
      catch (parseErr) {
        console.error("JSON parse error:", parseErr.message, "Trying to fix...");
        // Last resort: try to fix common JSON issues
        try {
          const fixed = jsonStr.replace(/,\s*[}\]]/g, m => m.replace(",", ""));
          panels = JSON.parse(fixed);
        } catch {
          throw new Error("JSON 解析失敗：" + parseErr.message);
        }
      }
      if (!Array.isArray(panels) || panels.length === 0) throw new Error("未產生任何分鏡");
      setAnalyzeProgress(90);
      const newPanels = panels.map((p, i) => ({
        id: "sb_" + Date.now() + "_" + i, image: null,
        segment: p.segment || 1, segmentName: p.segmentName || "",
        desc: p.desc || "", shotSize: p.shotSize || "", angle: p.angle || "",
        movement: p.movement || "", duration: p.duration || "", audio: p.audio || "",
        nbEn: p.nbEn || "",
      }));
      const existing = latestProj.shotlist || [];
      updateMultiFields({
        shotlist: [...existing, ...newPanels],
        status: { ...(latestProj.status || {}), script: "done", storyboard: "wip" },
      });
      setAnalyzeProgress(100);
      showToast(`✓ 已生成 ${newPanels.length} 格分鏡`);
      setTimeout(() => setActivePhase("shotlist"), 600);
    } catch (e) { showToast("分鏡生成失敗：" + (e.message || "未知錯誤")); }
    setAnalyzing(false); setAnalyzeProgress(0);
  };

  // ─── AI: Script → Assets (Claude) ───
  const [genAssetsLoading, setGenAssetsLoading] = useState(false);
  const [genAssetsProgress, setGenAssetsProgress] = useState(0);

  const generateAssets = async () => {
    const latestProj = projects.find(p => p.id === activeId);
    if (!latestProj?.script?.trim()) { showToast("請先輸入腳本"); return; }
    setGenAssetsLoading(true); setGenAssetsProgress(10);
    try {
      setGenAssetsProgress(30);
      const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: API_HEADERS,
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 8000,
          system: SCRIPT_TO_ASSETS_PROMPT,
          messages: [{ role: "user", content: latestProj.script }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setGenAssetsProgress(70);
      const raw = (data.content || []).map(c => c.text || "").join("");
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI 回傳格式異常");
      const parsed = JSON.parse(jsonMatch[0]);
      setGenAssetsProgress(90);
      const toAssets = (arr) => (arr || []).map((item, i) => ({
        id: "a_" + Date.now() + "_" + i + "_" + Math.random().toString(36).slice(2, 5),
        name: item.name || "", desc: item.desc || "", promptEn: item.promptEn || "", image: null,
        // Character card fields
        nameZh: item.nameZh || "", gender: item.gender || "", age: item.age || "",
        height: item.height || "", bodyType: item.bodyType || "", skinTone: item.skinTone || "",
        eyeColor: item.eyeColor || "", hairStyle: item.hairStyle || "", ethnicity: item.ethnicity || "",
        outfit: item.outfit || "", character: item.character || "", voice: item.voice || "",
      }));
      const merged = {
        characters: toAssets(parsed.characters),
        scenes: toAssets(parsed.scenes),
        props: toAssets(parsed.props),
      };
      const totalNew = (parsed.characters?.length || 0) + (parsed.scenes?.length || 0) + (parsed.props?.length || 0);
      updateMultiFields({
        assets: merged,
        status: { ...(latestProj.status || {}), assets: "wip" },
      });
      showToast(`✓ 已提取 ${totalNew} 個素材`);
    } catch (e) { showToast("素材提取失敗：" + (e.message || "未知錯誤")); }
    setGenAssetsLoading(false); setGenAssetsProgress(0);
  };

  // ─── Assets management ───
  const addAsset = (type) => {
    const assets = { ...(proj.assets || { characters: [], scenes: [], props: [] }) };
    assets[type] = [...(assets[type] || []), { id: "a_" + Date.now(), name: "", desc: "", promptEn: "", image: null }];
    updateProj("assets", assets);
  };

  const updateAsset = (type, assetId, field, value) => {
    setProjects(prev => {
      const id = activeIdRef.current;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const assets = { ...(p.assets || { characters: [], scenes: [], props: [] }) };
      assets[type] = (assets[type] || []).map(a => a.id === assetId ? { ...a, [field]: value } : a);
      return prev.map(x => x.id === id ? { ...x, assets, updatedAt: Date.now() } : x);
    });
    scheduleSave();
  };

  const removeAsset = (type, assetId) => {
    const assets = { ...(proj.assets || { characters: [], scenes: [], props: [] }) };
    assets[type] = (assets[type] || []).filter(a => a.id !== assetId);
    updateProj("assets", assets);
  };

  // ─── Asset image generation (Banana/Gemini) ───
  const [assetGenSet, setAssetGenSet] = useState(new Set());

  const generateAssetImg = async (type, assetId) => {
    const asset = (proj.assets?.[type] || []).find(a => a.id === assetId);
    if (!asset) return;
    const settings = proj?.storyboardSettings || {};
    const model = settings.model || "gemini-3.1-flash-image-preview";
    if (!model.includes("image") && !model.includes("banana")) { showToast("請選擇 Nano Banana 模型"); return; }
    if (assetGenSet.has(assetId)) return;
    setAssetGenSet(prev => new Set(prev).add(assetId));
    try {
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
      const nbModel = genAI.getGenerativeModel({ model, generationConfig: { responseModalities: ["image", "text"] } });

      // Build prompt based on asset type + film style
      let prompt = "";
      const isAnime = filmStyle === "anime";

      if (type === "characters") {
        // Character Card — structured reference sheet
        const a = asset;
        const gender = a.gender || "female";
        const age = a.age || "25";
        const height = a.height || "165";
        const body = a.bodyType || "slim";
        const skin = a.skinTone || "fair";
        const eyes = a.eyeColor || "brown";
        const hair = a.hairStyle || "black hair";
        const ethnicity = a.ethnicity || "asian";
        const outfit = a.outfit || "casual clothing";
        const charTrait = a.character || "confident";
        const voice = a.voice || "clear";
        const name = a.name || "CHARACTER";

        if (isAnime) {
          prompt = `anime character design sheet, full character reference sheet, of a ${gender}, ${age} years old, ${height}cm tall, ${skin} skin, ${body} body type. ${eyes} eyes, ${hair}, ${ethnicity}. wearing ${outfit}. ${charTrait} personality.
multiple views showing: front full body view, back full body view, face close-up front view, face close-up side profile view, face close-up 3/4 angle view, upper body detail shot, outfit detail shots.
16:9 aspect ratio, white clean background, professional studio soft lighting, anime cel-shaded illustration, clean outlines, vibrant colors, high detail, consistent character across all views, professional character design sheet layout.
text overlay showing "Name: ${name}", "Age: ${age}", "Height: ${height} cm"

---
CHARACTER TRAITS (for text overlay reference):
Character: ${charTrait}
Voice: ${voice}

---
NEGATIVE PROMPT:
3D render, photorealistic, photograph, blurry, low quality, inconsistent design`;
        } else {
          prompt = `photorealistic, real human, natural skin texture, real photograph, raw photo, DSLR quality, 8k uhd, realistic lighting, pores, skin details, full character reference sheet, of a ${gender}, ${height}cm tall, ${skin} skin, ${body} body type. ${eyes} eyes, ${ethnicity} ${gender}. wearing ${outfit}. youthful appearance, same facial features as reference image, consistent face throughout all views, identical face, face unchanged by text.
multiple views showing: front full body view, back full body view, face close-up front view, face close-up side profile view, face close-up 3/4 angle view, upper body detail shot, outfit detail shots.
16:9 aspect ratio, white clean background, professional studio soft lighting, fashion photography quality, high detail, consistent character across all views, professional character design sheet layout.
text overlay showing "Name: ${name}", "Age: ${age}", "Height: ${height} cm"

---
CHARACTER TRAITS (for text overlay reference):
Character: ${charTrait}
Voice: ${voice}

---
NEGATIVE PROMPT:
aged face, old looking, wrinkles, crow feet, forehead lines, sagging skin, age spots, mature face, middle aged face, elderly features, aging skin, face affected by age number, 3D render, CGI, game character, anime, illustration, digital art, plastic skin, doll-like, artificial, fake, cartoon, drawing, painting`;
        }
      } else if (type === "scenes") {
        prompt = isAnime
          ? `Anime background art, environment concept: ${asset.promptEn || asset.desc}. Japanese anime style, wide angle, atmospheric, detailed background painting, Studio Ghibli quality.`
          : `Cinematic establishing shot, real location photography: ${asset.promptEn || asset.desc}. Photorealistic, live-action film style, wide angle, atmospheric lighting, professional matte painting quality.`;
      } else {
        prompt = isAnime
          ? `Anime prop design: ${asset.promptEn || asset.desc}. Japanese anime style, detailed item illustration, clean background.`
          : `Product photography, real prop: ${asset.promptEn || asset.desc}. Photorealistic, studio lighting, detailed material rendering, clean background, high quality.`;
      }

      // Use reference images if available
      const imgParts = await getImgParts();
      const contentParts = imgParts.length > 0
        ? [...imgParts, { text: prompt + "\n\nUse reference images for style consistency." }]
        : [{ text: prompt }];

      const result = await nbModel.generateContent({ contents: [{ role: "user", parts: contentParts }] });
      const parts = result.response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData) {
          const raw = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          const projId = activeIdRef.current || "unknown";
          const r2Path = `${projId}/${type}/${asset.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now()}.png`;
          const imgUrl = await saveImageToR2(raw, r2Path);
          updateAsset(type, assetId, "image", imgUrl);
          const latestProj = projectsRef.current.find(x => x.id === activeIdRef.current);
          if (latestProj) {
            const label = `${type === "characters" ? "角色" : type === "scenes" ? "場景" : "道具"} - ${asset.name}`;
            const gallery = [...(latestProj.gallery || []), { img: imgUrl, label, timestamp: Date.now() }];
            updateProj("gallery", gallery);
          }
          break;
        }
      }
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes("429")) showToast("API 配額超限，請稍後重試");
      else showToast("生圖失敗：" + msg);
    } finally {
      setAssetGenSet(prev => { const s = new Set(prev); s.delete(assetId); return s; });
    }
  };

  // ─── Shot List panel management ───
  const updatePanel = (panelId, field, value) => {
    setProjects(prev => {
      const id = activeIdRef.current;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const panels = (p.shotlist || []).map(panel =>
        panel.id === panelId ? { ...panel, [field]: value } : panel
      );
      return prev.map(x => x.id === id ? { ...x, shotlist: panels, updatedAt: Date.now() } : x);
    });
    scheduleSave();
  };

  const removePanel = (panelId) => {
    const panels = (proj.shotlist || []).filter(p => p.id !== panelId);
    updateProj("shotlist", panels);
  };

  const movePanel = (panelId, direction) => {
    setProjects(prev => {
      const id = activeIdRef.current;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const panels = [...(p.shotlist || [])];
      const idx = panels.findIndex(pan => pan.id === panelId);
      if (idx < 0) return prev;
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= panels.length) return prev;
      [panels[idx], panels[targetIdx]] = [panels[targetIdx], panels[idx]];
      return prev.map(x => x.id === id ? { ...x, shotlist: panels, updatedAt: Date.now() } : x);
    });
    scheduleSave();
  };

  const addSegment = () => {
    const panels = proj.shotlist || [];
    const maxSeg = panels.reduce((m, p) => Math.max(m, p.segment || 1), 0);
    const newPanel = {
      id: "sb_" + Date.now(), image: null,
      segment: maxSeg + 1, segmentName: "", desc: "", shotSize: "", angle: "",
      movement: "", duration: "", audio: "", nbEn: "",
    };
    updateProj("shotlist", [...panels, newPanel]);
  };

  const addPanelToSeg = (segNum) => {
    const panels = proj.shotlist || [];
    const newPanel = {
      id: "sb_" + Date.now(), image: null,
      segment: segNum, segmentName: "", desc: "", shotSize: "", angle: "",
      movement: "", duration: "", audio: "", nbEn: "",
    };
    updateProj("shotlist", [...panels, newPanel]);
  };

  // ─── Storyboard: Banana image generation (Gemini) ───
  const [genSet, setGenSet] = useState(new Set());
  const [genStatus, setGenStatus] = useState({});
  const [shotLens, setShotLens] = useState({});
  const [shotLight, setShotLight] = useState({});

  // Director & cinematography style selection
  const [selDirs, setSelDirs] = useState([]);
  const [selCine, setSelCine] = useState("");

  // Reference images (project-level)
  const refFileRef = useRef(null);
  const [refImages, setRefImages] = useState([]); // [{file, preview, label}]

  const getImgParts = async () => {
    const parts = [];
    for (const ref of refImages) {
      if (ref.file) {
        const base64 = await toBase64(ref.file);
        parts.push({ inlineData: { data: base64, mimeType: ref.file.type } });
      } else if (ref.preview && !ref.preview.startsWith("blob:")) {
        try {
          const resp = await fetch(ref.preview);
          const blob = await resp.blob();
          const base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
          parts.push({ inlineData: { data: base64, mimeType: blob.type } });
        } catch {}
      }
    }
    return parts;
  };

  // Helper: convert a data URL or http URL to an inlineData part for Gemini
  const urlToImgPart = async (url) => {
    if (!url) return null;
    try {
      // data: URL — extract base64 directly
      if (url.startsWith("data:")) {
        const [meta, data] = url.split(",");
        const mimeMatch = meta.match(/data:([^;]+)/);
        return { inlineData: { data, mimeType: mimeMatch?.[1] || "image/png" } };
      }

      // blob: URL — read directly
      if (url.startsWith("blob:")) {
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
          return { inlineData: { data: base64, mimeType: blob.type } };
        } catch { return null; }
      }

      // http URL — try multiple methods
      // Method 1: direct fetch (works if CORS is configured)
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const blob = await resp.blob();
          const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
          return { inlineData: { data: base64, mimeType: blob.type } };
        }
      } catch {}

      // Method 2: fetch via R2 Worker proxy (add /proxy/ prefix)
      if (R2_WORKER_URL && url.includes(R2_WORKER_URL)) {
        try {
          const path = url.replace(R2_WORKER_URL, "");
          const resp = await fetch(`${R2_WORKER_URL}${path}`);
          if (resp.ok) {
            const blob = await resp.blob();
            const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
            return { inlineData: { data: base64, mimeType: blob.type } };
          }
        } catch {}
      }

      // Method 3: canvas fallback (works for images that can be displayed)
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];
      return { inlineData: { data: base64, mimeType: "image/png" } };
    } catch (e) {
      console.warn("[urlToImgPart] all methods failed for", url?.slice(0, 80), e.message);
      return null;
    }
  };

  const generateShotImg = async (panelId, variant) => {
    const settings = proj?.storyboardSettings || {};
    const model = settings.model || "gemini-3.1-flash-image-preview";
    if (!model.includes("image") && !model.includes("banana")) { showToast("請選擇 Nano Banana 模型"); return; }
    if (genSet.has(panelId)) return;
    setGenSet(prev => new Set(prev).add(panelId));
    setGenStatus(p => ({ ...p, [panelId]: "收集參考圖..." }));
    try {
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
      const nbModel = genAI.getGenerativeModel({ model, generationConfig: { responseModalities: ["image", "text"] } });

      const allPanels = proj.shotlist || [];
      const panel = allPanels.find(p => p.id === panelId);
      if (!panel) return;

      // ── Smart reference image selection (max 5) ──
      const allImgParts = [];
      const refLabels = [];
      const shotText = ((panel.desc || "") + " " + (panel.nbEn || "") + " " + (panel.audio || "")).toLowerCase();

      // 1. Characters — match by name/nameZh/desc keywords against shot text
      const chars = (proj.assets?.characters || []);
      const charsWithImg = chars.filter(c => c.image);
      const relevantChars = charsWithImg.filter(c => {
        const names = [c.name, c.nameZh, c.name?.split(" ").pop(), c.desc?.match(/[\u4e00-\u9fff]{2,}/g)]
          .flat().filter(Boolean).map(n => n.toLowerCase());
        return names.some(n => n.length >= 2 && shotText.includes(n));
      });
      // If no match, include up to 3 main characters (they're likely in most shots)
      const charsToUse = relevantChars.length > 0 ? relevantChars : charsWithImg.slice(0, 3);
      for (const c of charsToUse) {
        setGenStatus(p => ({ ...p, [panelId]: `載入角色：${c.name}...` }));
        const part = await urlToImgPart(c.image);
        if (part) { allImgParts.push(part); refLabels.push(`Character: ${c.name}`); }
      }

      // 2. Scene — find the ONE most relevant scene
      const segPanels = allPanels.filter(p => p.segment === panel.segment);
      const segName = (panel.segmentName || segPanels[0]?.segmentName || "").toLowerCase();
      const scenes = (proj.assets?.scenes || []).filter(s => s.image);
      let bestScene = scenes.find(s => segName && s.name && (
        segName.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(segName)
      ));
      if (!bestScene) bestScene = scenes.find(s => s.name && shotText.includes(s.name.toLowerCase()));
      if (!bestScene && scenes.length > 0) bestScene = scenes[0]; // fallback: first scene
      if (bestScene) {
        setGenStatus(p => ({ ...p, [panelId]: `載入場景：${bestScene.name}...` }));
        const part = await urlToImgPart(bestScene.image);
        if (part) { allImgParts.push(part); refLabels.push(`Scene: ${bestScene.name}`); }
      }

      // 3. Manual reference images (project-level)
      const manualParts = await getImgParts();
      for (const p of manualParts) { allImgParts.push(p); refLabels.push("Manual reference"); }

      // Cap at 5 total to avoid overloading the API
      if (allImgParts.length > 5) {
        console.log(`[ShotImg] Capping from ${allImgParts.length} to 5 reference images`);
        allImgParts.length = 5;
        refLabels.length = 5;
      }

      if (allImgParts.length === 0) {
        showToast("請先在美術設定生成角色/場景圖，或上傳參考圖");
        return;
      }

      setGenStatus(p => ({ ...p, [panelId]: `生成中...（${allImgParts.length} 張參考圖）` }));

      // ── Build prompt with context ──
      const sceneContext = segPanels.map(p => p.desc).filter(Boolean).join("; ");
      const charContext = chars.length > 0
        ? `\n\nCHARACTERS (use the character reference images above for exact appearance):\n${chars.map(c => `- ${c.name}: ${c.gender || ""}, ${c.hairStyle || ""}, ${c.eyeColor || ""} eyes, wearing ${c.outfit || ""}`).filter(c => c.length > 10).join("\n")}`
        : "";
      const sceneAssetContext = bestScene
        ? `\n\nSCENE (use the scene reference image for environment): ${bestScene.name} — ${bestScene.promptEn || bestScene.desc}`
        : "";

      const lens = shotLens[panelId] || "";
      const light = shotLight[panelId] || "";
      const lensStr = lens ? ` Shot on ${LENSES.find(l => l.id === lens)?.desc || ""}.` : "";
      const lightStr = light ? ` Lighting: ${LIGHTINGS.find(l => l.id === light)?.desc || ""}.` : "";

      let variantStr = "";
      if (variant === "angle") {
        const angles = ["low angle looking up", "high angle looking down", "bird's eye view", "dutch angle tilted", "over-the-shoulder", "extreme close-up detail"];
        variantStr = ` IMPORTANT: Show from a DIFFERENT camera angle: ${angles[Math.floor(Math.random() * angles.length)]}.`;
      } else if (typeof variant === "string" && variant.startsWith("style:")) {
        const s = RENDER_STYLES.find(x => x.id === variant.slice(6));
        variantStr = s ? ` IMPORTANT: Render in ${s.prompt}.` : "";
      } else if (typeof variant === "string" && variant.startsWith("relight:")) {
        const l = LIGHTINGS.find(x => x.id === variant.slice(8));
        variantStr = l ? ` IMPORTANT RELIGHTING: Keep the exact same composition, characters, and scene, but completely change the lighting to: ${l.desc}. The scene should look dramatically different due to the new lighting while maintaining all other visual elements.` : "";
      } else if (typeof variant === "string" && variant.startsWith("retake:")) {
        const compositions = {
          extreme_closeup: "Extreme close-up (大特寫): fill the entire frame with a single detail — eyes, lips, hands, or a key object. Show every pore and texture. No background visible.",
          closeup: "Close-up (特寫): head and shoulders only, capturing facial expression and emotion in detail. Shallow depth of field, blurred background.",
          medium: "Medium shot (中景): waist up, showing the character's body language and gesture. Some environment visible.",
          wide: "Wide shot (遠景): full body visible with surrounding environment. Character occupies about 1/3 of the frame.",
          extreme_wide: "Extreme wide shot (大遠景): character is small in a vast landscape. Emphasize scale. Character occupies less than 1/5 of the frame.",
          pov: "POV first-person (主觀視角): shot from the character's eyes. Show what they see — hands in foreground, environment ahead. No face visible.",
          ots: "Over-the-shoulder (過肩鏡頭): camera behind one character's shoulder, looking at the other character or the scene ahead. Shallow depth of field on the shoulder.",
          dutch: "Dutch angle (荷蘭角): camera tilted 15-30 degrees. Creates tension, unease, or dynamic energy. Same scene but tilted composition.",
        };
        const desc = compositions[variant.slice(7)] || "";
        variantStr = desc ? ` IMPORTANT RECOMPOSITION: Based on the reference image, recreate this SAME scene but reframe as: ${desc} Keep the same characters, environment, lighting, and mood — only change the composition and framing.` : "";
      }

      const isAnime = filmStyle === "anime";
      const styleStr = isAnime ? " Japanese anime style, cel-shaded." : " Photorealistic, real human, cinematic lighting.";
      const resStr = (settings.imgRes || "2k") === "4k" ? " Ultra high resolution 4K." : (settings.imgRes || "2k") === "2k" ? " High resolution 2K." : "";

      const refNote = refLabels.length > 0
        ? `\n\nREFERENCE IMAGES PROVIDED (${refLabels.length}):\n${refLabels.map((l, i) => `- Image ${i + 1}: ${l}`).join("\n")}\nIMPORTANT: Characters MUST match the character reference images exactly — same face, same hair, same outfit. Scene environment MUST match the scene reference image.`
        : "";

      const dirStyle = selDirs.length > 0
        ? `\n\nDIRECTOR STYLE: ${selDirs.map(id => { const d = DIRECTORS.find(x => x.id === id); return d ? `${d.name} (${d.desc})` : ""; }).filter(Boolean).join(", ")}. Apply their visual language to composition, lighting, and framing.`
        : "";
      const cineStyle = selCine ? (() => { const c = CINE_STYLES.find(x => x.id === selCine); return c ? `\n\nCINEMATOGRAPHY: ${c.name} style — ${c.desc}` : ""; })() : "";

      const prompt = `Generate a cinematic storyboard frame for scene "${segName}":\n\n${panel.nbEn || panel.desc}\n\nSCENE CONTEXT: ${sceneContext}${charContext}${sceneAssetContext}${dirStyle}${cineStyle}${refNote}\n\nMaintain character and environment consistency.${lensStr}${lightStr}${variantStr}${styleStr} 16:9.${resStr}`;

      const result = await nbModel.generateContent({
        contents: [{ role: "user", parts: [...allImgParts, { text: prompt }] }],
      });
      const parts = result.response.candidates?.[0]?.content?.parts || [];
      let found = false;
      for (const part of parts) {
        if (part.inlineData) {
          const raw = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          const projId = activeIdRef.current || "unknown";
          const r2Path = `${projId}/shots/${panelId}_${Date.now()}.png`;
          const imgUrl = await saveImageToR2(raw, r2Path);
          updatePanel(panelId, "image", imgUrl);
          const latestProj = projectsRef.current.find(x => x.id === activeIdRef.current);
          if (latestProj) {
            const label = `${panel.segmentName || "Shot"} - ${panel.desc?.slice(0, 30)}`;
            const gallery = [...(latestProj.gallery || []), { img: imgUrl, label, timestamp: Date.now() }];
            updateProj("gallery", gallery);
          }
          found = true; break;
        }
      }
      if (!found) showToast("生圖失敗：API 未回傳圖片");
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes("429")) showToast("API 配額超限，請稍後重試");
      else showToast("生圖失敗：" + msg);
    } finally {
      setGenSet(prev => { const s = new Set(prev); s.delete(panelId); return s; });
      setGenStatus(p => { const n = { ...p }; delete n[panelId]; return n; });
    }
  };

  // ─── Special modes: 九宮格, 正反打, 多角度 ───
  const [gridImg, setGridImg] = useState(null);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridMode, setGridMode] = useState(null);

  const generateSpecial = async (mode, panelId) => {
    const settings = proj?.storyboardSettings || {};
    const model = settings.model || "gemini-3.1-flash-image-preview";
    if (!model.includes("image") && !model.includes("banana")) { showToast("請選擇 Nano Banana 模型"); return; }
    const modeLabels = { grid9: "劇情九宮格", shotreverse: "正反打", multiangle: "多角度" };
    setGridLoading(true); setGridMode(mode); setGridImg(null);
    showToast(`正在生成${modeLabels[mode] || mode}，請稍候...`);
    try {
      const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
      const nbModel = genAI.getGenerativeModel({ model, generationConfig: { responseModalities: ["image", "text"] } });

      const allPanels = proj.shotlist || [];
      const panelIdx = allPanels.findIndex(p => p.id === panelId);
      const panel = allPanels[panelIdx];
      if (!panel) return;
      const sceneDesc = panel?.nbEn || panel?.desc || "";

      // Collect image: ONLY the current shot's image
      const allImgParts = [];
      if (panel.image) {
        const part = await urlToImgPart(panel.image);
        if (part) allImgParts.push(part);
      }
      if (allImgParts.length === 0) { showToast("此分鏡尚未生成圖片，請先生成分鏡圖"); return; }

      // Gather narrative context: surrounding shots
      const prevShots = allPanels.slice(Math.max(0, panelIdx - 2), panelIdx);
      const nextShots = allPanels.slice(panelIdx + 1, panelIdx + 3);
      const narrativeContext = [
        ...prevShots.map((s, i) => `[前${prevShots.length - i}鏡] ${s.desc}`),
        `[當前鏡頭 ★] ${panel.desc}`,
        ...nextShots.map((s, i) => `[後${i + 1}鏡] ${s.desc}`),
      ].join("\n");

      const isAnime = filmStyle === "anime";
      const styleStr = isAnime ? "Japanese anime style, cel-shaded." : "Photorealistic, cinematic, real human.";

      let prompt;
      if (mode === "grid9") {
        prompt = `Based on the reference image (the current storyboard frame), generate a 3x3 grid (9 panels) showing a NARRATIVE SEQUENCE — the story progression before and after this shot.

CURRENT SHOT (center panel #5): ${sceneDesc}

STORY CONTEXT:
${narrativeContext}

The 9 panels should tell a story sequence:
1. (Before) Establishing shot — setting the scene before the action
2. (Before) Build-up — tension or anticipation leading to this moment
3. (Before) Approach — the moment just before
4. (Before) Trigger — what causes the current shot
5. ★ CURRENT SHOT — matching the reference image exactly
6. (After) Reaction — immediate response to this moment
7. (After) Consequence — what happens next
8. (After) Resolution — the aftermath
9. (After) Transition — leading to the next scene

Each panel must maintain character consistency from the reference image. ${styleStr} Thin white borders between panels. Professional cinematic storyboard contact sheet. 16:9 overall ratio.`;
      } else if (mode === "shotreverse") {
        prompt = `Based on the reference image, generate a shot/reverse-shot (正反打) dialogue pair for this scene:

Scene: ${sceneDesc}

Left panel: Character A's perspective — medium close-up, over-the-shoulder of Character B
Right panel: Character B's perspective (reverse angle) — medium close-up, over-the-shoulder of Character A

Maintain character consistency from the reference image. Classic over-the-shoulder framing, shallow depth of field, matching eyeline, 180-degree rule. ${styleStr} Professional cinematic look.`;
      } else {
        prompt = `Based on the reference image, generate the SAME scene from 9 DIFFERENT camera angles arranged in a 3x3 grid:

Scene: ${sceneDesc}

Row 1:
1. Front view (正面) — facing the subject directly
2. 3/4 angle left (左斜側) — classic cinematic angle
3. Side profile left (左側面) — 90 degree side view

Row 2:
4. Low angle looking up (仰角) — dramatic, powerful, heroic
5. ★ Eye level medium (平角中景) — matching the reference image
6. High angle looking down (俯角) — vulnerability, context

Row 3:
7. Back view (背面) — showing from behind
8. 3/4 angle right (右斜側) — reverse cinematic angle
9. Over-the-shoulder (過肩) — intimate, dialogue framing

IMPORTANT: Every panel must show the EXACT same moment, same characters, same environment, same lighting — only the camera position changes. Characters must look identical to the reference image. ${styleStr} Thin white borders between all 9 panels. 16:9 overall ratio. Professional cinematography angle study sheet.`;
      }

      const result = await nbModel.generateContent({
        contents: [{ role: "user", parts: [...allImgParts, { text: prompt }] }],
      });
      const parts = result.response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData) {
          const raw = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          const projId = activeIdRef.current || "unknown";
          const r2Path = `${projId}/special/${mode}_${Date.now()}.png`;
          const imgUrl = await saveImageToR2(raw, r2Path);
          setGridImg(imgUrl);
          const latestProj = projectsRef.current.find(x => x.id === activeIdRef.current);
          if (latestProj) {
            const label = mode === "grid9" ? "九宮格" : mode === "shotreverse" ? "正反打" : "多角度";
            const gallery = [...(latestProj.gallery || []), { img: imgUrl, label, timestamp: Date.now() }];
            updateProj("gallery", gallery);
          }
          break;
        }
      }
      if (!parts.some(p => p.inlineData)) showToast("生成失敗：API 未回傳圖片");
      else showToast(`✓ ${modeLabels[mode]}生成完成`);
    } catch (e) { showToast("生成失敗：" + (e.message || String(e))); }
    setGridLoading(false);
  };

  // ─── AI: Shot List → Seedance Prompts (Claude) ───
  const [genPromptLoading, setGenPromptLoading] = useState(false);
  const [genPromptProgress, setGenPromptProgress] = useState(0);

  const generatePrompts = async () => {
    const latestProj = projects.find(p => p.id === activeId);
    const panels = latestProj?.shotlist || [];
    if (panels.length === 0) { showToast("請先建立分鏡表"); return; }
    setGenPromptLoading(true); setGenPromptProgress(10);
    try {
      const segMap = {};
      panels.forEach(p => {
        const s = p.segment || 1;
        if (!segMap[s]) segMap[s] = { name: p.segmentName || "", shots: [] };
        segMap[s].shots.push(p);
      });
      let storyboardText = "";
      Object.keys(segMap).sort((a, b) => a - b).forEach(segNum => {
        const seg = segMap[segNum];
        storyboardText += `【SEGMENT ${segNum}】${seg.name}\n`;
        seg.shots.forEach((shot, i) => {
          storyboardText += `Shot ${i + 1} (${shot.duration || "?s"}): ${shot.shotSize || ""}，${shot.angle || ""}，${shot.movement || ""}，${shot.desc || ""}，${shot.audio || ""}\n`;
        });
        storyboardText += "\n";
      });
      setGenPromptProgress(30);

      // Build director + cinematography style context
      const styleContext = (selDirs.length > 0 || selCine)
        ? `\n\n【導演風格與攝影風格 — 提示詞必須反映這些大師的視覺語言】\n`
          + (selDirs.length > 0 ? `導演：\n${selDirs.map(id => { const d = DIRECTORS.find(x => x.id === id); return d ? `• ${d.name}：${d.desc}` : ""; }).filter(Boolean).join("\n")}\n` : "")
          + (selCine ? (() => { const c = CINE_STYLES.find(x => x.id === selCine); return c ? `攝影風格：${c.name} — ${c.desc}\n` : ""; })() : "")
          + `\n要求：\n- 提示詞的[風格/美學定義]段落必須明確寫入這些大師的標誌性視覺元素\n- 鏡頭語言、光線、色彩、節奏都要體現他們的風格\n- 每個時間碼片段的描述要帶入他們慣用的鏡頭語彙`
        : "";

      const systemWithStyle = STORYBOARD_TO_PROMPT_PROMPT + styleContext;

      let messages = [{ role: "user", content: storyboardText }];
      let fullText = "";
      for (let i = 0; i < 3; i++) {
        const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: API_HEADERS,
          body: JSON.stringify({
            model: "claude-sonnet-4-6", max_tokens: 16000,
            system: systemWithStyle, messages,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        const chunk = (data.content || []).map(c => c.text || "").join("");
        fullText += chunk;
        if (data.stop_reason === "max_tokens") {
          messages = [...messages,
            { role: "assistant", content: fullText },
            { role: "user", content: "請從斷點處繼續。只輸出 JSON。" }
          ];
          setGenPromptProgress(50);
        } else break;
      }
      setGenPromptProgress(80);
      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("AI 回傳格式異常");
      const promptData = JSON.parse(jsonMatch[0]);
      const newPrompts = promptData.map((p, i) => ({
        id: "pm_" + Date.now() + "_" + i,
        segment: p.segment || (i + 1), title: p.title || `第${i + 1}段`,
        prompt: p.prompt || p.zh || "", upload: p.upload || "", bridge: p.bridge || "",
      }));
      updateMultiFields({
        prompts: newPrompts,
        status: { ...(latestProj.status || {}), storyboard: "done", video: "wip" },
      });
      showToast(`✓ 已生成 ${newPrompts.length} 段 Prompt`);
    } catch (e) { showToast("Prompt 生成失敗：" + (e.message || "未知錯誤")); }
    setGenPromptLoading(false); setGenPromptProgress(0);
  };

  // ─── Prompt management ───
  const updatePrompt = (promptId, field, value) => {
    const prompts = (proj.prompts || []).map(p => p.id === promptId ? { ...p, [field]: value } : p);
    updateProj("prompts", prompts);
  };
  const removePrompt = (promptId) => {
    updateProj("prompts", (proj.prompts || []).filter(p => p.id !== promptId));
  };

  // ─── Lightbox ───
  const [lightbox, setLightbox] = useState(null);

  // ─── Export / Import ───
  const importFileRef = useRef(null);
  const [exportData, setExportData] = useState(null);

  const exportAllProjects = () => {
    if (projects.length === 0) { showToast("沒有專案可匯出"); return; }
    setExportData(JSON.stringify(projects));
  };

  const importProjects = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : [data];
      let imported = 0;
      for (const p of arr) {
        if (!p.id || !p.name) continue;
        if (projects.find(x => x.id === p.id)) continue;
        await S.set("proj:" + p.id, p);
        imported++;
      }
      if (imported > 0) {
        const keys = await S.list("proj:");
        const loaded = [];
        for (const k of keys) { const p = await S.get(k); if (p) loaded.push(p); }
        loaded.sort((a, b) => b.updatedAt - a.updatedAt);
        setProjects(loaded);
        showToast(`✓ 已匯入 ${imported} 個專案`);
      } else showToast("沒有新專案可匯入");
    } catch (e) { showToast("匯入失敗：JSON 格式錯誤"); }
  };

  // ─── Render ───
  if (loading) return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: T.dim, fontSize: 14, fontFamily: "'Noto Sans TC', sans-serif" }}>載入中...</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'Noto Sans TC', sans-serif", display: "flex" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600;700;900&family=Share+Tech+Mono&family=Instrument+Sans:wght@400;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInScale { from{opacity:0;transform:scale(0.97)} to{opacity:1;transform:scale(1)} }
        @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.08);border-radius:4px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.15)}
        * { box-sizing: border-box; }
        body { margin: 0; background: ${T.bg}; color: ${T.text}; transition: background 0.3s, color 0.3s; }
        button { font-family: inherit; }
        input:focus, textarea:focus, select:focus { border-color: ${T.pur} !important; outline: none; }
        .card-hover { transition: box-shadow 0.2s, transform 0.15s; }
        .card-hover:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.08); transform: translateY(-1px); }
      `}</style>

      {/* ════ SIDEBAR ════ */}
      <div style={{
        width: 272, minWidth: 272, borderRight: `1px solid ${T.border}`,
        background: T.bg1, display: "flex", flexDirection: "column", height: "100vh",
      }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${T.border}`, background: `linear-gradient(180deg, ${T.bg2} 0%, ${T.bg1} 100%)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${T.pur}, ${T.red})`,
              display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
              boxShadow: "0 2px 8px rgba(124,92,191,0.3)",
            }}><Clapperboard size={18} /></div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.hi, fontFamily: "'Instrument Sans', sans-serif", letterSpacing: 0.5 }}>
                NextFrame
              </div>
              <div style={{ fontSize: 10, color: T.dim, letterSpacing: 1.5, fontFamily: "'Share Tech Mono', monospace", marginTop: -1 }}>
                STUDIO
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "14px 16px" }}>
          <Btn onClick={() => setShowNewDialog(true)} color={T.pur} icon={<Plus size={14} />} style={{ width: "100%", fontSize: 13, borderRadius: 10, padding: "10px 0", justifyContent: "center" }}>
            新建專案
          </Btn>
        </div>
        {showNewDialog && (
          <div style={{ padding: "0 14px 12px", animation: "fadeIn 0.2s ease" }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="專案名稱..."
              onKeyDown={e => e.key === "Enter" && createProject()}
              style={{ width: "100%", boxSizing: "border-box", background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", color: T.hi, fontSize: 14, outline: "none", fontFamily: "inherit", marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 6 }}>
              <Btn small onClick={createProject} color={T.grn} disabled={!newName.trim()}>建立</Btn>
              <Btn small ghost color={T.dim} onClick={() => { setShowNewDialog(false); setNewName(""); }}>取消</Btn>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {projects.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: T.dim, fontSize: 12 }}>
              還沒有專案，點擊上方按鈕建立
            </div>
          )}
          {projects.map(p => {
            const isActive = p.id === activeId;
            const doneCount = Object.values(p.status || {}).filter(s => s === "done").length;
            return (
              <div key={p.id} onClick={() => { flushSave(); setActiveId(p.id); setActivePhase("script"); }}
                style={{
                  padding: "14px 18px", cursor: "pointer", transition: "all 0.2s ease",
                  background: isActive ? T.purG : "transparent",
                  borderLeft: isActive ? `3px solid ${T.pur}` : "3px solid transparent",
                  borderBottom: `1px solid ${T.border}`,
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: isActive ? 700 : 500, color: isActive ? T.hi : T.text }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: isActive ? T.pur : T.dim, fontFamily: "'Share Tech Mono', monospace", background: isActive ? T.pur + "15" : T.bg, padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>{doneCount}/{PHASES.length}</div>
                </div>
                <div style={{ display: "flex", gap: 3, marginTop: 8 }}>
                  {PHASES.map(ph => (
                    <div key={ph.key} style={{ flex: 1, height: 3, borderRadius: 2,
                      background: (p.status?.[ph.key] === "done") ? ph.color : (p.status?.[ph.key] === "wip") ? T.amb + "66" : T.muted + "22",
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: 11, color: T.dim, marginTop: 5 }}>{new Date(p.updatedAt).toLocaleDateString("zh-TW")}</div>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 14px" }}>
          {/* User info */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "6px 8px", background: T.bg2, borderRadius: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg, ${T.pur}, ${T.blu})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              {user?.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name || "使用者"}</div>
              <div style={{ fontSize: 10, color: T.dim }}>{user?.role || ""}</div>
            </div>
            <div onClick={onLogout} title="登出" style={{ cursor: "pointer", color: T.dim, padding: 4 }}><LogOut size={14} /></div>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={exportAllProjects} style={{ flex: 1, padding: "6px 0", background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>⬇ 匯出</button>
            <input ref={importFileRef} type="file" accept=".json" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) importProjects(e.target.files[0]); e.target.value = ""; }} />
            <button onClick={() => importFileRef.current?.click()} style={{ flex: 1, padding: "6px 0", background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>⬆ 匯入</button>
            <button onClick={toggleDark} title={darkMode ? "切換亮色" : "切換暗色"}
              style={{ width: 32, padding: "6px 0", background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {darkMode ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </div>
          <div style={{ fontSize: 10, color: T.dim, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: saving ? T.amb : T.grn, display: "inline-block" }} />
            {saving ? "同步中..." : "已同步"}
          </div>
        </div>
      </div>

      {/* ════ MAIN CONTENT ════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {!proj ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: `linear-gradient(135deg, ${T.pur}15, ${T.red}15)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Clapperboard size={32} style={{ color: T.pur, opacity: 0.5 }} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 6 }}>選擇或建立一個專案</div>
              <div style={{ fontSize: 13, color: T.dim, lineHeight: 1.6 }}>從左側面板選擇現有專案，或點擊「新建專案」開始創作</div>
            </div>
            <Btn color={T.pur} icon={<Plus size={16} />} onClick={() => setShowNewDialog(true)}>新建專案</Btn>
          </div>
        ) : (
          <>
            {/* Project Header */}
            <div style={{ padding: "12px 24px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: T.bg1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: T.hi, letterSpacing: -0.3 }}>{proj.name}</h2>
                <span style={{ fontSize: 11, color: T.muted, fontFamily: "'Share Tech Mono', monospace" }}>{new Date(proj.createdAt).toLocaleDateString("zh-TW")}</span>
                {(proj.gallery || []).length > 0 && (
                  <Btn small outline color={T.amb} icon={<ImageIcon size={12} />} onClick={() => { flushSave(); setActivePhase("gallery"); }}>
                    圖庫 ({proj.gallery.length})
                  </Btn>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Btn small ghost color={T.dim} onClick={() => { const name = prompt("重新命名", proj.name); if (name?.trim()) updateProj("name", name.trim()); }} style={{ fontSize: 11 }}>重新命名</Btn>
                <Btn small ghost color={T.blu} icon={<Copy size={12} />} onClick={() => duplicateProject(proj.id)} style={{ fontSize: 11 }}>複製</Btn>
                <Btn small ghost color={T.red} icon={<Trash2 size={12} />} onClick={() => deleteProject(proj.id)} style={{ fontSize: 11 }}>刪除</Btn>
              </div>
            </div>

            {/* Phase Tabs — Step Pipeline */}
            <div style={{ display: "flex", alignItems: "center", padding: "0 20px", borderBottom: `1px solid ${T.border}`, background: T.bg1, height: 56, gap: 4 }}>
              {PHASES.map((ph, pi) => {
                const isActive = activePhase === ph.key;
                const st = proj.status?.[ph.key] || "empty";
                const PhIcon = [FileText, Palette, Film, Zap][pi];
                const isDone = st === "done";
                return (
                  <div key={ph.key} style={{ display: "flex", alignItems: "center" }}>
                    <div onClick={() => { flushSave(); setActivePhase(ph.key); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
                        borderRadius: 10, cursor: "pointer", transition: "all 0.2s ease",
                        background: isActive ? ph.color + "12" : "transparent",
                        border: isActive ? `1.5px solid ${ph.color}33` : "1.5px solid transparent",
                      }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                        background: isActive ? ph.color : isDone ? T.grn : T.bg3,
                        color: isActive || isDone ? "#fff" : T.dim, transition: "all 0.2s",
                      }}><PhIcon size={14} /></div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? ph.color : T.text, lineHeight: 1.2 }}>{ph.label}</div>
                        <div style={{ fontSize: 10, color: isDone ? T.grn : st === "wip" ? T.amb : T.muted, fontWeight: 500 }}>{STATUS_LABELS[st]}</div>
                      </div>
                    </div>
                    {pi < PHASES.length - 1 && (
                      <ArrowRight size={14} style={{ margin: "0 2px", color: T.muted, flexShrink: 0 }} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Phase Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 60px" }}>

              {/* ═══ PHASE 1: SCRIPT ═══ */}
              {activePhase === "script" && (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, color: T.hi }}>📝 腳本 / 劇本</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: T.dim }}>貼上文字、或匯入 DOCX / Excel / PDF 檔案</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input ref={scriptFileRef} type="file" accept=".docx,.xlsx,.xls,.pdf,.txt,.csv,.md" style={{ display: "none" }}
                        onChange={e => { if (e.target.files[0]) handleScriptFileImport(e.target.files[0]); e.target.value = ""; }} />
                      <Btn small outline color={T.blu} onClick={() => scriptFileRef.current?.click()} disabled={importing}>
                        {importing ? "匯入中..." : "📎 匯入檔案"}
                      </Btn>
                    </div>
                  </div>

                  {/* AI Script Generation */}
                  <div style={{ marginBottom: 16, padding: "18px 20px", background: `linear-gradient(135deg, ${T.pur}08, ${T.blu}08)`, border: `1.5px solid ${T.pur}20`, borderRadius: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <Sparkles size={16} style={{ color: T.pur }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.hi }}>一句話生成劇本</span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={scriptIdea} onChange={e => setScriptIdea(e.target.value)} placeholder="輸入故事概念，例如：「末日後的世界，一個少女帶著機器人穿越廢墟尋找父親」"
                        onKeyDown={e => e.key === "Enter" && generateScript()}
                        style={{ flex: 1, background: T.bg1, border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "11px 16px", color: T.hi, fontSize: 14, outline: "none", fontFamily: "inherit", transition: "border-color 0.2s" }} />
                      <Btn color={T.pur} icon={<Sparkles size={14} />} onClick={generateScript} disabled={genScriptLoading || !scriptIdea.trim()}>
                        {genScriptLoading ? "生成中..." : "AI 生成"}
                      </Btn>
                    </div>
                  </div>

                  {/* File drop zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.blu; }}
                    onDragLeave={e => { e.currentTarget.style.borderColor = T.border; }}
                    onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.border; const file = e.dataTransfer.files?.[0]; if (file) handleScriptFileImport(file); }}
                    style={{ border: `2px dashed ${T.border}`, borderRadius: 10, padding: "14px 20px", marginBottom: 12, textAlign: "center", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[{ ext: "DOCX", color: T.blu }, { ext: "XLSX", color: T.grn }, { ext: "PDF", color: T.red }, { ext: "TXT", color: T.dim }].map(f => (
                        <span key={f.ext} style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: f.color + "14", color: f.color, fontFamily: "'Share Tech Mono', monospace" }}>{f.ext}</span>
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: T.dim }}>拖曳檔案到此處</span>
                  </div>

                  <TArea value={proj.script || ""} onChange={v => updateProj("script", v)}
                    placeholder="在這裡貼上你的劇本、故事概念、角色描述..." rows={20} />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: T.dim }}>{(proj.script || "").length.toLocaleString()} 字</div>
                  </div>

                  {/* Style Configuration + Generate */}
                  <div style={{ marginTop: 16, background: T.bg1, border: `1.5px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
                    {/* Film style row */}
                    <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.hi }}>影片風格</span>
                        <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}` }}>
                          {Object.entries(STORYBOARD_STYLE_PRESETS).map(([key, preset]) => (
                            <button key={key} onClick={() => setFilmStyle(key)} style={{
                              padding: "7px 18px", border: "none", cursor: "pointer", fontSize: 13,
                              fontWeight: filmStyle === key ? 700 : 400, fontFamily: "inherit",
                              background: filmStyle === key ? (key === "anime" ? T.pur : T.blu) : T.bg2,
                              color: filmStyle === key ? "#fff" : T.text, transition: "all 0.2s",
                            }}>{preset.label}</button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Director + Cinematography row */}
                    <div style={{ padding: "14px 18px", display: "flex", gap: 16, borderBottom: `1px solid ${T.border}` }}>
                      {/* Directors */}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: T.hi, display: "flex", alignItems: "center", gap: 5 }}>
                            <Clapperboard size={13} style={{ color: T.pur }} /> 導演風格
                            {selDirs.length > 0 && <span style={{ fontSize: 10, color: T.pur }}>({selDirs.length})</span>}
                          </div>
                          {selDirs.length > 0 && <span onClick={() => setSelDirs([])} style={{ fontSize: 10, color: T.dim, cursor: "pointer" }}>清除</span>}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {DIRECTORS.map(d => {
                            const on = selDirs.includes(d.id);
                            return (
                              <div key={d.id} onClick={() => setSelDirs(p => on ? p.filter(x => x !== d.id) : [...p, d.id])}
                                title={d.desc}
                                style={{
                                  padding: "3px 10px", borderRadius: 16, cursor: "pointer", fontSize: 11,
                                  background: on ? T.pur + "18" : T.bg2,
                                  border: `1px solid ${on ? T.pur + "44" : T.border}`,
                                  color: on ? T.pur : T.dim, fontWeight: on ? 600 : 400,
                                  transition: "all 0.15s",
                                }}>{d.name}</div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Cinematography */}
                      <div style={{ width: 240, flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.hi, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                          <Camera size={13} style={{ color: T.amb }} /> 攝影風格
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                          {CINE_STYLES.map(c => {
                            const on = selCine === c.id;
                            return (
                              <div key={c.id} onClick={() => setSelCine(on ? "" : c.id)}
                                title={c.desc}
                                style={{
                                  padding: "3px 8px", borderRadius: 6, cursor: "pointer", fontSize: 10,
                                  background: on ? T.amb + "18" : T.bg2,
                                  border: `1px solid ${on ? T.amb + "44" : T.border}`,
                                  color: on ? T.amb : T.dim, fontWeight: on ? 600 : 400,
                                  textAlign: "center", transition: "all 0.15s",
                                }}>{c.name}</div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Generate button row */}
                    <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", background: T.bg2 }}>
                      <div style={{ fontSize: 11, color: T.dim }}>
                        {selDirs.length > 0 && <span style={{ color: T.pur, marginRight: 8 }}>{selDirs.map(id => DIRECTORS.find(x => x.id === id)?.name).join("、")}</span>}
                        {selCine && <span style={{ color: T.amb }}>{CINE_STYLES.find(c => c.id === selCine)?.name}</span>}
                        {!selDirs.length && !selCine && "可選擇導演和攝影風格來影響分鏡拆解"}
                      </div>
                      <Btn color={filmStyle === "anime" ? T.pur : T.blu} icon={<Film size={14} />} onClick={generateShotList}
                        disabled={analyzing || !(proj.script || "").trim()}>
                        {analyzing ? "AI 分析中..." : "AI 生成分鏡表"}
                      </Btn>
                    </div>
                  </div>

                  {analyzing && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ width: "100%", height: 3, background: T.bg3, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${analyzeProgress}%`, height: "100%", background: `linear-gradient(90deg, ${T.pur}, ${T.blu})`, transition: "width 0.5s ease", borderRadius: 2 }} />
                      </div>
                      <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: T.dim }}>AI 正在拆解腳本為分鏡格...</div>
                    </div>
                  )}
                </div>
              )}

              {/* ═══ PHASE 2: ART DESIGN (Assets) ═══ */}
              {activePhase === "assets" && (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, color: T.hi }}>🎭 美術設定 — 角色 / 場景 / 道具</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: T.dim }}>從腳本 AI 提取，或手動新增，每個設定都可用 Banana 生成概念圖</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 0, borderRadius: 6, overflow: "hidden", border: `1px solid ${T.border}` }}>
                        {Object.entries(STORYBOARD_STYLE_PRESETS).map(([key, preset]) => (
                          <button key={key} onClick={() => setFilmStyle(key)} style={{
                            padding: "5px 12px", border: "none", cursor: "pointer", fontSize: 11,
                            fontWeight: filmStyle === key ? 700 : 400, fontFamily: "inherit",
                            background: filmStyle === key ? (key === "anime" ? T.pur : T.blu) : T.bg1,
                            color: filmStyle === key ? "#fff" : T.text, transition: "all 0.2s",
                          }}>{preset.label}</button>
                        ))}
                      </div>
                      <Btn small color={T.cyn} onClick={generateAssets} disabled={genAssetsLoading || !(proj.script || "").trim()}>
                        {genAssetsLoading ? "⏳ AI 分析中..." : "🎭 從腳本 AI 提取"}
                      </Btn>
                    </div>
                  </div>

                  {genAssetsLoading && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ width: "100%", height: 3, background: T.bg3, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${genAssetsProgress}%`, height: "100%", background: `linear-gradient(90deg, ${T.cyn}, ${T.blu})`, transition: "width 0.5s ease" }} />
                      </div>
                      <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: T.dim }}>AI 正在分析腳本，提取角色、場景、道具...</div>
                    </div>
                  )}

                  {!(proj.assets?.characters?.length || proj.assets?.scenes?.length || proj.assets?.props?.length) && !genAssetsLoading && (
                    <div style={{ padding: "40px 0", textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 10, marginBottom: 16 }}>
                      <div style={{ fontSize: 13, color: T.dim, marginBottom: 12 }}>尚無美術設定</div>
                      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                        <Btn small color={T.cyn} onClick={() => { if ((proj.script || "").trim()) generateAssets(); else { setActivePhase("script"); showToast("請先輸入腳本"); } }}>🎭 從腳本 AI 提取</Btn>
                        <Btn small outline color={T.cyn} onClick={() => { addAsset("characters"); addAsset("scenes"); }}>＋ 手動新增</Btn>
                      </div>
                    </div>
                  )}

                  {[
                    { type: "characters", label: "🎭 角色 Characters", color: T.pur, aspect: "2/3" },
                    { type: "scenes", label: "🌆 場景 Scenes", color: T.cyn, aspect: "16/9" },
                    { type: "props", label: "⚙️ 道具 Props", color: T.amb, aspect: "1/1" },
                  ].map(({ type, label, color, aspect }) => (
                    <div key={type} style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color }}>{label}</div>
                        <Btn small color={color} onClick={() => addAsset(type)}>＋ 新增</Btn>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                        {(proj.assets?.[type] || []).map(asset => (
                          <AssetCard key={asset.id} asset={asset} type={type} aspect={aspect} color={color}
                            isGenning={assetGenSet.has(asset.id)}
                            onUpdate={(field, value) => updateAsset(type, asset.id, field, value)}
                            onRemove={() => removeAsset(type, asset.id)}
                            onGenImg={() => generateAssetImg(type, asset.id)}
                            onLightbox={setLightbox} />
                        ))}
                      </div>
                      {(proj.assets?.[type] || []).length === 0 && (
                        <div style={{ padding: "20px 0", textAlign: "center", color: T.dim, fontSize: 11, border: `1px dashed ${T.border}`, borderRadius: 8 }}>
                          尚無{label.split(" ")[0].replace(/[🎭🌆⚙️]/g, "")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ═══ PHASE 3: STORYBOARD (unified) ═══ */}
              {activePhase === "storyboard" && (() => {
                const { panels, segMap, segKeys } = getSegmentGroups();
                return (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T.hi, display: "flex", alignItems: "center", gap: 8 }}>
                        <Film size={18} style={{ color: T.pur }} /> 分鏡
                      </h3>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: T.dim }}>AI 拆解分鏡 + Banana 圖片生成</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select value={proj.storyboardSettings?.model || "gemini-3.1-flash-image-preview"}
                        onChange={e => updateProj("storyboardSettings", { ...(proj.storyboardSettings || {}), model: e.target.value })}
                        style={{ background: T.bg1, color: T.text, border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, outline: "none", fontFamily: "inherit" }}>
                        <option value="gemini-3.1-flash-image-preview">Nano Banana 2</option>
                        <option value="nano-banana-pro-preview">Nano Banana Pro</option>
                      </select>
                      <div style={{ display: "flex", gap: 2, background: T.bg3, borderRadius: 8, padding: 2 }}>
                        {["1k","2k","4k"].map(r => (
                          <button key={r} onClick={() => updateProj("storyboardSettings", { ...(proj.storyboardSettings || {}), imgRes: r })}
                            style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: (proj.storyboardSettings?.imgRes || "2k") === r ? T.bg1 : "transparent", color: (proj.storyboardSettings?.imgRes || "2k") === r ? T.pur : T.dim, fontSize: 11, cursor: "pointer", fontWeight: 700, boxShadow: (proj.storyboardSettings?.imgRes || "2k") === r ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s" }}>{r.toUpperCase()}</button>
                        ))}
                      </div>
                      {panels.length > 0 && panels.some(p => !p.image) && (
                        <Btn small color={T.amb} icon={<Camera size={13} />} onClick={() => {
                          const empty = panels.filter(p => !p.image && !genSet.has(p.id));
                          empty.forEach(p => generateShotImg(p.id));
                          showToast(`開始生成 ${empty.length} 張分鏡圖`);
                        }}>全部生成</Btn>
                      )}
                      <Btn small outline color={T.pur} icon={<Plus size={13} />} onClick={addSegment}>Segment</Btn>
                    </div>
                  </div>

                  {/* Reference Images (collapsible) */}
                  <div style={{ marginBottom: 16, padding: "10px 16px", background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 11, color: T.dim }}>
                        📷 額外參考圖 {refImages.length > 0 ? `(${refImages.length})` : ""}
                        {(proj.assets?.characters || []).filter(c => c.image).length > 0 && <span style={{ marginLeft: 8, color: T.grn }}>✓ 已從美術設定自動帶入角色/場景</span>}
                      </div>
                      <label style={{ fontSize: 11, color: T.pur, cursor: "pointer", fontWeight: 600 }}>
                        + 上傳
                        <input type="file" accept="image/*" multiple style={{ display: "none" }}
                          onChange={e => { const files = Array.from(e.target.files); setRefImages(prev => [...prev, ...files.map(f => ({ file: f, preview: URL.createObjectURL(f), label: "" }))]); e.target.value = ""; }} />
                      </label>
                    </div>
                    {refImages.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        {refImages.map((ref, i) => (
                          <div key={i} style={{ position: "relative", width: 60 }}>
                            <img src={ref.preview} alt="" style={{ width: 60, height: 45, objectFit: "cover", borderRadius: 4, border: `1px solid ${T.border}` }} />
                            <span onClick={() => setRefImages(prev => prev.filter((_, j) => j !== i))}
                              style={{ position: "absolute", top: -3, right: -3, width: 14, height: 14, background: T.red, color: "#fff", borderRadius: "50%", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>✕</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Empty state */}
                  {panels.length === 0 && (
                    <div style={{ padding: 50, textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 12 }}>
                      <div style={{ fontSize: 13, color: T.dim, marginBottom: 12 }}>尚無分鏡</div>
                      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                        <Btn small color={T.pur} onClick={() => { if ((proj.script || "").trim()) generateShotList(); else { setActivePhase("script"); showToast("請先輸入腳本"); } }}>▦ 從腳本 AI 生成</Btn>
                        <Btn small outline color={T.pur} onClick={addSegment}>＋ 手動新增</Btn>
                      </div>
                    </div>
                  )}

                  {/* Segment groups with shot cards */}
                  {segKeys.map(segNum => {
                    const seg = segMap[segNum];
                    const startSec = (segNum - 1) * 15;
                    const endSec = segNum * 15;
                    const totalDur = seg.panels.reduce((sum, p) => sum + (parseFloat(p.duration) || 0), 0);
                    return (
                      <div key={segNum} style={{ marginBottom: 24 }}>
                        {/* Segment header */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: T.purG, borderRadius: "10px 10px 0 0", borderBottom: `2px solid ${T.pur}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ background: T.pur, color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 5, fontFamily: "'Share Tech Mono', monospace" }}>SEG {segNum}</span>
                            <span style={{ fontSize: 11, color: T.dim, fontFamily: "'Share Tech Mono', monospace" }}>{startSec}–{endSec}s</span>
                            <input value={seg.name} onChange={e => {
                              const newN = e.target.value;
                              const updated = (proj.shotlist || []).map(p => (p.segment || 1) === segNum ? { ...p, segmentName: newN } : p);
                              updateProj("shotlist", updated);
                            }} placeholder="段落名稱..." style={{ background: "transparent", border: "none", borderBottom: `1px solid ${T.border}`, color: T.hi, fontSize: 13, fontWeight: 600, outline: "none", fontFamily: "inherit", width: 180, padding: "2px 4px" }} />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 10, color: totalDur > 15 ? T.red : T.dim }}>{totalDur > 0 ? `${totalDur}s / 15s` : ""}</span>
                            <Btn small ghost color={T.pur} onClick={() => addPanelToSeg(segNum)} style={{ fontSize: 10 }}>＋ 加格</Btn>
                          </div>
                        </div>

                        {/* Shot cards — visual cards with editing + generation */}
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: 12, background: T.bg3, borderRadius: "0 0 10px 10px" }}>
                          {seg.panels.map((panel, idx) => (
                            <div key={panel.id} style={{ width: 440, background: T.bg1, borderRadius: 10, overflow: "hidden", border: `1px solid ${T.border}`, display: "flex", flexDirection: "column" }}>
                              {/* Header bar */}
                              <div style={{ padding: "4px 10px", background: T.bg2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: T.pur, fontFamily: "'Share Tech Mono', monospace" }}>S{segNum}-{String(idx + 1).padStart(2, "0")}</span>
                                  <Btn small ghost color={T.dim} onClick={() => movePanel(panel.id, -1)} style={{ padding: "1px 4px", fontSize: 8 }}>◀</Btn>
                                  <Btn small ghost color={T.dim} onClick={() => movePanel(panel.id, 1)} style={{ padding: "1px 4px", fontSize: 8 }}>▶</Btn>
                                </div>
                                <div style={{ display: "flex", gap: 4 }}>
                                  {[panel.shotSize, panel.angle, panel.duration && `${panel.duration}s`].filter(Boolean).map((tag, i) => (
                                    <span key={i} style={{ fontSize: 8, padding: "1px 5px", background: T.purG, borderRadius: 3, color: T.pur }}>{tag}</span>
                                  ))}
                                  <Btn small ghost color={T.dim} onClick={() => removePanel(panel.id)} style={{ padding: "1px 5px", fontSize: 8 }}>✕</Btn>
                                </div>
                              </div>

                              {/* Image area with ShotCard logic */}
                              <ShotCard panel={panel} idx={panels.indexOf(panel)}
                                isGenning={genSet.has(panel.id)} genStatusText={genStatus[panel.id]}
                                shotLens={shotLens} shotLight={shotLight}
                                onSetLens={setShotLens} onSetLight={setShotLight}
                                onGenImg={generateShotImg} onSpecial={generateSpecial}
                                onLightbox={setLightbox} />

                              {/* Editable fields */}
                              <div style={{ padding: "6px 8px", borderTop: `1px solid ${T.border}` }}>
                                <textarea value={panel.desc} onChange={e => updatePanel(panel.id, "desc", e.target.value)} placeholder="畫面描述..." rows={2}
                                  style={{ width: "100%", boxSizing: "border-box", background: "transparent", border: "none", color: T.text, fontSize: 10, lineHeight: 1.5, resize: "none", outline: "none", fontFamily: "inherit" }} />
                                <div style={{ display: "flex", gap: 3, marginTop: 2, flexWrap: "wrap" }}>
                                  {[{ field: "shotSize", ph: "景別" }, { field: "angle", ph: "角度" }, { field: "movement", ph: "運鏡" }, { field: "duration", ph: "秒數" }].map(({ field, ph }) => (
                                    <input key={field} value={panel[field] || ""} onChange={e => updatePanel(panel.id, field, e.target.value)} placeholder={ph}
                                      style={{ flex: 1, minWidth: 42, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 3, padding: "2px 4px", color: T.text, fontSize: 9, outline: "none", fontFamily: "inherit" }} />
                                  ))}
                                </div>
                                <input value={panel.audio || ""} onChange={e => updatePanel(panel.id, "audio", e.target.value)} placeholder="🔊 對白 / 音效..."
                                  style={{ width: "100%", boxSizing: "border-box", marginTop: 2, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 3, padding: "2px 4px", color: T.text, fontSize: 9, outline: "none", fontFamily: "inherit" }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Grid/Special result */}
                  {(gridImg || gridLoading) && (
                    <div style={{ marginTop: 24, background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, background: T.bg2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: T.hi }}>
                          {gridMode === "grid9" ? "🔲 九宮格" : gridMode === "shotreverse" ? "🗣 正反打" : "📐 多角度"}
                        </span>
                        <div style={{ display: "flex", gap: 6 }}>
                          {gridImg && <Btn small outline color={T.dim} onClick={() => downloadImg(gridImg, `${gridMode}.png`)}>⬇ 下載</Btn>}
                          <Btn small ghost color={T.dim} onClick={() => { setGridImg(null); setGridMode(null); }}>✕</Btn>
                        </div>
                      </div>
                      <div style={{ padding: 16, display: "flex", justifyContent: "center" }}>
                        {gridLoading ? (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 40 }}>
                            <div style={{ width: 32, height: 32, border: `3px solid ${T.border}`, borderTopColor: T.pur, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                            <span style={{ fontSize: 13, color: T.dim }}>生成中...</span>
                          </div>
                        ) : gridImg ? <img src={gridImg} alt="" style={{ maxWidth: "100%", borderRadius: 8, cursor: "pointer" }} onClick={() => setLightbox({ img: gridImg, label: gridMode })} /> : null}
                      </div>
                    </div>
                  )}
                </div>
                );
              })()}

              {/* ═══ PHASE 4: VIDEO (Seedance Prompts) ═══ */}
              {activePhase === "video" && (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, color: T.hi }}>⚡ Seedance 2.0 Prompt / 影片生成</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: T.dim }}>從分鏡表 AI 生成 Seedance 提示詞，未來可直接接入 API</p>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn small color={T.red} onClick={generatePrompts} disabled={genPromptLoading || !(proj.shotlist || []).length}>
                        {genPromptLoading ? "⏳ 生成中..." : "⚡ AI 生成 Prompt"}
                      </Btn>
                      {(proj.prompts || []).length > 0 && (
                        <Btn small outline color={T.dim} onClick={() => {
                          const all = (proj.prompts || []).map((p, i) => `### ${p.title}\n**上傳素材建議：** ${p.upload || ""}\n\n${p.prompt || ""}\n\n**銜接建議：** ${p.bridge || ""}`).join("\n\n---\n\n");
                          copyText(all); showToast("已複製全部 Prompt");
                        }}>複製全部</Btn>
                      )}
                    </div>
                  </div>

                  {genPromptLoading && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ width: "100%", height: 3, background: T.bg3, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${genPromptProgress}%`, height: "100%", background: `linear-gradient(90deg, ${T.red}, ${T.amb})`, transition: "width 0.5s ease" }} />
                      </div>
                      <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: T.dim }}>AI 正在生成 Seedance 2.0 提示詞...</div>
                    </div>
                  )}

                  {(proj.prompts || []).length === 0 && !genPromptLoading && (
                    <div style={{ padding: "40px 0", textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 10 }}>
                      <div style={{ fontSize: 13, color: T.dim, marginBottom: 12 }}>尚無 Prompt</div>
                      <Btn small color={T.red} onClick={() => {
                        if ((proj.shotlist || []).length > 0) generatePrompts();
                        else { setActivePhase("shotlist"); showToast("請先建立分鏡表"); }
                      }}>⚡ 從分鏡表 AI 生成</Btn>
                    </div>
                  )}

                  {(proj.prompts || []).map((pm, idx) => (
                    <div key={pm.id} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px", background: T.card, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ background: T.red, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, fontFamily: "'Share Tech Mono', monospace" }}>#{String(idx + 1).padStart(2, "0")}</span>
                          <input value={pm.title} onChange={e => updatePrompt(pm.id, "title", e.target.value)} placeholder="Segment 標題..."
                            style={{ background: "transparent", border: "none", color: T.hi, fontSize: 13, fontWeight: 600, outline: "none", fontFamily: "inherit", width: 200 }} />
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn small ghost color={T.dim} onClick={() => { copyText(pm.prompt || ""); showToast("已複製"); }} icon={<Copy size={11} />}>複製</Btn>
                          <Btn small ghost color={T.red} onClick={() => removePrompt(pm.id)} style={{ fontSize: 10 }}>✕</Btn>
                        </div>
                      </div>
                      <div style={{ padding: 14 }}>
                        {/* Seedance 2.0 Prompt */}
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, color: T.pur, fontWeight: 600, marginBottom: 4 }}>Seedance 2.0 提示詞（可直接貼入）</div>
                          <textarea value={pm.prompt || ""} onChange={e => updatePrompt(pm.id, "prompt", e.target.value)} placeholder="完整的 Seedance 2.0 提示詞，含時間碼、@參考素材、限制條件..." rows={10}
                            style={{ width: "100%", boxSizing: "border-box", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, color: T.text, fontSize: 12, resize: "vertical", outline: "none", fontFamily: "'Share Tech Mono', 'Noto Sans TC', monospace", lineHeight: 1.8 }} />
                        </div>
                        {/* Upload suggestion */}
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, color: T.amb, fontWeight: 600, marginBottom: 4 }}>上傳素材建議</div>
                          <textarea value={pm.upload} onChange={e => updatePrompt(pm.id, "upload", e.target.value)} placeholder="@圖片1：角色正面全身照&#10;@圖片2：場景環境圖&#10;@視頻1：動作參考" rows={3}
                            style={{ width: "100%", boxSizing: "border-box", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: 8, color: T.text, fontSize: 11, resize: "none", outline: "none", fontFamily: "'Noto Sans TC', monospace", lineHeight: 1.6 }} />
                        </div>
                        {/* Bridge */}
                        <div>
                          <div style={{ fontSize: 10, color: T.grn, fontWeight: 600, marginBottom: 4 }}>銜接建議</div>
                          <input value={pm.bridge} onChange={e => updatePrompt(pm.id, "bridge", e.target.value)} placeholder="續寫@視頻1，下一段描述..."
                            style={{ width: "100%", boxSizing: "border-box", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", color: T.text, fontSize: 11, outline: "none", fontFamily: "inherit" }} />
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Future: Seedance API placeholder */}
                  <div style={{ marginTop: 20, padding: "20px 16px", background: T.bg2, border: `1px dashed ${T.border}`, borderRadius: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: T.dim, marginBottom: 6 }}>🚀 Seedance API 整合</div>
                    <div style={{ fontSize: 11, color: T.muted }}>未來將在此直接接入 Seedance 2.0 API，一鍵從 Prompt 生成影片片段</div>
                  </div>
                </div>
              )}
              {/* ═══ GALLERY PAGE ═══ */}
              {activePhase === "gallery" && (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, color: T.hi }}>🖼 圖庫 — {(proj.gallery || []).length} 張</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: T.dim }}>所有生成的角色卡、分鏡圖、特殊模式圖片</p>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn small ghost color={T.dim} onClick={() => setActivePhase("storyboard")}>← 返回分鏡</Btn>
                      {(proj.gallery || []).length > 0 && (
                        <>
                          <Btn small outline color={T.blu} icon={<Download size={12} />} onClick={async () => {
                            showToast("正在打包下載...");
                            try {
                              // Dynamic import JSZip from CDN
                              if (!window.JSZip) {
                                await new Promise((res, rej) => {
                                  const s = document.createElement("script");
                                  s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
                                  s.onload = res; s.onerror = rej;
                                  document.head.appendChild(s);
                                });
                              }
                              const zip = new window.JSZip();
                              const gallery = proj.gallery || [];
                              for (let i = 0; i < gallery.length; i++) {
                                const item = gallery[i];
                                const name = `${String(i + 1).padStart(3, "0")}_${(item.label || "image").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.png`;
                                try {
                                  const resp = await fetch(item.img);
                                  const blob = await resp.blob();
                                  zip.file(name, blob);
                                } catch {
                                  // Skip failed downloads
                                }
                              }
                              const content = await zip.generateAsync({ type: "blob" });
                              const url = URL.createObjectURL(content);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `${proj.name}_gallery_${Date.now()}.zip`;
                              document.body.appendChild(a); a.click(); document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                              showToast(`✓ 已下載 ${gallery.length} 張圖片`);
                            } catch (e) { showToast("打包失敗：" + e.message); }
                          }}>全部下載</Btn>
                          <Btn small ghost color={T.red} onClick={() => { if (confirm("確定清空圖庫？")) updateProj("gallery", []); }}>清空</Btn>
                        </>
                      )}
                    </div>
                  </div>

                  {(proj.gallery || []).length === 0 ? (
                    <div style={{ padding: "60px 0", textAlign: "center", color: T.dim, fontSize: 13 }}>圖庫是空的，生成角色卡或分鏡圖後會自動加入</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                      {(proj.gallery || []).map((item, i) => (
                        <div key={item.timestamp + "-" + i} style={{ borderRadius: 10, overflow: "hidden", position: "relative", cursor: "pointer", border: `1px solid ${T.border}`, background: T.bg1, transition: "box-shadow 0.2s" }}
                          onClick={() => setLightbox(item)}
                          onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)"}
                          onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
                          <div style={{ aspectRatio: "16/9", overflow: "hidden" }}>
                            <img src={item.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          </div>
                          <div style={{ padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 10, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{item.label}</span>
                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                              <div onClick={() => downloadImg(item.img, `${item.label}.png`)} style={{ fontSize: 10, color: T.dim, cursor: "pointer", padding: "2px 4px" }}>⬇</div>
                              <div onClick={() => updateProj("gallery", (proj.gallery || []).filter((_, j) => j !== i))} style={{ fontSize: 10, color: T.red, cursor: "pointer", padding: "2px 4px" }}>✕</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ════ Lightbox ════ */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
          <img src={lightbox.img} alt="" style={{ maxWidth: "90vw", maxHeight: "80vh", borderRadius: 8, objectFit: "contain" }} />
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "#fff", fontSize: 13 }}>{lightbox.label}</span>
            <button onClick={e => { e.stopPropagation(); downloadImg(lightbox.img, `${lightbox.label}.png`); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 8, padding: "6px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>⬇ 下載</button>
          </div>
        </div>
      )}

      {/* ════ Export Modal ════ */}
      {exportData && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => setExportData(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 14, padding: 24, width: "90%", maxWidth: 560, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.hi }}>匯出專案資料</div>
              <Btn small ghost color={T.dim} onClick={() => setExportData(null)}>✕</Btn>
            </div>
            <textarea readOnly value={exportData} onFocus={e => e.target.select()} style={{ flex: 1, minHeight: 200, width: "100%", boxSizing: "border-box", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, color: T.text, fontSize: 11, lineHeight: 1.5, fontFamily: "'Share Tech Mono', monospace", resize: "none", outline: "none" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <Btn small color={T.blu} onClick={() => { copyText(exportData); showToast("✓ 已複製"); }}>📋 複製全部</Btn>
              <Btn small outline color={T.dim} onClick={() => setExportData(null)}>關閉</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: T.bg3, border: `1px solid ${T.borderL}`, borderRadius: 8, padding: "8px 20px", color: T.hi, fontSize: 12, fontWeight: 500, animation: "fadeIn 0.2s ease", zIndex: 999, boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>{toast}</div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
//              APP WITH LOGIN
// ════════════════════════════════════════
export default function NextFrameStudio() {
  const [user, setUser] = useState(() => {
    try { const u = localStorage.getItem("nf_user"); return u ? JSON.parse(u) : null; }
    catch { return null; }
  });

  const handleLogout = () => {
    localStorage.removeItem("nf_user");
    setUser(null);
  };

  if (!user) return <LoginPage onLogin={setUser} />;
  return <MainApp user={user} onLogout={handleLogout} />;
}
