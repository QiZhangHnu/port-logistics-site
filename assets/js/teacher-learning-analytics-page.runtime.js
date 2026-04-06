import {
  auth,
  getUserContext,
  onAuthStateChanged,
  signOut
} from "./firebase-core.js";
import {
  buildAnalyticsBroadcastScript,
  buildChapterLearningAnalytics,
  listAssignmentAttempts,
  listAssignmentsForProfile,
  listAttemptAnswers,
  listCourseClasses,
  listPracticeAnswers,
  listPracticeAttempts,
  listQuestionItems,
  listQuestionKeysByPrefix,
  listUsersByFilters
} from "./course-data.js";
import { live2DBroadcastConfig } from "./live2d-broadcast-config.js?v=20260405-live2d";
const headerSummaryEl = document.getElementById("analytics-header-summary");
const classSelect = document.getElementById("analytics-class-select");
const sourceSelect = document.getElementById("analytics-source-select");
const chapterFocusSelect = document.getElementById("analytics-chapter-focus-select");
const filterForm = document.getElementById("learning-analytics-filter-form");
const messageEl = document.getElementById("learning-analytics-message");
const overviewCardsEl = document.getElementById("learning-overview-cards");
const overallSummaryEl = document.getElementById("analytics-overall-summary");
const chapterSectionsEl = document.getElementById("chapter-analysis-sections");
const signoutBtn = document.getElementById("analytics-signout-btn");
const generateBroadcastBtn = document.getElementById("generate-broadcast-script-btn");
const startBroadcastBtn = document.getElementById("start-broadcast-btn");
const pauseBroadcastBtn = document.getElementById("pause-broadcast-btn");
const stopBroadcastBtn = document.getElementById("stop-broadcast-btn");
const broadcastStatusChip = document.getElementById("broadcast-status-chip");
const broadcastCurrentTitleEl = document.getElementById("broadcast-current-title");
const broadcastSubtitleEl = document.getElementById("broadcast-subtitle");
const broadcastMetaEl = document.getElementById("broadcast-meta");
const broadcastSegmentCountEl = document.getElementById("broadcast-segment-count");
const broadcastScriptOutlineEl = document.getElementById("broadcast-script-outline");
const broadcastAvatarFrameEl = document.getElementById("broadcast-avatar-frame");
const broadcastAudioBarsEl = document.getElementById("broadcast-audio-bars");
const broadcastAvatarHintEl = document.getElementById("broadcast-avatar-hint");
const live2dAvatarStageEl = document.getElementById("live2d-avatar-stage");
const chartRoots = {
  chapterPerformance: document.getElementById("chapter-performance-chart"),
  abilityRadar: document.getElementById("ability-radar-chart"),
  weakKnowledge: document.getElementById("weak-knowledge-chart")
};
const state = {
  profile: null,
  classes: [],
  questionMap: /* @__PURE__ */ new Map(),
  questionKeyMap: /* @__PURE__ */ new Map(),
  analytics: null,
  chartInstances: /* @__PURE__ */ new Map(),
  broadcast: {
    script: null,
    activeSegmentId: "",
    isPlaying: false,
    isPaused: false,
    supported: typeof window !== "undefined" && "speechSynthesis" in window,
    voices: [],
    selectedVoice: null,
    avatarMode: "fallback",
    live2dReady: false,
    live2dSprite: null,
    live2dApp: null
  }
};
function setToneMessage(target, message, tone = "info") {
  if (!target) return;
  target.textContent = message || "";
  target.classList.remove("text-red-600", "text-emerald-600", "text-slate-600");
  if (!message) {
    target.classList.add("text-slate-600");
    return;
  }
  if (tone === "error") target.classList.add("text-red-600");
  else if (tone === "success") target.classList.add("text-emerald-600");
  else target.classList.add("text-slate-600");
}
function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}
function formatMetricNumber(value) {
  return Number(value || 0).toFixed(Number.isInteger(Number(value || 0)) ? 0 : 2);
}
function clampPercent(value) {
  return Math.max(0, Math.min(Number(value || 0), 100));
}
function masteryTone(level) {
  if (level === "strong") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (level === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}
function masteryLabel(level) {
  if (level === "strong") return "鎺屾彙绋冲畾";
  if (level === "warning") return "需要巩固";
  return "閲嶇偣琛ュ己";
}
function chapterTheme(level) {
  if (level === "strong") {
    return {
      hero: "theme-strong",
      badge: "border-white/20 bg-white/15 text-white",
      surface: "border-emerald-100 bg-emerald-50/70",
      progress: "linear-gradient(90deg, #0f766e 0%, #34d399 100%)"
    };
  }
  if (level === "warning") {
    return {
      hero: "theme-warning",
      badge: "border-white/20 bg-white/15 text-white",
      surface: "border-amber-100 bg-amber-50/70",
      progress: "linear-gradient(90deg, #d97706 0%, #fbbf24 100%)"
    };
  }
  return {
    hero: "theme-weak",
    badge: "border-white/20 bg-white/15 text-white",
    surface: "border-rose-100 bg-rose-50/70",
    progress: "linear-gradient(90deg, #dc2626 0%, #f87171 100%)"
  };
}
function createGradient(colors, horizontal = false) {
  if (!window.echarts?.graphic) {
    return colors[0];
  }
  return new window.echarts.graphic.LinearGradient(
    horizontal ? 0 : 0,
    horizontal ? 0 : 0,
    horizontal ? 1 : 0,
    horizontal ? 0 : 1,
    colors.map((color, index) => ({
      offset: colors.length === 1 ? 1 : index / (colors.length - 1),
      color
    }))
  );
}
function sourceMixText(chapter) {
  const segments = [];
  if (Number(chapter?.sourceBreakdown?.assignmentAttempts || 0) > 0) {
    segments.push(`浣滀笟 ${chapter.sourceBreakdown.assignmentAttempts}`);
  }
  if (Number(chapter?.sourceBreakdown?.practiceAttempts || 0) > 0) {
    segments.push(`缁煎悎缁冧範 ${chapter.sourceBreakdown.practiceAttempts}`);
  }
  return segments.length ? segments.join(" / ") : "鏆傛棤鏉ユ簮鏍锋湰";
}
function broadcastSourceLabel(value) {
  if (value === "assignment") return "?????";
  if (value === "practice") return "?????";
  return "浣滀笟 + 缁煎悎缁冧範";
}
function updateBroadcastStatusChip(label, tone = "idle") {
  if (!broadcastStatusChip) return;
  broadcastStatusChip.textContent = label;
  broadcastStatusChip.className = "rounded-full border px-3 py-1 text-xs font-semibold";
  if (tone === "playing") {
    broadcastStatusChip.classList.add("border-emerald-200", "bg-emerald-50", "text-emerald-700");
  } else if (tone === "paused") {
    broadcastStatusChip.classList.add("border-amber-200", "bg-amber-50", "text-amber-700");
  } else if (tone === "error") {
    broadcastStatusChip.classList.add("border-rose-200", "bg-rose-50", "text-rose-700");
  } else {
    broadcastStatusChip.classList.add("border-slate-200", "bg-slate-100", "text-slate-600");
  }
}
function clearBroadcastFocus() {
  chapterSectionsEl.querySelectorAll(".chapter-card.is-broadcast-focus").forEach((node) => node.classList.remove("is-broadcast-focus"));
}
function focusBroadcastChapter(chapterId) {
  clearBroadcastFocus();
  if (!chapterId) return;
  const card = chapterSectionsEl.querySelector(`.chapter-card[data-chapter-id="${chapterId}"]`);
  if (!card) return;
  card.classList.add("is-broadcast-focus");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}
function setAvatarSpeaking(isSpeaking) {
  broadcastAvatarFrameEl?.classList.toggle("is-speaking", isSpeaking);
  broadcastAudioBarsEl?.classList.toggle("is-speaking", isSpeaking);
  const sprite = state.broadcast.live2dSprite;
  if (!sprite || !state.broadcast.live2dReady) {
    return;
  }
  try {
    sprite.startMotion?.({
      group: isSpeaking ? live2DBroadcastConfig.introMotionGroup || "Tap" : live2DBroadcastConfig.idleMotionGroup || "Idle",
      no: 0,
      priority: isSpeaking ? 2 : 1
    });
  } catch (error) {
    console.warn("Live2D motion switch failed:", error);
  }
}
function renderBroadcastOutline(script) {
  const segments = script?.segments || [];
  broadcastSegmentCountEl.textContent = `${segments.length} ?`;
  if (!segments.length) {
    broadcastScriptOutlineEl.innerHTML = `
      <div class="rounded-[1.4rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        ???????????      </div>
    `;
    return;
  }
  broadcastScriptOutlineEl.innerHTML = segments.map((segment, index) => `
    <article
      data-broadcast-segment-id="${segment.id}"
      class="rounded-[1.35rem] border border-slate-200 bg-slate-50 px-4 py-4 transition"
    >
      <div class="flex items-start gap-3">
        <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-500 shadow-sm">${index + 1}</span>
        <div>
          <p class="text-sm font-semibold text-slate-800">${segment.title}</p>
          <p class="mt-2 text-sm leading-7 text-slate-500">${segment.text}</p>
        </div>
      </div>
    </article>
  `).join("");
}
function highlightBroadcastSegment(segmentId) {
  broadcastScriptOutlineEl?.querySelectorAll("[data-broadcast-segment-id]").forEach((node) => {
    const active = node.dataset.broadcastSegmentId === segmentId;
    node.classList.toggle("border-ocean-mid", active);
    node.classList.toggle("bg-sky-50", active);
    node.classList.toggle("shadow-[0_16px_30px_rgba(17,93,140,0.08)]", active);
    if (active) {
      node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}
function updateBroadcastButtons() {
  const hasScript = Boolean(state.broadcast.script?.segments?.length);
  startBroadcastBtn.disabled = !hasScript;
  pauseBroadcastBtn.disabled = !state.broadcast.isPlaying;
  stopBroadcastBtn.disabled = !state.broadcast.isPlaying && !state.broadcast.isPaused;
  generateBroadcastBtn.disabled = !state.analytics;
  [startBroadcastBtn, pauseBroadcastBtn, stopBroadcastBtn, generateBroadcastBtn].forEach((button) => {
    if (!button) return;
    button.classList.toggle("opacity-50", button.disabled);
    button.classList.toggle("cursor-not-allowed", button.disabled);
  });
  pauseBroadcastBtn.textContent = state.broadcast.isPaused ? "??" : "??";
}
function resetBroadcastDisplay() {
  state.broadcast.activeSegmentId = "";
  broadcastCurrentTitleEl.textContent = "绛夊緟鎾姤";
  broadcastSubtitleEl.textContent = "?????????????????????????????";
  highlightBroadcastSegment("");
  clearBroadcastFocus();
  setAvatarSpeaking(false);
  updateBroadcastStatusChip(state.broadcast.script ? "???" : "???");
  updateBroadcastButtons();
}
function buildClassLabel() {
  const currentOption = classSelect?.selectedOptions?.[0];
  return currentOption?.textContent?.trim() || normalizeSelectedClassId() || "????";
}
function generateBroadcastScriptFromState() {
  if (!state.analytics) {
    state.broadcast.script = null;
    renderBroadcastOutline(null);
    resetBroadcastDisplay();
    return;
  }
  state.broadcast.script = buildAnalyticsBroadcastScript(state.analytics, {
    classLabel: buildClassLabel(),
    sourceLabel: broadcastSourceLabel(sourceSelect.value)
  });
  renderBroadcastOutline(state.broadcast.script);
  broadcastCurrentTitleEl.textContent = state.broadcast.script.title;
  broadcastSubtitleEl.textContent = state.broadcast.script.segments[0]?.text || "???????";
  broadcastMetaEl.textContent = state.broadcast.supported ? `????????????????????? ${state.broadcast.script.segments.length} ????` : "??????????????????????????";
  updateBroadcastStatusChip("???");
  updateBroadcastButtons();
}
function updateBroadcastSegment(segment) {
  state.broadcast.activeSegmentId = segment?.id || "";
  broadcastCurrentTitleEl.textContent = segment?.title || "绛夊緟鎾姤";
  broadcastSubtitleEl.textContent = segment?.text || "??????????";
  highlightBroadcastSegment(segment?.id || "");
  focusBroadcastChapter(segment?.chapterId || "");
}
function stopBroadcastPlayback() {
  if (state.broadcast.supported) {
    window.speechSynthesis.cancel();
  }
  state.broadcast.isPlaying = false;
  state.broadcast.isPaused = false;
  setAvatarSpeaking(false);
  updateBroadcastStatusChip(state.broadcast.script ? "???" : "???");
  updateBroadcastButtons();
}
function chooseBroadcastVoice() {
  if (!state.broadcast.supported) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  state.broadcast.voices = voices;
  state.broadcast.selectedVoice = voices.find((voice) => /zh(-|_)?CN/i.test(voice.lang)) || voices.find((voice) => /^zh/i.test(voice.lang)) || voices[0] || null;
  return state.broadcast.selectedVoice;
}
async function playBroadcastSegments(segments, index = 0) {
  if (!state.broadcast.supported || !segments.length || index >= segments.length) {
    stopBroadcastPlayback();
    resetBroadcastDisplay();
    return;
  }
  const voice = chooseBroadcastVoice();
  const segment = segments[index];
  const utterance = new SpeechSynthesisUtterance(segment.text);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || "zh-CN";
  } else {
    utterance.lang = "zh-CN";
  }
  utterance.rate = 1.02;
  utterance.pitch = 1;
  utterance.onstart = () => {
    state.broadcast.isPlaying = true;
    state.broadcast.isPaused = false;
    setAvatarSpeaking(true);
    updateBroadcastStatusChip("???", "playing");
    updateBroadcastSegment(segment);
    updateBroadcastButtons();
  };
  utterance.onend = () => {
    setAvatarSpeaking(false);
    if (!state.broadcast.isPlaying) {
      return;
    }
    if (index + 1 < segments.length) {
      playBroadcastSegments(segments, index + 1);
      return;
    }
    stopBroadcastPlayback();
    updateBroadcastStatusChip("鎾姤瀹屾垚", "idle");
    broadcastCurrentTitleEl.textContent = "鎾姤瀹屾垚";
    broadcastSubtitleEl.textContent = segment.text;
  };
  utterance.onerror = () => {
    stopBroadcastPlayback();
    updateBroadcastStatusChip("鎾姤澶辫触", "error");
    setToneMessage(messageEl, "????????????????????????", "error");
  };
  window.speechSynthesis.speak(utterance);
}
async function startBroadcastPlayback() {
  const segments = state.broadcast.script?.segments || [];
  if (!segments.length) {
    generateBroadcastScriptFromState();
  }
  if (!state.broadcast.supported) {
    updateBroadcastStatusChip("???", "error");
    setToneMessage(messageEl, "????????????????????????", "error");
    return;
  }
  window.speechSynthesis.cancel();
  await playBroadcastSegments(state.broadcast.script?.segments || []);
}
function toggleBroadcastPause() {
  if (!state.broadcast.supported || !state.broadcast.isPlaying) {
    return;
  }
  if (state.broadcast.isPaused) {
    window.speechSynthesis.resume();
    state.broadcast.isPaused = false;
    setAvatarSpeaking(true);
    updateBroadcastStatusChip("???", "playing");
  } else {
    window.speechSynthesis.pause();
    state.broadcast.isPaused = true;
    setAvatarSpeaking(false);
    updateBroadcastStatusChip("???", "paused");
  }
  updateBroadcastButtons();
}
async function initLive2DBroadcastAvatar() {
  if (!live2DBroadcastConfig?.enabled || !live2DBroadcastConfig?.modelJsonPath || !live2dAvatarStageEl) {
    broadcastAvatarHintEl.textContent = "??????????????? Live2D Core ????????? easy-live2d ??????";
    return;
  }
  if (!window.Live2DCubismCore) {
    broadcastAvatarHintEl.textContent = "??? Live2D ???????? Cubism Core??????????? Core ???";
    return;
  }
  try {
    const easyLive2D = await import(live2DBroadcastConfig.bundlePath);
    const { Application, Ticker, Config, Live2DSprite, Priority } = easyLive2D;
    if (!Application || !Live2DSprite) {
      throw new Error("easy-live2d bundle ??????");
    }
    Config.MotionGroupIdle = live2DBroadcastConfig.idleMotionGroup || "Idle";
    Config.MouseFollow = false;
    const canvas = document.createElement("canvas");
    canvas.className = "h-full w-full";
    live2dAvatarStageEl.innerHTML = "";
    live2dAvatarStageEl.appendChild(canvas);
    const app = new Application();
    await app.init({
      view: canvas,
      backgroundAlpha: 0,
      autoDensity: true,
      width: live2dAvatarStageEl.clientWidth || 360,
      height: live2dAvatarStageEl.clientHeight || 450,
      resolution: Math.max(window.devicePixelRatio || 1, 1)
    });
    const sprite = new Live2DSprite();
    sprite.init({
      modelPath: live2DBroadcastConfig.modelJsonPath,
      ticker: Ticker.shared
    });
    const stageWidth = live2dAvatarStageEl.clientWidth || 360;
    const stageHeight = live2dAvatarStageEl.clientHeight || 450;
    const scale = live2DBroadcastConfig.scale || 0.34;
    sprite.x = -stageWidth * 0.34;
    sprite.y = -stageHeight * 0.3;
    sprite.width = stageWidth * window.devicePixelRatio * scale * 3.05;
    sprite.height = stageHeight * window.devicePixelRatio * scale * 3.05;
    app.stage.addChild(sprite);
    state.broadcast.live2dReady = true;
    state.broadcast.live2dSprite = sprite;
    state.broadcast.live2dApp = app;
    document.getElementById("broadcast-avatar-fallback")?.classList.add("hidden");
    broadcastAvatarHintEl.textContent = "当前已挂载 easy-live2d Hiyori 模型，播报时会尝试切换待机动作。";
    window.setTimeout(() => {
      try {
        sprite.startMotion?.({
          group: live2DBroadcastConfig.idleMotionGroup || "Idle",
          no: 0,
          priority: Priority?.Normal ?? 1
        });
      } catch (error) {
        console.warn("Initial Live2D idle motion failed:", error);
      }
    }, 420);
    sprite.onLive2D?.("ready", async () => {
      state.broadcast.live2dReady = true;
      state.broadcast.live2dSprite = sprite;
      state.broadcast.live2dApp = app;
      document.getElementById("broadcast-avatar-fallback")?.classList.add("hidden");
      broadcastAvatarHintEl.textContent = "????? easy-live2d Hiyori ??????????????";
      try {
        await sprite.startMotion({
          group: live2DBroadcastConfig.idleMotionGroup || "Idle",
          no: 0,
          priority: Priority?.Normal ?? 1
        });
      } catch (error) {
      }
    });
    state.broadcast.avatarMode = "live2d";
  } catch (error) {
    console.error("Live2D avatar init failed:", error);
    broadcastAvatarHintEl.textContent = "Live2D ?????????????????????";
  }
}
function getChart(name) {
  if (!window.echarts || !chartRoots[name]) {
    return null;
  }
  if (!state.chartInstances.has(name)) {
    state.chartInstances.set(name, window.echarts.init(chartRoots[name]));
  }
  return state.chartInstances.get(name);
}
function resizeCharts() {
  state.chartInstances.forEach((chart) => chart.resize());
  if (state.broadcast.live2dApp?.renderer && live2dAvatarStageEl) {
    const width = live2dAvatarStageEl.clientWidth || 360;
    const height = live2dAvatarStageEl.clientHeight || 450;
    state.broadcast.live2dApp.renderer.resize(width, height);
    if (state.broadcast.live2dSprite) {
      const scale = live2DBroadcastConfig.scale || 0.34;
      state.broadcast.live2dSprite.x = -width * 0.34;
      state.broadcast.live2dSprite.y = -height * 0.3;
      state.broadcast.live2dSprite.width = width * window.devicePixelRatio * scale * 3.05;
      state.broadcast.live2dSprite.height = height * window.devicePixelRatio * scale * 3.05;
    }
  }
}
function renderChartPlaceholder(target, message) {
  if (!target) return;
  target.innerHTML = `
    <div class="flex h-full items-center justify-center rounded-[1.75rem] border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-6 text-center text-sm leading-7 text-slate-500">
      <div class="max-w-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Analytics Pending</p>
        <p class="mt-3">${message}</p>
      </div>
    </div>
  `;
}
function renderPageEmpty(message = "???????????????") {
  overviewCardsEl.innerHTML = `
    <article class="metric-card rounded-[1.9rem] border border-dashed border-slate-300 bg-white/88 px-6 py-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-4">
      <p class="section-kicker">Overview</p>
      <p class="mt-3">${message}</p>
    </article>
  `;
  overallSummaryEl.innerHTML = `
    <div class="rounded-[1.5rem] bg-white/75 px-5 py-5 text-sm leading-7 text-slate-500">
      <p>${message}</p>
    </div>
  `;
  chapterSectionsEl.innerHTML = `
    <article class="chapter-card rounded-[2rem] border border-dashed border-slate-300 bg-white/88 px-6 py-10 text-center text-sm text-slate-500">
      <p class="section-kicker">Chapter Review</p>
      <p class="mt-3">${message}</p>
    </article>
  `;
  renderChartPlaceholder(chartRoots.chapterPerformance, message);
  renderChartPlaceholder(chartRoots.abilityRadar, message);
  renderChartPlaceholder(chartRoots.weakKnowledge, message);
}
function renderOverviewCards(analytics) {
  const cards = [
    {
      label: "???",
      value: formatPercent(analytics.participationRate),
      note: `${analytics.activeStudentCount}/${analytics.totalStudents} 鍚嶅鐢熸湁鏈夋晥浣滅瓟鏁版嵁`,
      progress: analytics.participationRate,
      accent: "?",
      meta: `???? ${formatMetricNumber(analytics.activeStudentCount)} ?`
    },
    {
      label: "?????",
      value: formatPercent(analytics.avgPerformanceRate),
      note: "?????????????????",
      progress: analytics.avgPerformanceRate,
      accent: "?",
      meta: `?? ${formatMetricNumber(analytics.totalAnsweredCount)} ?????`
    },
    {
      label: "瀹㈣棰樻纭巼",
      value: formatPercent(analytics.correctRate),
      note: `??? ${analytics.objectiveCount} ??????`,
      progress: analytics.correctRate,
      accent: "?",
      meta: `??? ${formatMetricNumber(analytics.objectiveCount)} ???`
    },
    {
      label: "鐭ヨ瘑鐐瑰钩鍧囨帉鎻＄巼",
      value: formatPercent(analytics.masteryRate),
      note: `?? ${analytics.chapterCount} ???`,
      progress: analytics.masteryRate,
      accent: "?",
      meta: `???? ${formatMetricNumber(analytics.chapterCount)} ?`
    }
  ];
  overviewCardsEl.innerHTML = cards.map((item) => `
    <article class="metric-card rounded-[1.9rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.88))] px-5 py-5 shadow-[0_20px_50px_rgba(15,23,42,0.07)] backdrop-blur">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="section-kicker text-slate-500">${item.label}</p>
          <p class="mt-4 text-4xl font-bold tracking-tight text-ocean-deep">${item.value}</p>
        </div>
        <span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ocean-deep text-base font-bold text-white shadow-[0_14px_24px_rgba(17,93,140,0.22)]">${item.accent}</span>
      </div>
      <p class="mt-4 text-sm leading-6 text-slate-500">${item.note}</p>
      <div class="mt-5">
        <div class="metric-progress">
          <span style="width:${Math.max(clampPercent(item.progress), 8)}%"></span>
        </div>
        <div class="mt-2 flex items-center justify-between text-xs font-medium text-slate-500">
          <span>褰撳墠鐝骇琛ㄧ幇</span>
          <span>${item.meta}</span>
        </div>
      </div>
    </article>
  `).join("");
}
function renderOverallSummary(analytics) {
  const weakestChapters = analytics.chapters.slice(0, 3).map((item) => item.displayLabel);
  const weakestKnowledge = analytics.overallWeakKnowledgeTopN.slice(0, 3).map((item) => item.label);
  overallSummaryEl.innerHTML = `
    <div class="space-y-4">
      <div class="rounded-[1.6rem] bg-ocean-deep px-5 py-5 text-white shadow-[0_18px_40px_rgba(17,93,140,0.22)]">
        <p class="section-kicker text-white/60">Overall Reading</p>
        <p class="mt-3 text-sm leading-8 text-white/90">${analytics.overallNarrative}</p>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-[1.45rem] border border-white/80 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p class="section-kicker">閲嶇偣绔犺妭</p>
          <p class="mt-3 text-sm leading-7 text-slate-600">${weakestChapters.length ? weakestChapters.join("?") : "????????????????"}</p>
        </div>
        <div class="rounded-[1.45rem] border border-white/80 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <p class="section-kicker">???????</p>
          <p class="mt-3 text-sm leading-7 text-slate-600">${weakestKnowledge.length ? weakestKnowledge.join("?") : "???????????????"}</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">绋冲畾绔犺妭 ${analytics.masteryBucketSummary.strong}</span>
        <span class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">宸╁浐绔犺妭 ${analytics.masteryBucketSummary.warning}</span>
        <span class="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">琛ュ己绔犺妭 ${analytics.masteryBucketSummary.weak}</span>
      </div>
    </div>
  `;
}
function renderChapterPerformanceChart(analytics) {
  const chart = getChart("chapterPerformance");
  if (!chart || !analytics.chapters.length) {
    renderChartPlaceholder(chartRoots.chapterPerformance, "???????????????");
    return;
  }
  chartRoots.chapterPerformance.innerHTML = "";
  chart.setOption({
    animationDuration: 650,
    color: ["#115D8C", "#38BDF8"],
    grid: { left: 48, right: 28, top: 64, bottom: 56 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15,23,42,0.92)",
      borderWidth: 0,
      textStyle: { color: "#fff" },
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,163,184,0.08)" } }
    },
    legend: {
      data: ["鐭ヨ瘑鐐规帉鎻＄巼", "瀹㈣棰樻纭巼"],
      top: 12,
      textStyle: { color: "#475569", fontSize: 12 },
      itemWidth: 18,
      itemHeight: 10
    },
    xAxis: {
      type: "category",
      data: analytics.chartSeries.chapterLabels,
      axisLine: { lineStyle: { color: "#CBD5E1" } },
      axisTick: { show: false },
      axisLabel: {
        interval: 0,
        rotate: 18,
        color: "#475569",
        fontSize: 12
      }
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%", color: "#64748B" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.16)" } }
    },
    series: [
      {
        name: "鐭ヨ瘑鐐规帉鎻＄巼",
        type: "bar",
        barMaxWidth: 34,
        itemStyle: {
          borderRadius: [12, 12, 0, 0],
          color: createGradient(["#0B3A5A", "#115D8C", "#38BDF8"])
        },
        data: analytics.chartSeries.chapterMasteryRates
      },
      {
        name: "瀹㈣棰樻纭巼",
        type: "line",
        smooth: true,
        symbolSize: 10,
        lineStyle: { width: 4, color: "#38BDF8" },
        itemStyle: { color: "#E0F2FE", borderColor: "#0284C7", borderWidth: 3 },
        areaStyle: {
          color: createGradient(["rgba(56,189,248,0.32)", "rgba(56,189,248,0.02)"])
        },
        data: analytics.chartSeries.chapterCorrectRates
      }
    ]
  });
}
function renderAbilityRadarChart(analytics) {
  const chart = getChart("abilityRadar");
  const items = [...analytics.overallAbilityMastery].sort((left, right) => right.totalCount - left.totalCount).slice(0, 6);
  if (!chart || !items.length) {
    renderChartPlaceholder(chartRoots.abilityRadar, "??????????????????????");
    return;
  }
  chartRoots.abilityRadar.innerHTML = "";
  chart.setOption({
    animationDuration: 500,
    tooltip: {},
    radar: {
      radius: "62%",
      indicator: items.map((item) => ({ name: item.label, max: 100 })),
      axisName: { color: "#334155" },
      splitNumber: 4,
      splitArea: {
        areaStyle: {
          color: ["rgba(199,227,255,0.18)", "rgba(17,93,140,0.04)"]
        }
      },
      splitLine: {
        lineStyle: { color: ["rgba(148,163,184,0.16)"] }
      },
      axisLine: {
        lineStyle: { color: "rgba(148,163,184,0.2)" }
      }
    },
    series: [
      {
        type: "radar",
        data: [
          {
            value: items.map((item) => item.masteryRate),
            name: "?????",
            areaStyle: { color: "rgba(17,93,140,0.2)" },
            lineStyle: { color: "#115D8C", width: 3 },
            itemStyle: { color: "#115D8C" }
          }
        ]
      }
    ]
  });
}
function renderWeakKnowledgeChart(analytics) {
  const chart = getChart("weakKnowledge");
  const items = analytics.overallWeakKnowledgeTopN.slice(0, 10);
  if (!chart || !items.length) {
    renderChartPlaceholder(chartRoots.weakKnowledge, "????????????????????");
    return;
  }
  chartRoots.weakKnowledge.innerHTML = "";
  chart.setOption({
    animationDuration: 650,
    color: ["#F59E0B"],
    grid: { left: 168, right: 28, top: 28, bottom: 24 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: "rgba(245,158,11,0.08)" } },
      backgroundColor: "rgba(15,23,42,0.92)",
      borderWidth: 0,
      textStyle: { color: "#fff" }
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%", color: "#64748B" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.16)" } }
    },
    yAxis: {
      type: "category",
      data: items.map((item) => item.label).reverse(),
      axisLabel: { color: "#475569", fontSize: 12 },
      axisTick: { show: false },
      axisLine: { show: false }
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 18,
        showBackground: true,
        backgroundStyle: {
          color: "rgba(148,163,184,0.12)",
          borderRadius: [0, 10, 10, 0]
        },
        itemStyle: {
          borderRadius: [0, 10, 10, 0],
          color: createGradient(["#F59E0B", "#FBBF24"], true)
        },
        label: {
          show: true,
          position: "right",
          color: "#92400E",
          formatter: ({ value }) => `${Number(value || 0).toFixed(1)}%`
        },
        data: items.map((item) => item.masteryRate).reverse()
      }
    ]
  });
}
function renderKnowledgeRows(items = []) {
  if (!items.length) {
    return '<div class="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">褰撳墠绔犺妭鏆傛棤鍙垎鏋愮殑鐭ヨ瘑鐐规暟鎹€?/div>';
  }
  return items.map((item, index) => `
    <div class="rounded-[1.5rem] border border-white/80 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">${index + 1}</span>
            <p class="text-sm font-semibold text-slate-800">${item.label}</p>
          </div>
          <p class="mt-2 text-xs leading-6 text-slate-500">浣滅瓟 ${item.totalCount} 娆★紝娑夊強 ${item.studentCount} 鍚嶅鐢燂紝澶卞垎 ${item.incorrectCount} 娆?/p>
        </div>
        <span class="text-sm font-semibold text-ocean-deep">${formatPercent(item.masteryRate)}</span>
      </div>
      <div class="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div class="h-full rounded-full bg-gradient-to-r from-ocean-deep via-cyan-500 to-sky-400" style="width:${Math.max(clampPercent(item.masteryRate), 6)}%"></div>
      </div>
    </div>
  `).join("");
}
function renderAbilityRows(items = []) {
  if (!items.length) {
    return '<p class="text-sm text-slate-500">褰撳墠绔犺妭鏆傛棤鑳藉姏缁村害鏁版嵁銆?/p>';
  }
  return items.map((item) => `
    <div class="rounded-[1.4rem] border ${masteryTone(item.level)} px-4 py-4">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-semibold">${item.label}</span>
        <span class="text-sm font-semibold">${formatPercent(item.masteryRate)}</span>
      </div>
      <p class="mt-2 text-xs text-slate-500">鍏?${item.totalCount} 娆″瑙傞浣滅瓟锛屽け鍒?${item.incorrectCount} 娆?/p>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
        <div class="h-full rounded-full" style="width:${Math.max(clampPercent(item.masteryRate), 6)}%; background:${item.level === "strong" ? "linear-gradient(90deg, #0f766e 0%, #34d399 100%)" : item.level === "warning" ? "linear-gradient(90deg, #d97706 0%, #fbbf24 100%)" : "linear-gradient(90deg, #dc2626 0%, #f87171 100%)"}"></div>
      </div>
    </div>
  `).join("");
}
function renderChapterSections(analytics) {
  const focusChapterId = chapterFocusSelect.value;
  const chapters = focusChapterId ? analytics.chapters.filter((item) => item.chapterId === focusChapterId) : analytics.chapters;
  if (!chapters.length) {
    chapterSectionsEl.innerHTML = `
      <article class="chapter-card rounded-[2rem] border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
        褰撳墠绛涢€夋潯浠朵笅娌℃湁鍖归厤鐨勭珷鑺傚垎鏋愮粨鏋溿€?      </article>
    `;
    return;
  }
  chapterSectionsEl.innerHTML = chapters.map((chapter) => {
    const theme = chapterTheme(chapter.level);
    return `
      <article data-chapter-id="${chapter.chapterId}" class="chapter-card rounded-[2.2rem] border border-white/80 bg-white/92 shadow-[0_28px_80px_rgba(15,23,42,0.08)] backdrop-blur">
        <div class="chapter-hero ${theme.hero} px-6 py-6">
          <div class="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div class="max-w-3xl">
              <p class="section-kicker text-white/65">Chapter Insight</p>
              <div class="mt-3 flex flex-wrap items-center gap-3">
                <h4 class="text-[1.9rem] font-bold tracking-tight">${chapter.displayLabel}</h4>
                <span class="rounded-full border px-3 py-1 text-xs font-semibold ${theme.badge}">${masteryLabel(chapter.level)}</span>
              </div>
              <p class="mt-3 text-sm leading-7 text-white/90">
                鏈珷鍏辫鐩?${chapter.questionCount} 涓鐩紝褰㈡垚 ${chapter.objectiveCount} 娆″瑙傞鍒ゆ柇鏁版嵁锛屾潵婧愪簬 ${sourceMixText(chapter)}銆?              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 xl:w-[28rem]">
              <div class="chapter-glass rounded-[1.35rem] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">鍙備笌鐜?/p>
                <p class="mt-3 text-3xl font-bold">${formatPercent(chapter.participationRate)}</p>
              </div>
              <div class="chapter-glass rounded-[1.35rem] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">鐭ヨ瘑鐐规帉鎻＄巼</p>
                <p class="mt-3 text-3xl font-bold">${formatPercent(chapter.masteryRate)}</p>
              </div>
              <div class="chapter-glass rounded-[1.35rem] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">瀹㈣棰樻纭巼</p>
                <p class="mt-3 text-3xl font-bold">${formatPercent(chapter.correctRate)}</p>
              </div>
              <div class="chapter-glass rounded-[1.35rem] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">缁煎悎杈炬垚鐜?/p>
                <p class="mt-3 text-3xl font-bold">${formatPercent(chapter.avgPerformanceRate)}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="grid gap-5 px-6 py-6 xl:grid-cols-[1.02fr_0.98fr]">
          <div class="space-y-5">
            <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div class="rounded-[1.45rem] border ${theme.surface} px-4 py-4">
                <p class="section-kicker">鏈夋晥棰樻</p>
                <p class="mt-3 text-2xl font-bold text-ocean-deep">${chapter.answeredCount}</p>
                <p class="mt-2 text-xs text-slate-500">杩涘叆缁熻鍙ｅ緞鐨勯鐩綔绛旀€婚噺</p>
              </div>
              <div class="rounded-[1.45rem] border ${theme.surface} px-4 py-4">
                <p class="section-kicker">鏌ョ湅绛旀</p>
                <p class="mt-3 text-2xl font-bold text-ocean-deep">${chapter.answerRevealedCount}</p>
                <p class="mt-2 text-xs text-slate-500">鐢ㄤ簬鍒ゆ柇鎻愮ず渚濊禆鎯呭喌</p>
              </div>
              <div class="rounded-[1.45rem] border ${theme.surface} px-4 py-4">
                <p class="section-kicker">鐭ヨ瘑鐐规暟</p>
                <p class="mt-3 text-2xl font-bold text-ocean-deep">${chapter.knowledgeMastery.length}</p>
                <p class="mt-2 text-xs text-slate-500">褰㈡垚绔犺妭鐢诲儚鐨勭煡璇嗙偣鎬绘暟</p>
              </div>
              <div class="rounded-[1.45rem] border ${theme.surface} px-4 py-4">
                <p class="section-kicker">鑳藉姏鏍囩</p>
                <p class="mt-3 text-2xl font-bold text-ocean-deep">${chapter.abilityMastery.length}</p>
                <p class="mt-2 text-xs text-slate-500">鐢ㄤ簬鍒ゆ柇杩佺Щ涓庡簲鐢ㄨ〃鐜?/p>
              </div>
            </section>

            <section class="rounded-[1.8rem] border border-white/80 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="section-kicker">Knowledge Mastery</p>
                  <h5 class="mt-2 text-xl font-bold text-ocean-deep">绔犺妭鐭ヨ瘑鐐规帉鎻″浘</h5>
                  <p class="mt-2 text-sm text-slate-500">鎸夋帉鎻＄巼浠庝綆鍒伴珮灞曠ず鏈珷浼樺厛璁茶瘎鐨勭煡璇嗙偣銆?/p>
                </div>
                <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">Top ${Math.min(chapter.weakKnowledgeTopN.length, 5)}</span>
              </div>
              <div class="mt-4 space-y-3">
                ${renderKnowledgeRows(chapter.weakKnowledgeTopN)}
              </div>
            </section>
          </div>

          <div class="space-y-5">
            <section class="rounded-[1.8rem] border border-white/80 bg-white px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
              <p class="section-kicker">Evaluation</p>
              <h5 class="mt-2 text-xl font-bold text-ocean-deep">绔犺妭璇勪环缁撴灉</h5>
              <p class="mt-4 text-sm leading-8 text-slate-600">${chapter.narrative.evaluation}</p>
            </section>

            <section class="rounded-[1.8rem] border border-white/80 bg-white px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
              <p class="section-kicker">Teaching Suggestions</p>
              <h5 class="mt-2 text-xl font-bold text-ocean-deep">鏁欏寤鸿</h5>
              <div class="mt-4 space-y-3">
                ${chapter.narrative.suggestions.map((item, index) => `
                  <div class="rounded-[1.4rem] bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                    <span class="mr-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ocean-deep text-xs font-bold text-white shadow-[0_10px_20px_rgba(17,93,140,0.18)]">${index + 1}</span>
                    ${item}
                  </div>
                `).join("")}
              </div>
            </section>

            <section class="rounded-[1.8rem] border border-white/80 bg-white px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
              <p class="section-kicker">Ability Signals</p>
              <h5 class="mt-2 text-xl font-bold text-ocean-deep">鑳藉姏缁村害琛ㄧ幇</h5>
              <p class="mt-2 text-sm text-slate-500">浼樺厛鏄剧ず鏈珷鎺屾彙鐜囪緝浣庣殑鑳藉姏鏍囩锛岀敤浜庡垽鏂煡璇嗚縼绉讳笌搴旂敤琛ㄧ幇銆?/p>
              <div class="mt-4 grid gap-3">
                ${renderAbilityRows(chapter.weakAbilityTopN)}
              </div>
            </section>
          </div>
        </div>
      </article>
    `;
  }).join("");
}
function syncChapterFocusOptions(analytics) {
  const selected = chapterFocusSelect.value;
  chapterFocusSelect.innerHTML = ['<option value="">鏄剧ず鍏ㄩ儴绔犺妭</option>'].concat(analytics.chapters.map((item) => `<option value="${item.chapterId}">${item.displayLabel}</option>`)).join("");
  if (selected && analytics.chapters.some((item) => item.chapterId === selected)) {
    chapterFocusSelect.value = selected;
  }
}
function renderAnalytics(analytics) {
  renderOverviewCards(analytics);
  renderOverallSummary(analytics);
  renderChapterPerformanceChart(analytics);
  renderAbilityRadarChart(analytics);
  renderWeakKnowledgeChart(analytics);
  syncChapterFocusOptions(analytics);
  renderChapterSections(analytics);
  generateBroadcastScriptFromState();
}
async function ensureReferenceData() {
  if (state.questionMap.size && state.questionKeyMap.size) {
    return;
  }
  const [questions, questionKeys] = await Promise.all([
    listQuestionItems(),
    listQuestionKeysByPrefix("")
  ]);
  state.questionMap = new Map(questions.map((item) => [item.questionId, item]));
  state.questionKeyMap = new Map(questionKeys.map((item) => [item.questionId, item]));
}
function normalizeSelectedClassId() {
  return String(classSelect.value || "").trim().toUpperCase();
}
async function loadAssignmentAttempts(classId) {
  const assignments = await listAssignmentsForProfile(state.profile);
  const relevantAssignments = assignments.filter((item) => (item.targetClassIds || []).includes(classId));
  const bundles = await Promise.all(relevantAssignments.map(async (assignment) => {
    const attempts = await listAssignmentAttempts({ assignmentId: assignment.assignmentId, classId });
    const submitted = attempts.filter((item) => ["submitted", "graded", "returned"].includes(item.status));
    return Promise.all(submitted.map(async (attempt) => ({
      ...attempt,
      answers: await listAttemptAnswers(attempt.attemptId),
      totalPossibleScore: Number(assignment.totalScore || 0),
      sourceTitle: assignment.title || ""
    })));
  }));
  return bundles.flat();
}
async function loadPracticeAttempts(classId) {
  const attempts = await listPracticeAttempts({ classId });
  return Promise.all(attempts.map(async (attempt) => ({
    ...attempt,
    answers: await listPracticeAnswers(attempt.attemptId)
  })));
}
async function refreshAnalytics() {
  const classId = normalizeSelectedClassId();
  if (!classId) {
    state.analytics = null;
    state.broadcast.script = null;
    renderBroadcastOutline(null);
    resetBroadcastDisplay();
    renderPageEmpty("?????????");
    setToneMessage(messageEl, "???????????");
    return;
  }
  try {
    setToneMessage(messageEl, "??????????????????");
    await ensureReferenceData();
    const [classStudents, assignmentAttempts, practiceAttempts] = await Promise.all([
      listUsersByFilters({
        profile: state.profile,
        classId,
        roles: ["student"]
      }),
      sourceSelect.value === "practice" ? Promise.resolve([]) : loadAssignmentAttempts(classId),
      sourceSelect.value === "assignment" ? Promise.resolve([]) : loadPracticeAttempts(classId)
    ]);
    state.analytics = buildChapterLearningAnalytics({
      assignmentAttempts,
      practiceAttempts,
      questionMap: state.questionMap,
      questionKeyMap: state.questionKeyMap,
      classStudents,
      source: sourceSelect.value
    });
    renderAnalytics(state.analytics);
    setToneMessage(messageEl, `??????? ${state.analytics.totalStudents} ?????? ${state.analytics.chapterCount} ??????`, "success");
  } catch (error) {
    console.error("Failed to load learning analytics:", error);
    state.analytics = null;
    state.broadcast.script = null;
    renderBroadcastOutline(null);
    resetBroadcastDisplay();
    renderPageEmpty("????????????????????");
    setToneMessage(messageEl, error?.message || "?????????", "error");
  }
}
function populateClassSelect() {
  classSelect.innerHTML = ['<option value="">?????</option>'].concat(state.classes.map((item) => `<option value="${item.classId}">${item.classId} 路 ${item.name || item.classId}</option>`)).join("");
  if (!classSelect.value && state.classes[0]?.classId) {
    classSelect.value = state.classes[0].classId;
  }
}
async function refreshClasses() {
  state.classes = await listCourseClasses(state.profile);
  populateClassSelect();
}
function renderHeader(user, profile) {
  const classLabel = profile?.role === "admin" ? "?????????????????" : `???????${(profile?.assignedClassIds || []).join("?") || "?????"}`;
  headerSummaryEl.textContent = `${profile?.name || user?.email || ""} ??????????????${classLabel}`;
}
function bindEvents() {
  filterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    stopBroadcastPlayback();
    await refreshAnalytics();
  });
  chapterFocusSelect.addEventListener("change", () => {
    if (state.analytics) {
      renderChapterSections(state.analytics);
    }
  });
  generateBroadcastBtn.addEventListener("click", () => {
    generateBroadcastScriptFromState();
    setToneMessage(messageEl, "???????????????", "success");
  });
  startBroadcastBtn.addEventListener("click", async () => {
    await startBroadcastPlayback();
  });
  pauseBroadcastBtn.addEventListener("click", () => {
    toggleBroadcastPause();
  });
  stopBroadcastBtn.addEventListener("click", () => {
    stopBroadcastPlayback();
    resetBroadcastDisplay();
  });
  signoutBtn.addEventListener("click", async () => {
    stopBroadcastPlayback();
    await signOut(auth);
    window.location.href = "login.html";
  });
  if (state.broadcast.supported) {
    window.speechSynthesis.addEventListener?.("voiceschanged", chooseBroadcastVoice);
    chooseBroadcastVoice();
  }
  window.addEventListener("resize", resizeCharts);
}
function guardTeacherAccess(profile) {
  if (!profile || !["teacher", "admin"].includes(profile.role)) {
    window.location.href = "login.html";
    return false;
  }
  return true;
}
async function bootstrap() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    try {
      const { profile } = await getUserContext({ ensureProfile: true });
      if (!guardTeacherAccess(profile)) {
        return;
      }
      state.profile = profile;
      renderHeader(user, profile);
      await refreshClasses();
      await refreshAnalytics();
      initLive2DBroadcastAvatar().catch((error) => {
        console.error("Live2D avatar init failed after analytics ready:", error);
      });
    } catch (error) {
      console.error("Teacher analytics bootstrap failed:", error);
      setToneMessage(messageEl, error?.message || "????????????", "error");
      renderPageEmpty("????????????");
    }
  });
}
bindEvents();
renderPageEmpty("???????????????");
renderBroadcastOutline(null);
resetBroadcastDisplay();
bootstrap();
