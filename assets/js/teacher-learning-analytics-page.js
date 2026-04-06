import {
  auth,
  getUserContext,
  onAuthStateChanged,
  signOut,
} from './firebase-core.js';
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
  listUsersByFilters,
} from './course-data.js';
import { live2DBroadcastConfig } from './live2d-broadcast-config.js?v=20260405-haru';

const headerSummaryEl = document.getElementById('analytics-header-summary');
const classSelect = document.getElementById('analytics-class-select');
const sourceSelect = document.getElementById('analytics-source-select');
const chapterFocusSelect = document.getElementById('analytics-chapter-focus-select');
const filterForm = document.getElementById('learning-analytics-filter-form');
const messageEl = document.getElementById('learning-analytics-message');
const overviewCardsEl = document.getElementById('learning-overview-cards');
const overallSummaryEl = document.getElementById('analytics-overall-summary');
const chapterSectionsEl = document.getElementById('chapter-analysis-sections');
const signoutBtn = document.getElementById('analytics-signout-btn');
const generateBroadcastBtn = document.getElementById('generate-broadcast-script-btn');
const startBroadcastBtn = document.getElementById('start-broadcast-btn');
const pauseBroadcastBtn = document.getElementById('pause-broadcast-btn');
const stopBroadcastBtn = document.getElementById('stop-broadcast-btn');
const broadcastStatusChip = document.getElementById('broadcast-status-chip');
const broadcastCurrentTitleEl = document.getElementById('broadcast-current-title');
const broadcastSubtitleEl = document.getElementById('broadcast-subtitle');
const broadcastMetaEl = document.getElementById('broadcast-meta');
const broadcastSegmentCountEl = document.getElementById('broadcast-segment-count');
const broadcastScriptOutlineEl = document.getElementById('broadcast-script-outline');
const broadcastStageEl = document.getElementById('broadcast-stage');
const broadcastOverlayTitleEl = document.getElementById('broadcast-overlay-title');
const overlayPauseBroadcastBtn = document.getElementById('overlay-pause-broadcast-btn');
const overlayStopBroadcastBtn = document.getElementById('overlay-stop-broadcast-btn');
const broadcastAvatarShellEl = document.getElementById('broadcast-avatar-shell');
const broadcastAvatarFrameEl = document.getElementById('broadcast-avatar-frame');
const broadcastAudioBarsEl = document.getElementById('broadcast-audio-bars');
const broadcastAvatarHintEl = document.getElementById('broadcast-avatar-hint');
const live2dAvatarStageEl = document.getElementById('live2d-avatar-stage');

const chartRoots = {
  chapterPerformance: document.getElementById('chapter-performance-chart'),
  abilityRadar: document.getElementById('ability-radar-chart'),
  weakKnowledge: document.getElementById('weak-knowledge-chart'),
};

const state = {
  profile: null,
  classes: [],
  questionMap: new Map(),
  questionKeyMap: new Map(),
  analytics: null,
  chartInstances: new Map(),
  broadcast: {
    script: null,
    activeSegmentId: '',
    isPlaying: false,
    isPaused: false,
    supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
    voices: [],
    selectedVoice: null,
    avatarMode: 'fallback',
    live2dReady: false,
    live2dSprite: null,
    live2dApp: null,
    utterance: null,
    mouthAnimationFrame: 0,
    mouthPulseUntil: 0,
    mouthValue: 0,
  },
};

let live2DCoreReadyPromise = null;

function setToneMessage(target, message, tone = 'info') {
  if (!target) return;
  target.textContent = message || '';
  target.classList.remove('text-red-600', 'text-emerald-600', 'text-slate-600');
  if (!message) {
    target.classList.add('text-slate-600');
    return;
  }
  if (tone === 'error') target.classList.add('text-red-600');
  else if (tone === 'success') target.classList.add('text-emerald-600');
  else target.classList.add('text-slate-600');
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

function clampUnit(value) {
  return Math.max(0, Math.min(Number(value || 0), 1));
}

function masteryTone(level) {
  if (level === 'strong') {
    return 'status-pill status-pill-strong';
  }
  if (level === 'warning') {
    return 'status-pill status-pill-warning';
  }
  return 'status-pill status-pill-weak';
}

function masteryLabel(level) {
  if (level === 'strong') return '掌握稳定';
  if (level === 'warning') return '需要巩固';
  return '重点补强';
}

function chapterTheme(level) {
  if (level === 'strong') {
    return {
      hero: 'theme-strong',
      badge: 'border-white/20 bg-white/15 text-white',
      surface: 'chapter-surface-card chapter-surface-strong',
      progress: 'linear-gradient(90deg, #0f766e 0%, #34d399 100%)',
    };
  }
  if (level === 'warning') {
    return {
      hero: 'theme-warning',
      badge: 'border-white/20 bg-white/15 text-white',
      surface: 'chapter-surface-card chapter-surface-warning',
      progress: 'linear-gradient(90deg, #d97706 0%, #fbbf24 100%)',
    };
  }
  return {
    hero: 'theme-weak',
    badge: 'border-white/20 bg-white/15 text-white',
    surface: 'chapter-surface-card chapter-surface-weak',
    progress: 'linear-gradient(90deg, #dc2626 0%, #f87171 100%)',
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
      color,
    })),
  );
}

function sourceMixText(chapter) {
  const segments = [];
  if (Number(chapter?.sourceBreakdown?.assignmentAttempts || 0) > 0) {
    segments.push(`作业 ${chapter.sourceBreakdown.assignmentAttempts}`);
  }
  if (Number(chapter?.sourceBreakdown?.practiceAttempts || 0) > 0) {
    segments.push(`综合练习 ${chapter.sourceBreakdown.practiceAttempts}`);
  }
  return segments.length ? segments.join(' / ') : '暂无来源样本';
}

function broadcastSourceLabel(value) {
  if (value === 'assignment') return '正式作业';
  if (value === 'practice') return '综合练习';
  return '作业 + 综合练习';
}

function updateBroadcastStatusChip(label, tone = 'idle') {
  if (!broadcastStatusChip) return;
  broadcastStatusChip.textContent = label;
  broadcastStatusChip.className = 'rounded-full border px-3 py-1 text-xs font-semibold';
  if (tone === 'playing') {
    broadcastStatusChip.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-700');
  } else if (tone === 'paused') {
    broadcastStatusChip.classList.add('border-amber-200', 'bg-amber-50', 'text-amber-700');
  } else if (tone === 'error') {
    broadcastStatusChip.classList.add('border-rose-200', 'bg-rose-50', 'text-rose-700');
  } else {
    broadcastStatusChip.classList.add('border-slate-200', 'bg-slate-100', 'text-slate-600');
  }
}

function clearBroadcastFocus() {
  chapterSectionsEl
    .querySelectorAll('.chapter-card.is-broadcast-focus')
    .forEach((node) => node.classList.remove('is-broadcast-focus'));
}

function focusBroadcastChapter(chapterId) {
  clearBroadcastFocus();
  if (!chapterId) return;
  const card = chapterSectionsEl.querySelector(`.chapter-card[data-chapter-id="${chapterId}"]`);
  if (!card) return;
  card.classList.add('is-broadcast-focus');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setAvatarSpeaking(isSpeaking) {
  broadcastAvatarFrameEl?.classList.toggle('is-speaking', isSpeaking);
  broadcastAudioBarsEl?.classList.toggle('is-speaking', isSpeaking);
  const sprite = state.broadcast.live2dSprite;
  if (!sprite || !state.broadcast.live2dReady) {
    return;
  }
  try {
    sprite.startMotion?.({
      group: isSpeaking
        ? live2DBroadcastConfig.introMotionGroup || 'Tap'
        : live2DBroadcastConfig.idleMotionGroup || 'Idle',
      no: 0,
      priority: isSpeaking ? 2 : 1,
    });
  } catch (error) {
    console.warn('Live2D motion switch failed:', error);
  }
}

function setBroadcastSpotlight(isActive) {
  broadcastStageEl?.classList.toggle('is-broadcast-takeover', isActive);
  broadcastAvatarShellEl?.classList.toggle('is-broadcast-spotlight', isActive);
  broadcastAvatarFrameEl?.classList.toggle('is-broadcast-spotlight', isActive);
}

function ensureLive2DCoreLoaded() {
  if (window.Live2DCubismCore) {
    return Promise.resolve(window.Live2DCubismCore);
  }
  if (live2DCoreReadyPromise) {
    return live2DCoreReadyPromise;
  }
  live2DCoreReadyPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[data-live2d-core="1"]`);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.Live2DCubismCore), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Live2D Core 加载失败')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = live2DBroadcastConfig.coreScript;
    script.async = true;
    script.dataset.live2dCore = '1';
    script.onload = () => {
      if (window.Live2DCubismCore) {
        resolve(window.Live2DCubismCore);
      } else {
        reject(new Error('Live2D Core 已加载，但全局对象不可用'));
      }
    };
    script.onerror = () => reject(new Error('Live2D Core 脚本请求失败'));
    document.head.appendChild(script);
  });
  return live2DCoreReadyPromise;
}

function resolveLive2DCoreModel(sprite) {
  const candidates = [
    sprite?._model?._model,
    sprite?._model,
    sprite?.model?._model,
    sprite?.model,
    sprite?.internalModel?.coreModel,
    sprite?.coreModel,
  ];
  return candidates.find((candidate) => candidate
    && typeof candidate.setParameterValueById === 'function');
}

function setLive2DMouthValue(value) {
  const coreModel = resolveLive2DCoreModel(state.broadcast.live2dSprite);
  if (!coreModel) {
    return;
  }
  const mouthValue = clampUnit(value);
  state.broadcast.mouthValue = mouthValue;
  try {
    coreModel.setParameterValueById('ParamMouthOpenY', mouthValue, 1);
    if (typeof coreModel.setParameterValueById === 'function') {
      coreModel.setParameterValueById('ParamMouthForm', mouthValue * 0.25, 1);
    }
  } catch (error) {
    // Ignore parameter writes on models that do not expose these parameters.
  }
}

function pulseBroadcastMouth(boost = 1) {
  state.broadcast.mouthPulseUntil = performance.now() + (live2DBroadcastConfig.speech?.mouthPulseMs || 150) * boost;
}

function stopMouthAnimation() {
  if (state.broadcast.mouthAnimationFrame) {
    cancelAnimationFrame(state.broadcast.mouthAnimationFrame);
    state.broadcast.mouthAnimationFrame = 0;
  }
  state.broadcast.mouthPulseUntil = 0;
  setLive2DMouthValue(0);
}

function startMouthAnimation() {
  stopMouthAnimation();
  const speechConfig = live2DBroadcastConfig.speech || {};
  const loop = (timestamp) => {
    if (!state.broadcast.isPlaying || state.broadcast.isPaused) {
      setLive2DMouthValue(0);
      state.broadcast.mouthAnimationFrame = requestAnimationFrame(loop);
      return;
    }
    const waveA = (Math.sin(timestamp / 75) + 1) / 2;
    const waveB = (Math.sin(timestamp / 41 + 1.6) + 1) / 2;
    const pulseRatio = timestamp < state.broadcast.mouthPulseUntil
      ? (state.broadcast.mouthPulseUntil - timestamp) / (speechConfig.mouthPulseMs || 150)
      : 0;
    const mouthValue = (speechConfig.mouthBase || 0.08)
      + (((waveA * 0.58) + (waveB * 0.42)) / 1.8) * (speechConfig.mouthAmplitude || 0.48)
      + pulseRatio * (speechConfig.mouthPulseBoost || 0.34);
    setLive2DMouthValue(mouthValue);
    state.broadcast.mouthAnimationFrame = requestAnimationFrame(loop);
  };
  state.broadcast.mouthAnimationFrame = requestAnimationFrame(loop);
}

function renderBroadcastOutline(script) {
  const segments = script?.segments || [];
  broadcastSegmentCountEl.textContent = `${segments.length} 段`;
  if (!segments.length) {
  broadcastScriptOutlineEl.innerHTML = `
      <div class="outline-card rounded-[1.4rem] border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
        当前还没有生成播报稿。
      </div>
    `;
    return;
  }
  broadcastScriptOutlineEl.innerHTML = segments.map((segment, index) => `
    <article
      data-broadcast-segment-id="${segment.id}"
      class="outline-card rounded-[1.35rem] px-4 py-4 transition"
    >
      <div class="flex items-start gap-3">
        <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-500 shadow-sm">${index + 1}</span>
        <div>
          <p class="text-sm font-semibold text-slate-800">${segment.title}</p>
          <p class="mt-2 text-sm leading-7 text-slate-500">${segment.text}</p>
        </div>
      </div>
    </article>
  `).join('');
}

function highlightBroadcastSegment(segmentId) {
  broadcastScriptOutlineEl
    ?.querySelectorAll('[data-broadcast-segment-id]')
    .forEach((node) => {
      const active = node.dataset.broadcastSegmentId === segmentId;
      node.classList.toggle('border-ocean-mid', active);
      node.classList.toggle('bg-sky-50', active);
      node.classList.toggle('shadow-[0_16px_30px_rgba(17,93,140,0.08)]', active);
      if (active) {
        node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
}

function updateBroadcastButtons() {
  const hasScript = Boolean(state.broadcast.script?.segments?.length);
  startBroadcastBtn.disabled = !hasScript;
  pauseBroadcastBtn.disabled = !state.broadcast.isPlaying;
  stopBroadcastBtn.disabled = !state.broadcast.isPlaying && !state.broadcast.isPaused;
  generateBroadcastBtn.disabled = !state.analytics;

  if (overlayPauseBroadcastBtn) {
    overlayPauseBroadcastBtn.disabled = !state.broadcast.isPlaying;
    overlayPauseBroadcastBtn.classList.toggle('opacity-50', overlayPauseBroadcastBtn.disabled);
    overlayPauseBroadcastBtn.classList.toggle('cursor-not-allowed', overlayPauseBroadcastBtn.disabled);
    overlayPauseBroadcastBtn.textContent = state.broadcast.isPaused ? '继续' : '暂停';
  }
  if (overlayStopBroadcastBtn) {
    overlayStopBroadcastBtn.disabled = !state.broadcast.isPlaying && !state.broadcast.isPaused;
    overlayStopBroadcastBtn.classList.toggle('opacity-50', overlayStopBroadcastBtn.disabled);
    overlayStopBroadcastBtn.classList.toggle('cursor-not-allowed', overlayStopBroadcastBtn.disabled);
  }

  [startBroadcastBtn, pauseBroadcastBtn, stopBroadcastBtn, generateBroadcastBtn].forEach((button) => {
    if (!button) return;
    button.classList.toggle('opacity-50', button.disabled);
    button.classList.toggle('cursor-not-allowed', button.disabled);
  });
  pauseBroadcastBtn.textContent = state.broadcast.isPaused ? '继续' : '暂停';
}

function resetBroadcastDisplay() {
  state.broadcast.activeSegmentId = '';
  broadcastCurrentTitleEl.textContent = '等待播报';
  broadcastSubtitleEl.textContent = '点击“生成播报稿”后，系统会输出整体结论和各章节播报内容。';
  if (broadcastOverlayTitleEl) {
    broadcastOverlayTitleEl.textContent = '当前数字人将接管中段展示区域，播报时可直接暂停或停止。';
  }
  highlightBroadcastSegment('');
  clearBroadcastFocus();
  setBroadcastSpotlight(false);
  setAvatarSpeaking(false);
  updateBroadcastStatusChip(state.broadcast.script ? '待播报' : '待生成');
  updateBroadcastButtons();
}

function buildClassLabel() {
  const currentOption = classSelect?.selectedOptions?.[0];
  return currentOption?.textContent?.trim() || normalizeSelectedClassId() || '当前班级';
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
    sourceLabel: broadcastSourceLabel(sourceSelect.value),
  });
  renderBroadcastOutline(state.broadcast.script);
  broadcastCurrentTitleEl.textContent = state.broadcast.script.title;
  broadcastSubtitleEl.textContent = state.broadcast.script.segments[0]?.text || '当前暂无可播报内容。';
  broadcastMetaEl.textContent = state.broadcast.supported
    ? `当前已生成播报稿，共 ${state.broadcast.script.segments.length} 段内容。将优先使用中文音色：${getSelectedVoiceLabel()}。`
    : '当前浏览器不支持语音合成，将保留播报稿文本预览。';
  updateBroadcastStatusChip('待播报');
  updateBroadcastButtons();
}

function updateBroadcastSegment(segment) {
  state.broadcast.activeSegmentId = segment?.id || '';
  broadcastCurrentTitleEl.textContent = segment?.title || '等待播报';
  broadcastSubtitleEl.textContent = segment?.text || '当前段落暂无文本。';
  if (broadcastOverlayTitleEl) {
    broadcastOverlayTitleEl.textContent = segment?.title
      ? `当前播报：${segment.title}`
      : '当前数字人将接管中段展示区域，播报时可直接暂停或停止。';
  }
  highlightBroadcastSegment(segment?.id || '');
  focusBroadcastChapter(segment?.chapterId || '');
}

function stopBroadcastPlayback() {
  if (state.broadcast.supported) {
    window.speechSynthesis.cancel();
  }
  state.broadcast.utterance = null;
  state.broadcast.isPlaying = false;
  state.broadcast.isPaused = false;
  setBroadcastSpotlight(false);
  setAvatarSpeaking(false);
  stopMouthAnimation();
  updateBroadcastStatusChip(state.broadcast.script ? '待播报' : '待生成');
  updateBroadcastButtons();
}

function chooseBroadcastVoice() {
  if (!state.broadcast.supported) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  state.broadcast.voices = voices;
  const scoreVoice = (voice) => {
    if (!voice) return -1;
    let score = 0;
    const name = `${voice.name || ''} ${(voice.voiceURI || '')}`.toLowerCase();
    const lang = (voice.lang || '').toLowerCase();
    if (/zh(-|_)?cn/.test(lang)) score += 60;
    else if (lang.startsWith('zh')) score += 45;
    if (/xiaoxiao|xiaoyi|yunxi|yunyang|xiaomo|xiaorui|zhiyu|xiaoshuang/.test(name)) score += 28;
    if (/microsoft|edge/.test(name)) score += 18;
    if (/female|girl|xiaoxiao|xiaoyi|xiaomo|xiaorui|zhiyu|xiaoshuang/.test(name)) score += 8;
    if (voice.localService) score += 6;
    if (/natural/.test(name)) score += 6;
    return score;
  };
  state.broadcast.selectedVoice = [...voices].sort((left, right) => scoreVoice(right) - scoreVoice(left))[0] || null;
  return state.broadcast.selectedVoice;
}

function getSelectedVoiceLabel() {
  const voice = state.broadcast.selectedVoice || chooseBroadcastVoice();
  if (!voice) {
    return '默认中文音色';
  }
  return (voice.name || voice.voiceURI || '默认中文音色').replace(/^Microsoft\s*/i, '').trim();
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function splitBroadcastClauses(text = '') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }
  const chunks = normalized.match(/[^，。！？；：,.!?;:]+[，。！？；：,.!?;:]*/g) || [normalized];
  return chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({
      text: chunk,
      isSentenceEnd: /[。！？.!?]$/.test(chunk),
    }));
}

function buildUtterance(text, voice) {
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || 'zh-CN';
  } else {
    utterance.lang = 'zh-CN';
  }
  utterance.rate = live2DBroadcastConfig.speech?.rate || 0.9;
  utterance.pitch = live2DBroadcastConfig.speech?.pitch || 0.92;
  utterance.volume = live2DBroadcastConfig.speech?.volume || 1;
  return utterance;
}

async function playBroadcastSegments(segments, index = 0) {
  if (!state.broadcast.supported || !segments.length || index >= segments.length) {
    stopBroadcastPlayback();
    resetBroadcastDisplay();
    return;
  }

  const voice = chooseBroadcastVoice();
  const segment = segments[index];
  const clauses = splitBroadcastClauses(segment.text);
  let clauseIndex = 0;

  const speakNextClause = async () => {
    if (!state.broadcast.isPlaying && clauseIndex > 0) {
      return;
    }
    const clause = clauses[clauseIndex];
    if (!clause) {
      setAvatarSpeaking(false);
      stopMouthAnimation();
      if (index + 1 < segments.length) {
        playBroadcastSegments(segments, index + 1);
        return;
      }
      stopBroadcastPlayback();
      updateBroadcastStatusChip('播报完成', 'idle');
      broadcastCurrentTitleEl.textContent = '播报完成';
      broadcastSubtitleEl.textContent = segment.text;
      return;
    }

    const utterance = buildUtterance(clause.text, voice);
    state.broadcast.utterance = utterance;

    utterance.onstart = () => {
      state.broadcast.isPlaying = true;
      state.broadcast.isPaused = false;
      setAvatarSpeaking(true);
      pulseBroadcastMouth(clause.isSentenceEnd ? 1.35 : 1.15);
      startMouthAnimation();
      updateBroadcastStatusChip('播报中', 'playing');
      updateBroadcastSegment(segment);
      broadcastMetaEl.textContent = `当前播报音色：${getSelectedVoiceLabel()}。系统已启用节奏型嘴型驱动。`;
      updateBroadcastButtons();
    };
    utterance.onboundary = (event) => {
      if (event.name === 'word' || event.name === 'sentence' || typeof event.charIndex === 'number') {
        pulseBroadcastMouth(clause.isSentenceEnd ? 1.28 : 1.05);
      }
    };
    utterance.onend = async () => {
      if (!state.broadcast.isPlaying) {
        return;
      }
      clauseIndex += 1;
      setAvatarSpeaking(false);
      pulseBroadcastMouth(0.72);
      await wait(clause.isSentenceEnd
        ? (live2DBroadcastConfig.speech?.sentencePauseMs || 190)
        : (live2DBroadcastConfig.speech?.clausePauseMs || 110));
      if (!state.broadcast.isPlaying) {
        return;
      }
      speakNextClause();
    };
    utterance.onerror = () => {
      stopBroadcastPlayback();
      updateBroadcastStatusChip('播报失败', 'error');
      setToneMessage(messageEl, '当前浏览器语音播报失败，请检查系统语音设置。', 'error');
    };
    window.speechSynthesis.speak(utterance);
  };

  speakNextClause();
}

async function startBroadcastPlayback() {
  const segments = state.broadcast.script?.segments || [];
  if (!segments.length) {
    generateBroadcastScriptFromState();
  }
  if (!state.broadcast.supported) {
    updateBroadcastStatusChip('不可播报', 'error');
    setToneMessage(messageEl, '当前浏览器不支持语音播报，请查看右侧播报稿预览。', 'error');
    return;
  }
  setBroadcastSpotlight(true);
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
    setBroadcastSpotlight(true);
    setAvatarSpeaking(true);
    pulseBroadcastMouth(1.2);
    startMouthAnimation();
    updateBroadcastStatusChip('播报中', 'playing');
  } else {
    window.speechSynthesis.pause();
    state.broadcast.isPaused = true;
    setBroadcastSpotlight(true);
    setAvatarSpeaking(false);
    stopMouthAnimation();
    updateBroadcastStatusChip('已暂停', 'paused');
  }
  updateBroadcastButtons();
}

async function initLive2DBroadcastAvatar() {
  if (!live2DBroadcastConfig?.enabled || !live2DBroadcastConfig?.modelJsonPath || !live2dAvatarStageEl) {
    broadcastAvatarHintEl.textContent = '当前未启用 Live2D 资源，将继续使用静态数字人形象。';
    return;
  }

  try {
    await ensureLive2DCoreLoaded();
    const easyLive2D = await import(live2DBroadcastConfig.bundlePath);
    const { Application, Ticker, Config, Live2DSprite, Priority } = easyLive2D;
    if (!Application || !Live2DSprite) {
      throw new Error('easy-live2d bundle 加载失败');
    }

    Config.MotionGroupIdle = live2DBroadcastConfig.idleMotionGroup || 'Idle';
    Config.MouseFollow = false;

    const canvas = document.createElement('canvas');
    canvas.className = 'h-full w-full';
    live2dAvatarStageEl.innerHTML = '';
    live2dAvatarStageEl.appendChild(canvas);

    const app = new Application();
    await app.init({
      view: canvas,
      backgroundAlpha: 0,
      autoDensity: true,
      width: live2dAvatarStageEl.clientWidth || 360,
      height: live2dAvatarStageEl.clientHeight || 450,
      resolution: Math.max(window.devicePixelRatio || 1, 1),
    });

    const sprite = new Live2DSprite();
    await sprite.init({
      modelPath: live2DBroadcastConfig.modelJsonPath,
      ticker: Ticker.shared,
    });
    app.stage.addChild(sprite);
    state.broadcast.live2dReady = true;
    state.broadcast.live2dSprite = sprite;
    state.broadcast.live2dApp = app;
    broadcastAvatarFrameEl?.classList.add('has-live2d');
    document.getElementById('broadcast-avatar-fallback')?.classList.add('hidden');
    layoutLive2DAvatar();
    broadcastAvatarHintEl.textContent = '当前已挂载 easy-live2d Haru 模型，播报时会尝试切换待机动作。';
    window.setTimeout(() => {
      try {
        sprite.startMotion?.({
          group: live2DBroadcastConfig.idleMotionGroup || 'Idle',
          no: 0,
          priority: Priority?.Normal ?? 1,
        });
      } catch (error) {
        console.warn('Initial Live2D idle motion failed:', error);
      }
    }, 420);

    sprite.onLive2D?.('ready', async () => {
      state.broadcast.live2dReady = true;
      state.broadcast.live2dSprite = sprite;
      state.broadcast.live2dApp = app;
      broadcastAvatarFrameEl?.classList.add('has-live2d');
      document.getElementById('broadcast-avatar-fallback')?.classList.add('hidden');
      layoutLive2DAvatar();
      broadcastAvatarHintEl.textContent = '当前已挂载 easy-live2d Haru 模型，播报时会尝试切换待机动作。';
      try {
        await sprite.startMotion({
          group: live2DBroadcastConfig.idleMotionGroup || 'Idle',
          no: 0,
          priority: Priority?.Normal ?? 1,
        });
      } catch (error) {
        // Ignore idle motion failures and keep the model visible.
      }
    });

    state.broadcast.avatarMode = 'live2d';
  } catch (error) {
    console.error('Live2D avatar init failed:', error);
    broadcastAvatarFrameEl?.classList.remove('has-live2d');
    broadcastAvatarHintEl.textContent = 'Live2D 初始化失败，已回退到静态数字人形象。';
  }
}

function layoutLive2DAvatar() {
  if (!state.broadcast.live2dApp?.renderer || !live2dAvatarStageEl || !state.broadcast.live2dSprite) {
    return;
  }
  const width = live2dAvatarStageEl.clientWidth || 360;
  const height = live2dAvatarStageEl.clientHeight || 450;
  const scale = live2DBroadcastConfig.scale || 0.34;
  const spriteWidth = width * scale * 2.55;
  const spriteHeight = height * scale * 2.55;

  state.broadcast.live2dApp.renderer.resize(width, height);
  state.broadcast.live2dSprite.width = spriteWidth;
  state.broadcast.live2dSprite.height = spriteHeight;
  state.broadcast.live2dSprite.x = (width - spriteWidth) / 2;
  state.broadcast.live2dSprite.y = Math.max((height - spriteHeight) / 2, height - spriteHeight * 0.96);
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
  layoutLive2DAvatar();
}

function renderChartPlaceholder(target, message) {
  if (!target) return;
  target.innerHTML = `
    <div class="surface-card-soft flex h-full items-center justify-center rounded-[1.75rem] border-dashed border-slate-300 px-6 text-center text-sm leading-7 text-slate-500">
      <div class="max-w-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Analytics Pending</p>
        <p class="mt-3">${message}</p>
      </div>
    </div>
  `;
}

function renderPageEmpty(message = '当前筛选条件下还没有形成可分析的数据。') {
  overviewCardsEl.innerHTML = `
    <article class="metric-card rounded-[1.9rem] border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-4">
      <p class="section-kicker">Overview</p>
      <p class="mt-3">${message}</p>
    </article>
  `;
  overallSummaryEl.innerHTML = `
    <div class="surface-card-soft rounded-[1.5rem] px-5 py-5 text-sm leading-7 text-slate-500">
      <p>${message}</p>
    </div>
  `;
  chapterSectionsEl.innerHTML = `
    <article class="chapter-card rounded-[2rem] border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
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
      label: '参与率',
      value: formatPercent(analytics.participationRate),
      note: `${analytics.activeStudentCount}/${analytics.totalStudents} 名学生有有效作答数据`,
      progress: analytics.participationRate,
      accent: '参',
      meta: `有效覆盖 ${formatMetricNumber(analytics.activeStudentCount)} 人`,
    },
    {
      label: '综合达成率',
      value: formatPercent(analytics.avgPerformanceRate),
      note: '综合作业得分与练习客观题达成情况',
      progress: analytics.avgPerformanceRate,
      accent: '达',
      meta: `形成 ${formatMetricNumber(analytics.totalAnsweredCount)} 次有效作答`,
    },
    {
      label: '客观题正确率',
      value: formatPercent(analytics.correctRate),
      note: `共统计 ${analytics.objectiveCount} 次客观题作答`,
      progress: analytics.correctRate,
      accent: '准',
      meta: `已纳入 ${formatMetricNumber(analytics.objectiveCount)} 次判断`,
    },
    {
      label: '知识点平均掌握率',
      value: formatPercent(analytics.masteryRate),
      note: `覆盖 ${analytics.chapterCount} 个章节`,
      progress: analytics.masteryRate,
      accent: '知',
      meta: `章节画像 ${formatMetricNumber(analytics.chapterCount)} 个`,
    },
  ];

  overviewCardsEl.innerHTML = cards.map((item) => `
    <article class="metric-card rounded-[1.9rem] px-5 py-5">
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
          <span>当前班级表现</span>
          <span>${item.meta}</span>
        </div>
      </div>
    </article>
  `).join('');
}

function renderOverallSummary(analytics) {
  const weakestChapters = analytics.chapters.slice(0, 3).map((item) => item.displayLabel);
  const weakestKnowledge = analytics.overallWeakKnowledgeTopN.slice(0, 3).map((item) => item.label);

  overallSummaryEl.innerHTML = `
    <div class="space-y-4">
      <div class="surface-card-accent rounded-[1.6rem] px-5 py-5">
        <p class="section-kicker text-white/60">Overall Reading</p>
        <p class="mt-3 text-sm leading-8 text-white/90">${analytics.overallNarrative}</p>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="surface-card-soft rounded-[1.45rem] px-4 py-4">
          <p class="section-kicker">重点章节</p>
          <p class="mt-3 text-sm leading-7 text-slate-600">${weakestChapters.length ? weakestChapters.join('、') : '当前没有需要重点讲评的章节。'}</p>
        </div>
        <div class="surface-card-soft rounded-[1.45rem] px-4 py-4">
          <p class="section-kicker">薄弱知识点</p>
          <p class="mt-3 text-sm leading-7 text-slate-600">${weakestKnowledge.length ? weakestKnowledge.join('、') : '当前没有明显集中的薄弱知识点。'}</p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <span class="status-pill status-pill-strong">稳定章节 ${analytics.masteryBucketSummary.strong}</span>
        <span class="status-pill status-pill-warning">巩固章节 ${analytics.masteryBucketSummary.warning}</span>
        <span class="status-pill status-pill-weak">补强章节 ${analytics.masteryBucketSummary.weak}</span>
      </div>
    </div>
  `;
}

function renderChapterPerformanceChart(analytics) {
  const chart = getChart('chapterPerformance');
  if (!chart || !analytics.chapters.length) {
    renderChartPlaceholder(chartRoots.chapterPerformance, '当前暂无可展示的章节掌握与正确率数据。');
    return;
  }
  chartRoots.chapterPerformance.innerHTML = '';
  chart.setOption({
    animationDuration: 650,
    color: ['#115D8C', '#38BDF8'],
    grid: { left: 48, right: 28, top: 64, bottom: 56 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15,23,42,0.92)',
      borderWidth: 0,
      textStyle: { color: '#fff' },
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(148,163,184,0.08)' } },
    },
    legend: {
      data: ['知识点掌握率', '客观题正确率'],
      top: 12,
      textStyle: { color: '#475569', fontSize: 12 },
      itemWidth: 18,
      itemHeight: 10,
    },
    xAxis: {
      type: 'category',
      data: analytics.chartSeries.chapterLabels,
      axisLine: { lineStyle: { color: '#CBD5E1' } },
      axisTick: { show: false },
      axisLabel: {
        interval: 0,
        rotate: 18,
        color: '#475569',
        fontSize: 12,
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { formatter: '{value}%', color: '#64748B' },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.16)' } },
    },
    series: [
      {
        name: '知识点掌握率',
        type: 'bar',
        barMaxWidth: 34,
        itemStyle: {
          borderRadius: [12, 12, 0, 0],
          color: createGradient(['#0B3A5A', '#115D8C', '#38BDF8']),
        },
        data: analytics.chartSeries.chapterMasteryRates,
      },
      {
        name: '客观题正确率',
        type: 'line',
        smooth: true,
        symbolSize: 10,
        lineStyle: { width: 4, color: '#38BDF8' },
        itemStyle: { color: '#E0F2FE', borderColor: '#0284C7', borderWidth: 3 },
        areaStyle: {
          color: createGradient(['rgba(56,189,248,0.32)', 'rgba(56,189,248,0.02)']),
        },
        data: analytics.chartSeries.chapterCorrectRates,
      },
    ],
  });
}

function renderAbilityRadarChart(analytics) {
  const chart = getChart('abilityRadar');
  const items = [...analytics.overallAbilityMastery]
    .sort((left, right) => right.totalCount - left.totalCount)
    .slice(0, 6);

  if (!chart || !items.length) {
    renderChartPlaceholder(chartRoots.abilityRadar, '当前暂无可展示的能力维度掌握数据。');
    return;
  }
  chartRoots.abilityRadar.innerHTML = '';
  chart.setOption({
    animationDuration: 500,
    tooltip: {},
    radar: {
      radius: '62%',
      indicator: items.map((item) => ({ name: item.label, max: 100 })),
      axisName: { color: '#334155' },
      splitNumber: 4,
      splitArea: {
        areaStyle: {
          color: ['rgba(199,227,255,0.18)', 'rgba(17,93,140,0.04)'],
        },
      },
      splitLine: {
        lineStyle: { color: ['rgba(148,163,184,0.16)'] },
      },
      axisLine: {
        lineStyle: { color: 'rgba(148,163,184,0.2)' },
      },
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: items.map((item) => item.masteryRate),
            name: '班级画像',
            areaStyle: { color: 'rgba(17,93,140,0.2)' },
            lineStyle: { color: '#115D8C', width: 3 },
            itemStyle: { color: '#115D8C' },
          },
        ],
      },
    ],
  });
}

function renderWeakKnowledgeChart(analytics) {
  const chart = getChart('weakKnowledge');
  const items = analytics.overallWeakKnowledgeTopN.slice(0, 10);
  if (!chart || !items.length) {
    renderChartPlaceholder(chartRoots.weakKnowledge, '当前暂无可展示的薄弱知识点数据。');
    return;
  }
  chartRoots.weakKnowledge.innerHTML = '';
  chart.setOption({
    animationDuration: 650,
    color: ['#F59E0B'],
    grid: { left: 168, right: 28, top: 28, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(245,158,11,0.08)' } },
      backgroundColor: 'rgba(15,23,42,0.92)',
      borderWidth: 0,
      textStyle: { color: '#fff' },
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { formatter: '{value}%', color: '#64748B' },
      splitLine: { lineStyle: { color: 'rgba(148,163,184,0.16)' } },
    },
    yAxis: {
      type: 'category',
      data: items.map((item) => item.label).reverse(),
      axisLabel: { color: '#475569', fontSize: 12 },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 18,
        showBackground: true,
        backgroundStyle: {
          color: 'rgba(148,163,184,0.12)',
          borderRadius: [0, 10, 10, 0],
        },
        itemStyle: {
          borderRadius: [0, 10, 10, 0],
          color: createGradient(['#F59E0B', '#FBBF24'], true),
        },
        label: {
          show: true,
          position: 'right',
          color: '#92400E',
          formatter: ({ value }) => `${Number(value || 0).toFixed(1)}%`,
        },
        data: items.map((item) => item.masteryRate).reverse(),
      },
    ],
  });
}

function renderKnowledgeRows(items = []) {
  if (!items.length) {
    return '<div class="surface-card-soft rounded-[1.5rem] border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">当前章节暂无可分析的知识点数据。</div>';
  }
  return items.map((item, index) => `
    <div class="knowledge-row-card rounded-[1.5rem] px-4 py-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">${index + 1}</span>
            <p class="text-sm font-semibold text-slate-800">${item.label}</p>
          </div>
          <p class="mt-2 text-xs leading-6 text-slate-500">作答 ${item.totalCount} 次，涉及 ${item.studentCount} 名学生，失分 ${item.incorrectCount} 次</p>
        </div>
        <span class="text-sm font-semibold text-ocean-deep">${formatPercent(item.masteryRate)}</span>
      </div>
      <div class="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
        <div class="h-full rounded-full bg-gradient-to-r from-ocean-deep via-cyan-500 to-sky-400" style="width:${Math.max(clampPercent(item.masteryRate), 6)}%"></div>
      </div>
    </div>
  `).join('');
}

function renderAbilityRows(items = []) {
  if (!items.length) {
    return '<p class="text-sm text-slate-500">当前章节暂无能力维度数据。</p>';
  }
  return items.map((item) => `
    <div class="surface-card-soft rounded-[1.4rem] px-4 py-4">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-semibold">${item.label}</span>
        <span class="${masteryTone(item.level)}">${formatPercent(item.masteryRate)}</span>
      </div>
      <p class="mt-2 text-xs text-slate-500">共 ${item.totalCount} 次客观题作答，失分 ${item.incorrectCount} 次</p>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-white/70">
        <div class="h-full rounded-full" style="width:${Math.max(clampPercent(item.masteryRate), 6)}%; background:${item.level === 'strong' ? 'linear-gradient(90deg, #0f766e 0%, #34d399 100%)' : item.level === 'warning' ? 'linear-gradient(90deg, #d97706 0%, #fbbf24 100%)' : 'linear-gradient(90deg, #dc2626 0%, #f87171 100%)'}"></div>
      </div>
    </div>
  `).join('');
}

function renderChapterSections(analytics) {
  const focusChapterId = chapterFocusSelect.value;
  const chapters = focusChapterId
    ? analytics.chapters.filter((item) => item.chapterId === focusChapterId)
    : analytics.chapters;

  if (!chapters.length) {
    chapterSectionsEl.innerHTML = `
      <article class="chapter-card rounded-[2rem] border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
        当前筛选条件下没有匹配的章节分析结果。
      </article>
    `;
    return;
  }

  chapterSectionsEl.innerHTML = chapters.map((chapter) => {
    const theme = chapterTheme(chapter.level);
    return `
      <article data-chapter-id="${chapter.chapterId}" class="chapter-card rounded-[2.2rem]">
        <div class="chapter-hero ${theme.hero} px-6 py-6">
          <div class="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div class="max-w-3xl">
              <p class="section-kicker text-white/65">Chapter Insight</p>
              <div class="mt-3 flex flex-wrap items-center gap-3">
                <h4 class="text-[1.9rem] font-bold tracking-tight">${chapter.displayLabel}</h4>
                <span class="rounded-full border px-3 py-1 text-xs font-semibold ${theme.badge}">${masteryLabel(chapter.level)}</span>
              </div>
              <p class="mt-3 text-sm leading-7 text-white/90">
                本章共覆盖 ${chapter.questionCount} 个题目，形成 ${chapter.objectiveCount} 次客观题判断数据，来源于 ${sourceMixText(chapter)}。
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 xl:w-[28rem]">
              <div class="chapter-glass rounded-[1.35rem] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">参与率</p>
                <p class="mt-3 text-3xl font-bold">${formatPercent(chapter.participationRate)}</p>
              </div>
              <div class="chapter-glass rounded-[1.35rem] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">知识点掌握率</p>
                <p class="mt-3 text-3xl font-bold">${formatPercent(chapter.masteryRate)}</p>
              </div>
              <div class="chapter-glass rounded-[1.35rem] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">客观题正确率</p>
                <p class="mt-3 text-3xl font-bold">${formatPercent(chapter.correctRate)}</p>
              </div>
              <div class="chapter-glass rounded-[1.35rem] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">综合达成率</p>
                <p class="mt-3 text-3xl font-bold">${formatPercent(chapter.avgPerformanceRate)}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="grid gap-5 px-6 py-6 xl:grid-cols-[1.02fr_0.98fr]">
          <div class="space-y-5">
            <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div class="${theme.surface} px-4 py-4">
                <p class="section-kicker">有效题次</p>
                <p class="mt-3 text-2xl font-bold text-ocean-deep">${chapter.answeredCount}</p>
                <p class="mt-2 text-xs text-slate-500">进入统计口径的题目作答总量</p>
              </div>
              <div class="${theme.surface} px-4 py-4">
                <p class="section-kicker">查看答案</p>
                <p class="mt-3 text-2xl font-bold text-ocean-deep">${chapter.answerRevealedCount}</p>
                <p class="mt-2 text-xs text-slate-500">用于判断提示依赖情况</p>
              </div>
              <div class="${theme.surface} px-4 py-4">
                <p class="section-kicker">知识点数</p>
                <p class="mt-3 text-2xl font-bold text-ocean-deep">${chapter.knowledgeMastery.length}</p>
                <p class="mt-2 text-xs text-slate-500">形成章节画像的知识点总数</p>
              </div>
              <div class="${theme.surface} px-4 py-4">
                <p class="section-kicker">能力标签</p>
                <p class="mt-3 text-2xl font-bold text-ocean-deep">${chapter.abilityMastery.length}</p>
                <p class="mt-2 text-xs text-slate-500">用于判断迁移与应用表现</p>
              </div>
            </section>

            <section class="surface-card rounded-[1.8rem] px-5 py-5">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="section-kicker">Knowledge Mastery</p>
                  <h5 class="mt-2 text-xl font-bold text-ocean-deep">章节知识点掌握图</h5>
                  <p class="mt-2 text-sm text-slate-500">按掌握率从低到高展示本章优先讲评的知识点。</p>
                </div>
                <span class="status-pill border-slate-200 bg-white/88 text-slate-500 shadow-sm">Top ${Math.min(chapter.weakKnowledgeTopN.length, 5)}</span>
              </div>
              <div class="mt-4 space-y-3">
                ${renderKnowledgeRows(chapter.weakKnowledgeTopN)}
              </div>
            </section>
          </div>

          <div class="space-y-5">
            <section class="surface-card rounded-[1.8rem] px-5 py-5">
              <p class="section-kicker">Evaluation</p>
              <h5 class="mt-2 text-xl font-bold text-ocean-deep">章节评价结果</h5>
              <p class="mt-4 text-sm leading-8 text-slate-600">${chapter.narrative.evaluation}</p>
            </section>

            <section class="surface-card rounded-[1.8rem] px-5 py-5">
              <p class="section-kicker">Teaching Suggestions</p>
              <h5 class="mt-2 text-xl font-bold text-ocean-deep">教学建议</h5>
              <div class="mt-4 space-y-3">
                ${chapter.narrative.suggestions.map((item, index) => `
                  <div class="chapter-suggestion-card rounded-[1.4rem] px-4 py-4 text-sm leading-7 text-slate-600">
                    <span class="mr-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ocean-deep text-xs font-bold text-white shadow-[0_10px_20px_rgba(17,93,140,0.18)]">${index + 1}</span>
                    ${item}
                  </div>
                `).join('')}
              </div>
            </section>

            <section class="surface-card rounded-[1.8rem] px-5 py-5">
              <p class="section-kicker">Ability Signals</p>
              <h5 class="mt-2 text-xl font-bold text-ocean-deep">能力维度表现</h5>
              <p class="mt-2 text-sm text-slate-500">优先显示本章掌握率较低的能力标签，用于判断知识迁移与应用表现。</p>
              <div class="mt-4 grid gap-3">
                ${renderAbilityRows(chapter.weakAbilityTopN)}
              </div>
            </section>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function syncChapterFocusOptions(analytics) {
  const selected = chapterFocusSelect.value;
  chapterFocusSelect.innerHTML = ['<option value="">显示全部章节</option>']
    .concat(analytics.chapters.map((item) => `<option value="${item.chapterId}">${item.displayLabel}</option>`))
    .join('');
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
    listQuestionKeysByPrefix(''),
  ]);
  state.questionMap = new Map(questions.map((item) => [item.questionId, item]));
  state.questionKeyMap = new Map(questionKeys.map((item) => [item.questionId, item]));
}

function normalizeSelectedClassId() {
  return String(classSelect.value || '').trim().toUpperCase();
}

async function loadAssignmentAttempts(classId) {
  const assignments = await listAssignmentsForProfile(state.profile);
  const relevantAssignments = assignments.filter((item) => (item.targetClassIds || []).includes(classId));
  const bundles = await Promise.all(relevantAssignments.map(async (assignment) => {
    const attempts = await listAssignmentAttempts({ assignmentId: assignment.assignmentId, classId });
    const submitted = attempts.filter((item) => ['submitted', 'graded', 'returned'].includes(item.status));
    return Promise.all(submitted.map(async (attempt) => ({
      ...attempt,
      answers: await listAttemptAnswers(attempt.attemptId),
      totalPossibleScore: Number(assignment.totalScore || 0),
      sourceTitle: assignment.title || '',
    })));
  }));
  return bundles.flat();
}

async function loadPracticeAttempts(classId) {
  const attempts = await listPracticeAttempts({ classId });
  return Promise.all(attempts.map(async (attempt) => ({
    ...attempt,
    answers: await listPracticeAnswers(attempt.attemptId),
  })));
}

async function refreshAnalytics() {
  const classId = normalizeSelectedClassId();
  if (!classId) {
    state.analytics = null;
    state.broadcast.script = null;
    renderBroadcastOutline(null);
    resetBroadcastDisplay();
    renderPageEmpty('请选择一个班级以生成学情分析。');
    setToneMessage(messageEl, '请选择班级后再查看学情分析。');
    return;
  }

  try {
    setToneMessage(messageEl, '正在加载班级作答数据并生成章节分析...');
    await ensureReferenceData();

    const [classStudents, assignmentAttempts, practiceAttempts] = await Promise.all([
      listUsersByFilters({
        profile: state.profile,
        classId,
        roles: ['student'],
      }),
      sourceSelect.value === 'practice' ? Promise.resolve([]) : loadAssignmentAttempts(classId),
      sourceSelect.value === 'assignment' ? Promise.resolve([]) : loadPracticeAttempts(classId),
    ]);

    state.analytics = buildChapterLearningAnalytics({
      assignmentAttempts,
      practiceAttempts,
      questionMap: state.questionMap,
      questionKeyMap: state.questionKeyMap,
      classStudents,
      source: sourceSelect.value,
    });

    renderAnalytics(state.analytics);
    setToneMessage(messageEl, `分析完成：覆盖 ${state.analytics.totalStudents} 名学生，形成 ${state.analytics.chapterCount} 个章节画像。`, "success");
  } catch (error) {
    console.error('Failed to load learning analytics:', error);
    state.analytics = null;
    state.broadcast.script = null;
    renderBroadcastOutline(null);
    resetBroadcastDisplay();
    renderPageEmpty('当前加载失败，请稍后重试。');
    setToneMessage(messageEl, error?.message || '学情分析加载失败。', 'error');
  }
}

function populateClassSelect() {
  classSelect.innerHTML = ['<option value="">请选择班级</option>']
    .concat(state.classes.map((item) => `<option value="${item.classId}">${item.classId} 路 ${item.name || item.classId}</option>`))
    .join('');
  if (!classSelect.value && state.classes[0]?.classId) {
    classSelect.value = state.classes[0].classId;
  }
}

async function refreshClasses() {
  state.classes = await listCourseClasses(state.profile);
  populateClassSelect();
}

function renderHeader(user, profile) {
  const classLabel = profile?.role === 'admin'
    ? '当前为管理员视角，可切换全部班级。'
    : `当前可查看班级：${(profile?.assignedClassIds || []).join('、') || '未分配班级'}`;
  headerSummaryEl.textContent = `${profile?.name || user?.email || ''} 已进入班级整体学情分析中心。${classLabel}`;
}

function bindEvents() {
  filterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    stopBroadcastPlayback();
    await refreshAnalytics();
  });

  chapterFocusSelect.addEventListener('change', () => {
    if (state.analytics) {
      renderChapterSections(state.analytics);
    }
  });

  generateBroadcastBtn.addEventListener('click', () => {
    generateBroadcastScriptFromState();
    setToneMessage(messageEl, '播报稿已生成，可以直接开始播报。', 'success');
  });

  startBroadcastBtn.addEventListener('click', async () => {
    await startBroadcastPlayback();
  });

  pauseBroadcastBtn.addEventListener('click', () => {
    toggleBroadcastPause();
  });

  overlayPauseBroadcastBtn?.addEventListener('click', () => {
    toggleBroadcastPause();
  });

  stopBroadcastBtn.addEventListener('click', () => {
    stopBroadcastPlayback();
    resetBroadcastDisplay();
  });

  overlayStopBroadcastBtn?.addEventListener('click', () => {
    stopBroadcastPlayback();
    resetBroadcastDisplay();
  });

  signoutBtn.addEventListener('click', async () => {
    stopBroadcastPlayback();
    await signOut(auth);
    window.location.href = 'login.html';
  });

  if (state.broadcast.supported) {
    window.speechSynthesis.addEventListener?.('voiceschanged', chooseBroadcastVoice);
    chooseBroadcastVoice();
  }
  window.addEventListener('resize', resizeCharts);
}

function guardTeacherAccess(profile) {
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

async function bootstrap() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
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
        console.error('Live2D avatar init failed after analytics ready:', error);
      });
    } catch (error) {
      console.error('Teacher analytics bootstrap failed:', error);
      setToneMessage(messageEl, error?.message || '页面初始化失败。', 'error');
      renderPageEmpty('页面初始化失败，请刷新后重试。');
    }
  });
}

bindEvents();
renderPageEmpty('正在等待教师权限校验与数据加载。');
renderBroadcastOutline(null);
resetBroadcastDisplay();
bootstrap();
