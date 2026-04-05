import {
  auth,
  formatDateTime,
  getUserContext,
  onAuthStateChanged,
  questionTypeLabel,
  roleLabel,
  signOut,
} from './firebase-core.js';
import {
  buildAssignmentAnalytics,
  buildPracticeAnalytics,
  callAdminSetUserProfile,
  createAssignmentRecord,
  evaluatePracticeAnswer,
  getAttemptReviewBundle,
  getPracticeReviewBundle,
  formatPracticeExpectedAnswer,
  formatPracticeResponsePayload,
  importQuestionBank,
  listAssignmentAttempts,
  listAssignmentsForProfile,
  listCourseClasses,
  listPracticeAttempts,
  listQuestionItems,
  listQuestionKeysByPrefix,
  listUsersByFilters,
  practicePageQuestionPrefix,
  saveClassRecord,
  saveManualReview,
  summarizeAssignmentRow,
} from './course-data.js';

const teacherSummaryEl = document.getElementById('teacher-summary');
const teacherRoleEl = document.getElementById('teacher-role');
const teacherEmailEl = document.getElementById('teacher-email');
const teacherClassesEl = document.getElementById('teacher-classes');
const importQuestionBankBtn = document.getElementById('import-question-bank-btn');
const importQuestionBankMessageEl = document.getElementById('import-question-bank-message');
const classForm = document.getElementById('class-form');
const classMessageEl = document.getElementById('class-message');
const classTableBody = document.getElementById('class-table-body');
const classIdInput = document.getElementById('class-id-input');
const classNameInput = document.getElementById('class-name-input');
const classGradeInput = document.getElementById('class-grade-input');
const classTermInput = document.getElementById('class-term-input');
const classTeachersInput = document.getElementById('class-teachers-input');
const classStatusInput = document.getElementById('class-status-input');
const studentFilterClass = document.getElementById('student-filter-class');
const studentFilterStatus = document.getElementById('student-filter-status');
const studentFilterKeyword = document.getElementById('student-filter-keyword');
const studentTableBody = document.getElementById('student-table-body');
const studentMessageEl = document.getElementById('student-message');
const studentEditorForm = document.getElementById('student-editor-form');
const studentEditorUid = document.getElementById('student-editor-uid');
const studentEditorName = document.getElementById('student-editor-name');
const studentEditorStudentNo = document.getElementById('student-editor-student-no');
const studentEditorClassId = document.getElementById('student-editor-class-id');
const studentEditorRole = document.getElementById('student-editor-role');
const studentEditorStatus = document.getElementById('student-editor-status');
const studentEditorAssignedClassIds = document.getElementById('student-editor-assigned-class-ids');
const assignmentForm = document.getElementById('assignment-form');
const assignmentFormMessageEl = document.getElementById('assignment-form-message');
const assignmentTitleInput = document.getElementById('assignment-title-input');
const assignmentDescriptionInput = document.getElementById('assignment-description-input');
const assignmentStartAtInput = document.getElementById('assignment-start-at-input');
const assignmentDueAtInput = document.getElementById('assignment-due-at-input');
const assignmentVisibilityInput = document.getElementById('assignment-visibility-input');
const assignmentReleasePolicyInput = document.getElementById('assignment-release-policy-input');
const assignmentTargetClassesInput = document.getElementById('assignment-target-classes-input');
const assignmentObjectiveScoreInput = document.getElementById('assignment-objective-score-input');
const assignmentSubjectiveScoreInput = document.getElementById('assignment-subjective-score-input');
const questionSearchInput = document.getElementById('question-search-input');
const questionTypeFilter = document.getElementById('question-type-filter');
const questionBankBody = document.getElementById('question-bank-body');
const assignmentDashboardBody = document.getElementById('assignment-dashboard-body');
const reviewAssignmentSelect = document.getElementById('review-assignment-select');
const reviewClassSelect = document.getElementById('review-class-select');
const reviewStatusSelect = document.getElementById('review-status-select');
const reviewAttemptsBody = document.getElementById('review-attempts-body');
const analyticsPanel = document.getElementById('analytics-panel');
const reviewEditor = document.getElementById('review-editor');
const practicePageSelect = document.getElementById('practice-page-select');
const practiceClassSelect = document.getElementById('practice-class-select');
const practiceAttemptsBody = document.getElementById('practice-attempts-body');
const practiceAnalyticsPanel = document.getElementById('practice-analytics-panel');
const practiceReviewEditor = document.getElementById('practice-review-editor');
const teacherSignoutBtn = document.getElementById('teacher-signout-btn');

const PRACTICE_PAGE_OPTIONS = [
  { pageId: 'all-single-choice', label: '全册 · 单选题综合练习' },
  { pageId: 'all-multiple-choice', label: '全册 · 多选题综合练习' },
  { pageId: 'all-fill-in', label: '全册 · 填空题综合练习' },
  { pageId: 'all-true-false', label: '全册 · 判断题综合练习' },
  { pageId: 'all-short-answer', label: '全册 · 简答题综合练习' },
];

const state = {
  profile: null,
  classes: [],
  students: [],
  questions: [],
  questionCatalog: [],
  assignments: [],
  attemptsByAssignmentId: new Map(),
  selectedQuestionIds: new Set(),
  selectedAttemptId: '',
  selectedPracticeAttemptId: '',
  practiceQuestionKeysByPage: new Map(),
  practiceQuestionMapsByPage: new Map(),
  practiceAttemptMap: new Map(),
  currentPracticeQuestionMap: new Map(),
  currentPracticeQuestionKeyMap: new Map(),
};

function csvToList(value) {
  return String(value || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
}

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

function masteryTone(level) {
  if (level === 'strong') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (level === 'warning') {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  return 'bg-rose-50 text-rose-700 border-rose-200';
}

function masteryLabel(level) {
  if (level === 'strong') return '掌握稳定';
  if (level === 'warning') return '需要巩固';
  return '重点补强';
}

function renderAnalyticsEmpty(message = '请选择作业后查看提交、批改和知识掌握分析。') {
  analyticsPanel.innerHTML = `
    <div class="rounded-[1.75rem] border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 via-white to-slate-100 px-6 py-10 text-center">
      <p class="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Teacher Insights</p>
      <h3 class="mt-3 text-2xl font-bold text-ocean-deep">作业分析面板</h3>
      <p class="mt-3 text-sm leading-7 text-slate-600">${message}</p>
    </div>
  `;
}

function populatePracticePageSelect() {
  practicePageSelect.innerHTML = ['<option value="">请选择综合练习</option>']
    .concat(PRACTICE_PAGE_OPTIONS.map((item) => `<option value="${item.pageId}">${item.label}</option>`))
    .join('');
}

function getPracticePageMeta(pageId) {
  return PRACTICE_PAGE_OPTIONS.find((item) => item.pageId === pageId) || null;
}

function renderPracticeAnalyticsEmpty(message = '请选择综合练习后查看参与情况、知识掌握分析和学生作答明细。') {
  practiceAnalyticsPanel.innerHTML = `
    <div class="rounded-[1.75rem] border border-dashed border-slate-300 bg-gradient-to-br from-slate-50 via-white to-slate-100 px-6 py-10 text-center">
      <p class="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Practice Insights</p>
      <h3 class="mt-3 text-2xl font-bold text-ocean-deep">综合练习分析面板</h3>
      <p class="mt-3 text-sm leading-7 text-slate-600">${message}</p>
    </div>
  `;
}

function buildTeachingSuggestions(analytics) {
  const suggestions = [];
  const weakestKnowledge = analytics.weakKnowledgeMasteryTopN?.[0];
  const weakestAbility = analytics.weakAbilityMasteryTopN?.[0];

  if (analytics.unsubmittedStudents > 0) {
    suggestions.push(`当前仍有 ${analytics.unsubmittedStudents} 名学生未提交，建议优先按班级追踪缺交名单。`);
  }
  if (analytics.pendingManualReview > 0) {
    suggestions.push(`仍有 ${analytics.pendingManualReview} 份作答存在主观题待批改，最终掌握画像会继续变化。`);
  }
  if (weakestKnowledge && weakestKnowledge.masteryRate < 60) {
    suggestions.push(`知识点“${weakestKnowledge.label}”掌握率仅 ${formatPercent(weakestKnowledge.masteryRate)}，建议安排针对性讲解和同类题再练。`);
  }
  if (weakestAbility && weakestAbility.masteryRate < 60) {
    suggestions.push(`${weakestAbility.label}表现偏弱，说明学生在迁移应用或分析判断上还有明显短板。`);
  }
  if (!suggestions.length) {
    suggestions.push('当前整体表现平稳，可优先关注中等掌握区间的知识点，把“会做”提升为“稳定会做”。');
  }
  return suggestions.slice(0, 3);
}

function renderDistributionBars(items = []) {
  const maxCount = Math.max(...items.map((item) => item.count), 1);
  return items.map((item) => `
    <div class="space-y-2">
      <div class="flex items-center justify-between text-sm text-slate-600">
        <span>${item.label}</span>
        <span class="font-semibold text-ocean-deep">${item.count} 人</span>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-slate-200">
        <div class="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-500 to-ocean-deep" style="width:${Math.max((item.count / maxCount) * 100, item.count ? 12 : 0)}%"></div>
      </div>
    </div>
  `).join('');
}

function renderKnowledgeCards(items = []) {
  if (!items.length) {
    return '<div class="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-sm text-slate-500">暂无可分析的客观题知识点数据。</div>';
  }
  return items.map((item) => `
    <article class="rounded-2xl border ${masteryTone(item.level)} bg-white/80 p-4 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${item.chapterLabel || item.chapterCode || '课程知识'}</p>
          <h4 class="mt-2 text-base font-semibold text-slate-800">${item.label}</h4>
        </div>
        <span class="rounded-full border px-3 py-1 text-xs font-semibold ${masteryTone(item.level)}">${masteryLabel(item.level)}</span>
      </div>
      <div class="mt-4">
        <div class="flex items-center justify-between text-sm">
          <span class="text-slate-500">掌握率</span>
          <span class="font-semibold text-ocean-deep">${formatPercent(item.masteryRate)}</span>
        </div>
        <div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
          <div class="h-full rounded-full bg-gradient-to-r from-ocean-deep via-cyan-500 to-sky-400" style="width:${Math.max(item.masteryRate, 6)}%"></div>
        </div>
      </div>
      <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-slate-500">涉及学生</dt>
          <dd class="mt-1 font-semibold text-slate-800">${item.studentCount}</dd>
        </div>
        <div>
          <dt class="text-slate-500">作答次数</dt>
          <dd class="mt-1 font-semibold text-slate-800">${item.totalCount}</dd>
        </div>
        <div>
          <dt class="text-slate-500">失分次数</dt>
          <dd class="mt-1 font-semibold text-slate-800">${item.incorrectCount}</dd>
        </div>
      </dl>
    </article>
  `).join('');
}

function renderAbilityChips(items = []) {
  if (!items.length) {
    return '<p class="text-sm text-slate-500">暂无能力维度数据。</p>';
  }
  return items.map((item) => `
    <div class="rounded-2xl border ${masteryTone(item.level)} bg-white/80 px-4 py-3 shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-semibold text-slate-800">${item.label}</span>
        <span class="text-sm font-semibold text-ocean-deep">${formatPercent(item.masteryRate)}</span>
      </div>
      <p class="mt-2 text-xs text-slate-500">共 ${item.totalCount} 次客观题作答，失分 ${item.incorrectCount} 次</p>
    </div>
  `).join('');
}

function renderRiskStudents(items = []) {
  if (!items.length) {
    return '<p class="text-sm text-slate-500">暂无风险学生画像。</p>';
  }
  return items.map((item) => {
    const isMissing = item.status === 'missing';
    const tagClasses = isMissing
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : item.scoreRate < 60
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-100 text-slate-700 border-slate-200';
    const detail = isMissing
      ? '未提交本次作业'
      : `得分率 ${formatPercent(item.scoreRate)}，客观题错 ${item.incorrectObjectiveCount}/${item.objectiveCount || 0}`;
    return `
      <div class="rounded-2xl border border-slate-200 bg-white/85 px-4 py-4 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-base font-semibold text-slate-800">${item.studentName}</p>
            <p class="mt-1 text-sm text-slate-500">${item.studentNo} · ${item.classId}</p>
          </div>
          <span class="rounded-full border px-3 py-1 text-xs font-semibold ${tagClasses}">${isMissing ? '缺交' : item.pendingManualReview > 0 ? '待批改' : '需关注'}</span>
        </div>
        <p class="mt-3 text-sm leading-6 text-slate-600">${detail}</p>
      </div>
    `;
  }).join('');
}

function renderAnalyticsPanel(analytics, assignment) {
  const suggestions = buildTeachingSuggestions(analytics);
  analyticsPanel.innerHTML = `
    <div class="space-y-5">
      <section class="overflow-hidden rounded-[1.9rem] border border-slate-200 bg-gradient-to-br from-ocean-deep via-[#0d4f78] to-[#3b82b8] px-6 py-6 text-white shadow-lg">
        <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.32em] text-white/65">Teacher Insights</p>
            <h3 class="mt-3 text-3xl font-bold">${analytics.assignmentTitle}</h3>
            <p class="mt-3 max-w-3xl text-sm leading-7 text-white/80">目标班级：${(assignment?.targetClassIds || []).join('、') || '未配置'}。该面板仅在教师或管理员登录状态下展示，用于查看提交概况、知识点掌握和风险学生。</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:min-w-[20rem]">
            <div class="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
              <p class="text-xs uppercase tracking-wide text-white/60">提交率</p>
              <p class="mt-2 text-2xl font-bold">${formatPercent(analytics.submissionRate)}</p>
            </div>
            <div class="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
              <p class="text-xs uppercase tracking-wide text-white/60">知识掌握均值</p>
              <p class="mt-2 text-2xl font-bold">${formatPercent(analytics.masteryRate)}</p>
            </div>
          </div>
        </div>
      </section>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">学生覆盖</p>
          <p class="mt-3 text-3xl font-bold text-ocean-deep">${analytics.submissionCount}<span class="ml-2 text-base font-medium text-slate-400">/ ${analytics.totalStudents}</span></p>
          <p class="mt-2 text-sm text-slate-600">未提交 ${analytics.unsubmittedStudents} 人</p>
        </article>
        <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">平均分</p>
          <p class="mt-3 text-3xl font-bold text-ocean-deep">${formatMetricNumber(analytics.avgScore)}</p>
          <p class="mt-2 text-sm text-slate-600">折算得分率 ${formatPercent(analytics.avgScoreRate)}</p>
        </article>
        <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">客观题正确率</p>
          <p class="mt-3 text-3xl font-bold text-ocean-deep">${formatPercent(analytics.correctRate)}</p>
          <p class="mt-2 text-sm text-slate-600">适合判断共性薄弱知识点</p>
        </article>
        <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">待人工批改</p>
          <p class="mt-3 text-3xl font-bold text-ocean-deep">${analytics.pendingManualReview}</p>
          <p class="mt-2 text-sm text-slate-600">已批改均分 ${formatMetricNumber(analytics.gradedAvgScore)}</p>
        </article>
      </section>

      <section class="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <article class="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-xl font-bold text-ocean-deep">成绩分布</h4>
              <p class="mt-1 text-sm text-slate-500">按得分率查看本次作业的班级分层。</p>
            </div>
            <div class="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
              强项 ${analytics.masteryBucketSummary.strong} · 预警 ${analytics.masteryBucketSummary.warning} · 薄弱 ${analytics.masteryBucketSummary.weak}
            </div>
          </div>
          <div class="mt-5 space-y-4">
            ${renderDistributionBars(analytics.scoreDistribution)}
          </div>
        </article>

        <article class="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <h4 class="text-xl font-bold text-ocean-deep">教学提示</h4>
          <div class="mt-4 space-y-3">
            ${suggestions.map((item, index) => `
              <div class="rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                <span class="mr-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ocean-deep text-xs font-bold text-white">${index + 1}</span>
                ${item}
              </div>
            `).join('')}
          </div>
        </article>
      </section>

      <section class="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <article class="rounded-[1.75rem] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-5 py-5 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-xl font-bold text-ocean-deep">知识点掌握情况</h4>
              <p class="mt-1 text-sm text-slate-500">优先展示掌握率最低的知识点，帮助教师快速判断补讲顺序。</p>
            </div>
            <span class="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm">Top ${Math.min(analytics.weakKnowledgeMasteryTopN.length, 6)}</span>
          </div>
          <div class="mt-5 grid gap-4">
            ${renderKnowledgeCards(analytics.weakKnowledgeMasteryTopN)}
          </div>
        </article>

        <div class="space-y-5">
          <article class="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
            <h4 class="text-xl font-bold text-ocean-deep">能力薄弱项</h4>
            <p class="mt-1 text-sm text-slate-500">基于客观题作答统计得到的低掌握能力标签。</p>
            <div class="mt-4 grid gap-3">
              ${renderAbilityChips(analytics.weakAbilityMasteryTopN)}
            </div>
          </article>

          <article class="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
            <h4 class="text-xl font-bold text-ocean-deep">风险学生提示</h4>
            <p class="mt-1 text-sm text-slate-500">优先列出缺交与低掌握学生，便于教师点名跟进。</p>
            <div class="mt-4 grid gap-3">
              ${renderRiskStudents(analytics.studentRiskTopN)}
            </div>
          </article>
        </div>
      </section>
    </div>
  `;
}

function buildPracticeSuggestions(analytics) {
  const suggestions = [];
  const weakestKnowledge = analytics.weakKnowledgeMasteryTopN?.[0];
  const weakestAbility = analytics.weakAbilityMasteryTopN?.[0];

  if (analytics.unstartedStudents > 0) {
    suggestions.push(`当前仍有 ${analytics.unstartedStudents} 名学生尚未开始该综合练习，建议优先提醒先完成基础练习。`);
  }
  if (weakestKnowledge && weakestKnowledge.masteryRate < 60) {
    suggestions.push(`知识点“${weakestKnowledge.label}”掌握率仅 ${formatPercent(weakestKnowledge.masteryRate)}，适合安排同章再练与讲评。`);
  }
  if (weakestAbility && weakestAbility.masteryRate < 60) {
    suggestions.push(`${weakestAbility.label}表现偏弱，说明学生在相关能力迁移上仍不稳定。`);
  }
  if (analytics.revealRate > 40) {
    suggestions.push(`学生查看答案比例达到 ${formatPercent(analytics.revealRate)}，建议补充分层练习，降低直接看答案的依赖。`);
  }
  if (!suggestions.length) {
    suggestions.push('当前练习参与和掌握情况整体平稳，可继续按章节推进巩固。');
  }
  return suggestions.slice(0, 3);
}

function renderPracticeAnalyticsPanel(analytics, pageMeta) {
  const suggestions = buildPracticeSuggestions(analytics);
  practiceAnalyticsPanel.innerHTML = `
    <div class="space-y-5">
      <section class="overflow-hidden rounded-[1.9rem] border border-slate-200 bg-gradient-to-br from-ocean-deep via-[#14557e] to-[#60a5d8] px-6 py-6 text-white shadow-lg">
        <div class="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.32em] text-white/65">Practice Insights</p>
            <h3 class="mt-3 text-3xl font-bold">${pageMeta?.label || analytics.pageTitle}</h3>
            <p class="mt-3 max-w-3xl text-sm leading-7 text-white/80">该区域统计学生在综合练习页中的真实作答记录，帮助教师判断参与度、掌握率和高风险学生。</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:min-w-[20rem]">
            <div class="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
              <p class="text-xs uppercase tracking-wide text-white/60">参与率</p>
              <p class="mt-2 text-2xl font-bold">${formatPercent(analytics.participationRate)}</p>
            </div>
            <div class="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
              <p class="text-xs uppercase tracking-wide text-white/60">知识掌握均值</p>
              <p class="mt-2 text-2xl font-bold">${formatPercent(analytics.masteryRate)}</p>
            </div>
          </div>
        </div>
      </section>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">学生覆盖</p>
          <p class="mt-3 text-3xl font-bold text-ocean-deep">${analytics.participationCount}<span class="ml-2 text-base font-medium text-slate-400">/ ${analytics.totalStudents}</span></p>
          <p class="mt-2 text-sm text-slate-600">未开始 ${analytics.unstartedStudents} 人</p>
        </article>
        <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">平均完成题数</p>
          <p class="mt-3 text-3xl font-bold text-ocean-deep">${formatMetricNumber(analytics.avgAnsweredCount)}</p>
          <p class="mt-2 text-sm text-slate-600">累计作答 ${analytics.totalAnsweredCount} 题次</p>
        </article>
        <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">客观题正确率</p>
          <p class="mt-3 text-3xl font-bold text-ocean-deep">${formatPercent(analytics.correctRate)}</p>
          <p class="mt-2 text-sm text-slate-600">共统计 ${analytics.objectiveCount} 次客观题作答</p>
        </article>
        <article class="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">查看答案占比</p>
          <p class="mt-3 text-3xl font-bold text-ocean-deep">${formatPercent(analytics.revealRate)}</p>
          <p class="mt-2 text-sm text-slate-600">共 ${analytics.answerRevealedCount} 次查看答案</p>
        </article>
      </section>

      <section class="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <article class="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-xl font-bold text-ocean-deep">教学提示</h4>
              <p class="mt-1 text-sm text-slate-500">基于练习参与度、知识点掌握和查看答案行为生成。</p>
            </div>
            <div class="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
              强项 ${analytics.masteryBucketSummary.strong} · 预警 ${analytics.masteryBucketSummary.warning} · 薄弱 ${analytics.masteryBucketSummary.weak}
            </div>
          </div>
          <div class="mt-4 space-y-3">
            ${suggestions.map((item, index) => `
              <div class="rounded-2xl bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                <span class="mr-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-ocean-deep text-xs font-bold text-white">${index + 1}</span>
                ${item}
              </div>
            `).join('')}
          </div>
        </article>

        <article class="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <h4 class="text-xl font-bold text-ocean-deep">能力薄弱项</h4>
          <p class="mt-1 text-sm text-slate-500">仅基于可自动判断正误的客观题统计。</p>
          <div class="mt-4 grid gap-3">
            ${renderAbilityChips(analytics.weakAbilityMasteryTopN)}
          </div>
        </article>
      </section>

      <section class="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <article class="rounded-[1.75rem] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-5 py-5 shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h4 class="text-xl font-bold text-ocean-deep">知识点掌握情况</h4>
              <p class="mt-1 text-sm text-slate-500">优先显示掌握率最低的知识点，帮助教师确定讲评顺序。</p>
            </div>
            <span class="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm">Top ${Math.min(analytics.weakKnowledgeMasteryTopN.length, 6)}</span>
          </div>
          <div class="mt-5 grid gap-4">
            ${renderKnowledgeCards(analytics.weakKnowledgeMasteryTopN)}
          </div>
        </article>

        <article class="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <h4 class="text-xl font-bold text-ocean-deep">风险学生提示</h4>
          <p class="mt-1 text-sm text-slate-500">列出未开始练习和低正确率学生，便于教师快速跟进。</p>
          <div class="mt-4 grid gap-3">
            ${renderRiskStudents(analytics.studentRiskTopN)}
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderTeacherHeader(user, profile) {
  teacherSummaryEl.textContent = `当前账号：${profile?.name || user?.email || ''}，仅能操作自己负责班级的作业与成绩。`;
  teacherRoleEl.textContent = roleLabel(profile?.role);
  teacherEmailEl.textContent = user?.email || '-';
  teacherClassesEl.textContent = profile?.role === 'admin'
    ? '全部班级'
    : (profile?.assignedClassIds || []).join(', ') || '未分配班级';
}

function renderClassTable() {
  if (!state.classes.length) {
    classTableBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500">暂无班级数据。</td></tr>';
    return;
  }
  classTableBody.innerHTML = state.classes.map((item) => `
    <tr data-class-id="${item.classId}" class="cursor-pointer hover:bg-slate-50">
      <td class="py-4 pr-4 align-top font-semibold text-ocean-deep">${item.classId}</td>
      <td class="py-4 pr-4 align-top">${item.name || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.grade || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.term || '-'}</td>
      <td class="py-4 pr-4 align-top break-all">${(item.teacherUids || []).join(', ') || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.studentCount ?? 0}</td>
      <td class="py-4 align-top">${item.status || '-'}</td>
    </tr>
  `).join('');
  classTableBody.querySelectorAll('tr[data-class-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const classId = row.getAttribute('data-class-id');
      const record = state.classes.find((item) => item.classId === classId);
      if (!record) return;
      classIdInput.value = record.classId || '';
      classNameInput.value = record.name || '';
      classGradeInput.value = record.grade || '';
      classTermInput.value = record.term || '';
      classTeachersInput.value = (record.teacherUids || []).join(', ');
      classStatusInput.value = record.status || 'active';
    });
  });
}

function populateClassSelects() {
  const options = ['<option value="">全部班级</option>']
    .concat(state.classes.map((item) => `<option value="${item.classId}">${item.classId} · ${item.name || item.classId}</option>`))
    .join('');
  studentFilterClass.innerHTML = options;
  reviewClassSelect.innerHTML = options;
  practiceClassSelect.innerHTML = options;
}

async function refreshClasses() {
  state.classes = await listCourseClasses(state.profile);
  renderClassTable();
  populateClassSelects();
}

function renderStudentTable() {
  if (!state.students.length) {
    studentTableBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500">没有匹配到学生记录。</td></tr>';
    return;
  }
  studentTableBody.innerHTML = state.students.map((item) => `
    <tr data-user-id="${item.id}" class="cursor-pointer hover:bg-slate-50">
      <td class="py-4 pr-4 align-top font-semibold text-ocean-deep">${item.studentNo || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.name || '-'}</td>
      <td class="py-4 pr-4 align-top break-all">${item.email || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.classId || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.status || '-'}</td>
      <td class="py-4 pr-4 align-top">${formatDateTime(item.lastLoginAt)}</td>
      <td class="py-4 align-top">${formatDateTime(item.createdAt)}</td>
    </tr>
  `).join('');

  studentTableBody.querySelectorAll('tr[data-user-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const userId = row.getAttribute('data-user-id');
      const record = state.students.find((item) => item.id === userId);
      if (!record) return;
      studentEditorUid.value = record.id || '';
      studentEditorName.value = record.name || '';
      studentEditorStudentNo.value = record.studentNo || '';
      studentEditorClassId.value = record.classId || '';
      studentEditorRole.value = record.role || 'student';
      studentEditorStatus.value = record.status || 'active';
      studentEditorAssignedClassIds.value = (record.assignedClassIds || []).join(', ');
    });
  });
}

async function refreshStudents() {
  state.students = await listUsersByFilters({
    profile: state.profile,
    classId: studentFilterClass.value,
    status: studentFilterStatus.value,
    keyword: studentFilterKeyword.value,
    roles: ['student'],
  });
  renderStudentTable();
}

function renderQuestionBank() {
  if (!state.questions.length) {
    questionBankBody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-500">题库为空，请先导入静态题库。</td></tr>';
    return;
  }
  questionBankBody.innerHTML = state.questions.map((item) => `
    <tr class="hover:bg-slate-50">
      <td class="py-3 px-3 align-top">
        <input type="checkbox" data-question-id="${item.questionId}" ${state.selectedQuestionIds.has(item.questionId) ? 'checked' : ''} class="h-4 w-4 text-ocean-mid" />
      </td>
      <td class="py-3 px-3 align-top font-semibold text-ocean-deep">${item.questionId}</td>
      <td class="py-3 px-3 align-top">${questionTypeLabel(item.type)}</td>
      <td class="py-3 px-3 align-top">${item.chapterCode || item.chapterLabel || '-'}</td>
      <td class="py-3 px-3 align-top text-slate-600">${item.stem}</td>
    </tr>
  `).join('');
  questionBankBody.querySelectorAll('input[data-question-id]').forEach((input) => {
    input.addEventListener('change', () => {
      const questionId = input.getAttribute('data-question-id');
      if (!questionId) return;
      if (input.checked) state.selectedQuestionIds.add(questionId);
      else state.selectedQuestionIds.delete(questionId);
    });
  });
}

async function refreshQuestionBank() {
  state.questionCatalog = await listQuestionItems();
  state.questions = await listQuestionItems({ keyword: questionSearchInput.value, type: questionTypeFilter.value });
  state.practiceQuestionMapsByPage.clear();
  state.practiceQuestionKeysByPage.clear();
  renderQuestionBank();
}

async function refreshAssignments() {
  const assignments = await listAssignmentsForProfile(state.profile);
  state.assignments = assignments;
  state.attemptsByAssignmentId = new Map();
  await Promise.all(assignments.map(async (assignment) => {
    const attempts = await listAssignmentAttempts({ assignmentId: assignment.assignmentId });
    state.attemptsByAssignmentId.set(assignment.assignmentId, attempts);
  }));

  if (!assignments.length) {
    assignmentDashboardBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500">当前没有作业记录。</td></tr>';
    reviewAssignmentSelect.innerHTML = '<option value="">请选择作业</option>';
    return;
  }

  assignmentDashboardBody.innerHTML = assignments.map((assignment) => {
    const summary = summarizeAssignmentRow(assignment, state.attemptsByAssignmentId.get(assignment.assignmentId) || []);
    return `
      <tr data-assignment-id="${assignment.assignmentId}" class="cursor-pointer hover:bg-slate-50">
        <td class="py-4 pr-4 align-top font-semibold text-ocean-deep">${summary.title}</td>
        <td class="py-4 pr-4 align-top">${summary.targetClassIdsLabel}</td>
        <td class="py-4 pr-4 align-top">${summary.visibilityLabel}</td>
        <td class="py-4 pr-4 align-top">${summary.dueAtLabel}</td>
        <td class="py-4 pr-4 align-top">${summary.submittedCount}</td>
        <td class="py-4 pr-4 align-top">${summary.gradedCount}</td>
        <td class="py-4 align-top">${summary.avgScore}</td>
      </tr>
    `;
  }).join('');

  reviewAssignmentSelect.innerHTML = ['<option value="">请选择作业</option>']
    .concat(assignments.map((assignment) => `<option value="${assignment.assignmentId}">${assignment.title}</option>`))
    .join('');

  assignmentDashboardBody.querySelectorAll('tr[data-assignment-id]').forEach((row) => {
    row.addEventListener('click', async () => {
      reviewAssignmentSelect.value = row.getAttribute('data-assignment-id') || '';
      await refreshReviewSection();
    });
  });
}

function renderAttemptsTable(attempts) {
  if (!attempts.length) {
    reviewAttemptsBody.innerHTML = '<tr><td colspan="8" class="py-6 text-center text-slate-500">该筛选条件下暂无作答记录。</td></tr>';
    return;
  }
  reviewAttemptsBody.innerHTML = attempts.map((item) => `
    <tr data-attempt-id="${item.attemptId}" class="cursor-pointer hover:bg-slate-50">
      <td class="py-4 pr-4 align-top font-semibold text-ocean-deep">${item.studentNo || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.studentName || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.classId || '-'}</td>
      <td class="py-4 pr-4 align-top">${formatDateTime(item.submittedAt)}</td>
      <td class="py-4 pr-4 align-top">${item.status}</td>
      <td class="py-4 pr-4 align-top">${item.objectiveScore ?? 0}</td>
      <td class="py-4 pr-4 align-top">${item.subjectivePendingCount ?? 0}</td>
      <td class="py-4 align-top">${item.totalScore ?? 0}</td>
    </tr>
  `).join('');

  reviewAttemptsBody.querySelectorAll('tr[data-attempt-id]').forEach((row) => {
    row.addEventListener('click', async () => {
      state.selectedAttemptId = row.getAttribute('data-attempt-id') || '';
      await renderReviewEditor();
    });
  });
}

async function loadPracticeReferenceData(pageId) {
  if (!pageId) {
    return { questionMap: new Map(), questionKeyMap: new Map() };
  }
  const prefix = practicePageQuestionPrefix(pageId);
  if (!prefix) {
    return { questionMap: new Map(), questionKeyMap: new Map() };
  }

  if (!state.questionCatalog.length) {
    state.questionCatalog = await listQuestionItems();
  }

  if (!state.practiceQuestionMapsByPage.has(pageId)) {
    const questionMap = new Map(
      state.questionCatalog
        .filter((item) => item.questionId.startsWith(prefix))
        .map((item) => [item.questionId, item]),
    );
    state.practiceQuestionMapsByPage.set(pageId, questionMap);
  }

  if (!state.practiceQuestionKeysByPage.has(pageId)) {
    const keys = await listQuestionKeysByPrefix(prefix);
    const keyMap = new Map(keys.map((item) => [item.questionId, item]));
    state.practiceQuestionKeysByPage.set(pageId, keyMap);
  }

  return {
    questionMap: state.practiceQuestionMapsByPage.get(pageId) || new Map(),
    questionKeyMap: state.practiceQuestionKeysByPage.get(pageId) || new Map(),
  };
}

function renderPracticeAttemptsTable(attempts) {
  if (!attempts.length) {
    practiceAttemptsBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500">该筛选条件下暂无练习记录。</td></tr>';
    return;
  }

  practiceAttemptsBody.innerHTML = attempts.map((item) => `
    <tr data-practice-attempt-id="${item.attemptId}" class="cursor-pointer hover:bg-slate-50">
      <td class="py-4 pr-4 align-top font-semibold text-ocean-deep">${item.studentNo || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.studentName || '-'}</td>
      <td class="py-4 pr-4 align-top">${item.classId || '-'}</td>
      <td class="py-4 pr-4 align-top">${formatDateTime(item.lastSavedAt || item.updatedAt)}</td>
      <td class="py-4 pr-4 align-top">${item.answeredCount ?? 0}</td>
      <td class="py-4 pr-4 align-top">${formatPercent(item.correctRate ?? 0)}</td>
      <td class="py-4 align-top">${item.answerRevealedCount ?? 0}</td>
    </tr>
  `).join('');

  practiceAttemptsBody.querySelectorAll('tr[data-practice-attempt-id]').forEach((row) => {
    row.addEventListener('click', async () => {
      state.selectedPracticeAttemptId = row.getAttribute('data-practice-attempt-id') || '';
      await renderPracticeReviewEditor();
    });
  });
}

async function buildPracticeInsights(attempts, pageId, selectedClassId = '') {
  const { questionMap, questionKeyMap } = await loadPracticeReferenceData(pageId);
  state.currentPracticeQuestionMap = questionMap;
  state.currentPracticeQuestionKeyMap = questionKeyMap;

  const attemptsWithAnswers = await Promise.all(attempts.map(async (attempt) => {
    const bundle = await getPracticeReviewBundle(attempt.attemptId, { questionMap, questionKeyMap });
    let objectiveCount = 0;
    let correctObjectiveCount = 0;
    let answerRevealedCount = 0;

    (bundle.answers || []).forEach((answer) => {
      if (answer.answerRevealed) {
        answerRevealedCount += 1;
      }
      const evaluation = evaluatePracticeAnswer({
        answer,
        questionKey: questionKeyMap.get(answer.questionId),
      });
      if (!evaluation.objective) {
        return;
      }
      objectiveCount += 1;
      if (evaluation.autoCorrect) {
        correctObjectiveCount += 1;
      }
    });

    return {
      ...attempt,
      answers: bundle.answers || [],
      answeredCount: (bundle.answers || []).length,
      answerRevealedCount,
      objectiveCount,
      correctRate: objectiveCount ? (correctObjectiveCount / objectiveCount) * 100 : 0,
    };
  }));

  state.practiceAttemptMap = new Map(attemptsWithAnswers.map((item) => [item.attemptId, item]));

  const classStudents = [];
  const classIds = selectedClassId
    ? [selectedClassId]
    : state.classes.map((item) => item.classId).filter(Boolean);
  for (const classId of classIds) {
    const students = await listUsersByFilters({ profile: state.profile, classId, roles: ['student'] });
    classStudents.push(...students);
  }

  return {
    attemptsWithAnswers,
    analytics: buildPracticeAnalytics({
      pageTitle: getPracticePageMeta(pageId)?.label || pageId,
      attempts: attemptsWithAnswers,
      questionMap,
      questionKeyMap,
      classStudents,
    }),
  };
}

async function buildAnalytics(attempts, assignment) {
  const attemptsWithAnswers = [];
  const questionMap = new Map();
  for (const attempt of attempts) {
    const bundle = await getAttemptReviewBundle(attempt.attemptId);
    const answers = bundle.answers || [];
    attemptsWithAnswers.push({ ...attempt, answers });
    (bundle.questions || []).forEach((question) => questionMap.set(question.questionId, question));
  }
  const classStudents = [];
  for (const classId of assignment.targetClassIds || []) {
    const students = await listUsersByFilters({ profile: state.profile, classId, roles: ['student'] });
    classStudents.push(...students);
  }
  return buildAssignmentAnalytics({
    assignment,
    attempts: attemptsWithAnswers,
    questionMap,
    classStudents,
  });
}

async function refreshReviewSection() {
  const assignmentId = reviewAssignmentSelect.value;
  if (!assignmentId) {
    reviewAttemptsBody.innerHTML = '<tr><td colspan="8" class="py-6 text-center text-slate-500">请选择作业。</td></tr>';
    renderAnalyticsEmpty();
    reviewEditor.innerHTML = '';
    return;
  }
  const attempts = await listAssignmentAttempts({
    assignmentId,
    classId: reviewClassSelect.value,
    status: reviewStatusSelect.value,
  });
  renderAttemptsTable(attempts);
  const assignment = state.assignments.find((item) => item.assignmentId === assignmentId);
  if (assignment) {
    const analytics = await buildAnalytics(await listAssignmentAttempts({ assignmentId }), assignment);
    renderAnalyticsPanel(analytics, assignment);
  }
}

async function refreshPracticeSection() {
  const pageId = practicePageSelect.value;
  if (!pageId) {
    practiceAttemptsBody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500">请选择综合练习。</td></tr>';
    renderPracticeAnalyticsEmpty();
    practiceReviewEditor.innerHTML = '';
    state.selectedPracticeAttemptId = '';
    state.practiceAttemptMap = new Map();
    return;
  }

  const attempts = await listPracticeAttempts({
    pageId,
    classId: practiceClassSelect.value,
  });
  const { attemptsWithAnswers, analytics } = await buildPracticeInsights(attempts, pageId, practiceClassSelect.value);
  renderPracticeAttemptsTable(attemptsWithAnswers);
  renderPracticeAnalyticsPanel(analytics, getPracticePageMeta(pageId));
  if (state.selectedPracticeAttemptId && !state.practiceAttemptMap.has(state.selectedPracticeAttemptId)) {
    state.selectedPracticeAttemptId = '';
  }
  await renderPracticeReviewEditor();
}

async function renderReviewEditor() {
  if (!state.selectedAttemptId) {
    reviewEditor.innerHTML = '';
    return;
  }
  const bundle = await getAttemptReviewBundle(state.selectedAttemptId);
  reviewEditor.innerHTML = `
    <div class="rounded-2xl bg-slate-50 p-4 space-y-3">
      <div>
        <p class="text-xs uppercase tracking-wide text-slate-500">当前批改</p>
        <h3 class="mt-1 text-xl font-bold text-ocean-deep">${bundle.attempt.studentName} · ${bundle.attempt.studentNo}</h3>
        <p class="mt-1 text-sm text-slate-600">状态：${bundle.attempt.status} · 已提交：${formatDateTime(bundle.attempt.submittedAt)}</p>
      </div>
      <textarea id="teacher-feedback-input" rows="3" class="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm" placeholder="教师评语">${bundle.attempt.teacherFeedback || ''}</textarea>
      <div class="space-y-3">
        ${(bundle.answers || []).map((answer) => {
          const question = (bundle.questions || []).find((item) => item.questionId === answer.questionId);
          const responseText = answer.responsePayload?.selected
            || (answer.responsePayload?.selectedList || []).join(', ')
            || answer.responsePayload?.text
            || (answer.responsePayload?.blanks || []).join(' / ')
            || '未作答';
          return `
            <article class="rounded-2xl border border-slate-200 bg-white p-4" data-review-question-id="${answer.questionId}">
              <p class="text-xs uppercase tracking-wide text-ocean-mid">${questionTypeLabel(answer.questionType)} · ${question?.chapterLabel || '-'}</p>
              <h4 class="mt-2 text-base font-semibold text-ocean-deep">${question?.stem || answer.questionId}</h4>
              <p class="mt-2 text-sm leading-6 text-slate-700">学生作答：${responseText}</p>
              <div class="mt-3 grid gap-3 md:grid-cols-3">
                <div class="rounded-xl bg-slate-50 px-3 py-2 text-sm">系统得分：${answer.autoScore ?? 0}</div>
                <input type="number" min="0" step="0.5" data-manual-score value="${answer.manualScore ?? 0}"  class="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <label class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm ">
                  <input type="checkbox" data-needs-review ${answer.needsManualReview ? 'checked' : ''}  />
                  继续待批改
                </label>
              </div>
              <textarea data-manual-comment rows="2"  class="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="教师评语">${answer.manualComment || ''}</textarea>
            </article>
          `;
        }).join('')}
      </div>
      <button id="save-review-btn" type="button" class="rounded-xl bg-ocean-mid px-4 py-3 text-sm font-semibold text-white hover:bg-ocean-deep transition">保存批改结果</button>
      <p id="review-message" class="text-sm text-slate-600" aria-live="polite"></p>
    </div>
  `;

  document.getElementById('save-review-btn')?.addEventListener('click', async () => {
    const reviewMap = new Map();
    reviewEditor.querySelectorAll('[data-review-question-id]').forEach((card) => {
      const questionId = card.getAttribute('data-review-question-id');
      if (!questionId) return;
      reviewMap.set(questionId, {
        manualScore: Number(card.querySelector('[data-manual-score]')?.value || 0),
        needsManualReview: Boolean(card.querySelector('[data-needs-review]')?.checked),
        manualComment: card.querySelector('[data-manual-comment]')?.value || '',
      });
    });
    const reviewMessage = document.getElementById('review-message');
    setToneMessage(reviewMessage, '正在保存批改结果…');
    try {
      await saveManualReview({
        profile: state.profile,
        attempt: bundle.attempt,
        answers: bundle.answers,
        reviewMap,
        teacherFeedback: document.getElementById('teacher-feedback-input')?.value || '',
      });
      setToneMessage(reviewMessage, '批改结果已保存。', 'success');
      await refreshAssignments();
      await refreshReviewSection();
    } catch (error) {
      setToneMessage(reviewMessage, error?.message || '保存失败，请稍后再试。', 'error');
    }
  });
}

async function renderPracticeReviewEditor() {
  if (!state.selectedPracticeAttemptId) {
    practiceReviewEditor.innerHTML = '';
    return;
  }

  const pageId = practicePageSelect.value;
  const { questionMap, questionKeyMap } = await loadPracticeReferenceData(pageId);
  const bundle = await getPracticeReviewBundle(state.selectedPracticeAttemptId, { questionMap, questionKeyMap });
  const currentAttempt = state.practiceAttemptMap.get(state.selectedPracticeAttemptId) || bundle.attempt;

  practiceReviewEditor.innerHTML = `
    <div class="rounded-2xl bg-slate-50 p-4 space-y-4">
      <div>
        <p class="text-xs uppercase tracking-wide text-slate-500">练习明细</p>
        <h3 class="mt-1 text-xl font-bold text-ocean-deep">${bundle.attempt.studentName || '-'} · ${bundle.attempt.studentNo || '-'}</h3>
        <p class="mt-1 text-sm text-slate-600">班级：${bundle.attempt.classId || '-'} · 最近保存：${formatDateTime(bundle.attempt.lastSavedAt || bundle.attempt.updatedAt)}</p>
        <p class="mt-1 text-sm text-slate-600">已答 ${currentAttempt.answeredCount ?? (bundle.answers || []).length} 题 · 客观题正确率 ${formatPercent(currentAttempt.correctRate ?? 0)} · 查看答案 ${currentAttempt.answerRevealedCount ?? 0} 次</p>
      </div>
      <div class="space-y-3">
        ${(bundle.answers || []).map((answer) => {
          const question = questionMap.get(answer.questionId);
          const questionKey = questionKeyMap.get(answer.questionId);
          const evaluation = evaluatePracticeAnswer({ answer, questionKey });
          const resultLabel = evaluation.autoCorrect === null
            ? '待判断'
            : evaluation.autoCorrect
              ? '正确'
              : '错误';
          const resultClasses = evaluation.autoCorrect === null
            ? 'bg-slate-100 text-slate-700'
            : evaluation.autoCorrect
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-rose-50 text-rose-700';
          return `
            <article class="rounded-2xl border border-slate-200 bg-white p-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-xs uppercase tracking-wide text-ocean-mid">${question?.chapterLabel || '-'} · ${questionTypeLabel(answer.questionType)}</p>
                <span class="rounded-full px-3 py-1 text-xs font-semibold ${resultClasses}">${resultLabel}</span>
              </div>
              <h4 class="mt-2 text-base font-semibold text-ocean-deep">${question?.stem || answer.questionId}</h4>
              <dl class="mt-4 grid gap-3 text-sm">
                <div>
                  <dt class="text-slate-500">学生作答</dt>
                  <dd class="mt-1 text-slate-800">${formatPracticeResponsePayload(answer.questionType, answer.responsePayload)}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">标准答案 / 参考要点</dt>
                  <dd class="mt-1 text-slate-800">${formatPracticeExpectedAnswer(answer.questionType, questionKey)}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">查看答案</dt>
                  <dd class="mt-1 text-slate-800">${answer.answerRevealed ? '已查看' : '未查看'}</dd>
                </div>
              </dl>
            </article>
          `;
        }).join('') || '<p class="text-sm text-slate-500">该学生尚未形成可展示的练习作答。</p>'}
      </div>
    </div>
  `;
}

classForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.profile?.role !== 'admin') {
    setToneMessage(classMessageEl, '只有管理员可以维护班级。', 'error');
    return;
  }
  setToneMessage(classMessageEl, '正在保存班级…');
  try {
    await saveClassRecord({
      classId: classIdInput.value,
      name: classNameInput.value,
      grade: classGradeInput.value,
      term: classTermInput.value,
      teacherUids: csvToList(classTeachersInput.value),
      status: classStatusInput.value,
    });
    setToneMessage(classMessageEl, '班级已保存。', 'success');
    await refreshClasses();
  } catch (error) {
    setToneMessage(classMessageEl, error?.message || '保存班级失败。', 'error');
  }
});

studentFilterClass?.addEventListener('change', () => refreshStudents());
studentFilterStatus?.addEventListener('change', () => refreshStudents());
studentFilterKeyword?.addEventListener('input', () => refreshStudents());

studentEditorForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.profile?.role !== 'admin') {
    setToneMessage(studentMessageEl, '只有管理员可以修改用户资料。', 'error');
    return;
  }
  if (!studentEditorUid.value.trim()) {
    setToneMessage(studentMessageEl, '请先从表格中选择一名学生。', 'error');
    return;
  }
  setToneMessage(studentMessageEl, '正在保存用户资料…');
  try {
    await callAdminSetUserProfile({
      uid: studentEditorUid.value.trim(),
      name: studentEditorName.value.trim(),
      studentNo: studentEditorRole.value === 'student' ? studentEditorStudentNo.value.trim().toUpperCase() : null,
      classId: studentEditorRole.value === 'student' ? studentEditorClassId.value.trim().toUpperCase() : null,
      role: studentEditorRole.value,
      status: studentEditorStatus.value,
      assignedClassIds: csvToList(studentEditorAssignedClassIds.value),
    });
    setToneMessage(studentMessageEl, '用户资料已保存。', 'success');
    await refreshStudents();
    await refreshClasses();
  } catch (error) {
    setToneMessage(studentMessageEl, error?.message || '保存失败。', 'error');
  }
});

assignmentForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const objectiveScore = Number(assignmentObjectiveScoreInput.value || 1);
  const subjectiveScore = Number(assignmentSubjectiveScoreInput.value || 10);
  const selectedQuestions = Array.from(state.selectedQuestionIds)
    .map((questionId) => state.questions.find((item) => item.questionId === questionId))
    .filter(Boolean)
    .map((question) => ({
      ...question,
      score: question.type === 'short_answer' ? subjectiveScore : objectiveScore,
    }));

  setToneMessage(assignmentFormMessageEl, '正在创建作业…');
  try {
    const assignmentId = await createAssignmentRecord({
      profile: state.profile,
      payload: {
        title: assignmentTitleInput.value,
        description: assignmentDescriptionInput.value,
        startAt: assignmentStartAtInput.value,
        dueAt: assignmentDueAtInput.value,
        visibility: assignmentVisibilityInput.value,
        resultReleasePolicy: assignmentReleasePolicyInput.value,
        targetClassIds: csvToList(assignmentTargetClassesInput.value),
      },
      selectedQuestions,
    });
    setToneMessage(assignmentFormMessageEl, `作业已创建：${assignmentId}`, 'success');
    state.selectedQuestionIds.clear();
    assignmentForm.reset();
    assignmentVisibilityInput.value = 'draft';
    assignmentReleasePolicyInput.value = 'after_manual_grade';
    assignmentObjectiveScoreInput.value = '1';
    assignmentSubjectiveScoreInput.value = '10';
    renderQuestionBank();
    await refreshAssignments();
  } catch (error) {
    setToneMessage(assignmentFormMessageEl, error?.message || '创建作业失败。', 'error');
  }
});

questionSearchInput?.addEventListener('input', () => refreshQuestionBank());
questionTypeFilter?.addEventListener('change', () => refreshQuestionBank());
importQuestionBankBtn?.addEventListener('click', async () => {
  setToneMessage(importQuestionBankMessageEl, '正在导入静态题库…');
  try {
    const result = await importQuestionBank();
    setToneMessage(importQuestionBankMessageEl, `题库导入完成，共 ${result.importedCount} 道题。`, 'success');
    await refreshQuestionBank();
  } catch (error) {
    setToneMessage(importQuestionBankMessageEl, error?.message || '题库导入失败。', 'error');
  }
});
reviewAssignmentSelect?.addEventListener('change', () => refreshReviewSection());
reviewClassSelect?.addEventListener('change', () => refreshReviewSection());
reviewStatusSelect?.addEventListener('change', () => refreshReviewSection());
practicePageSelect?.addEventListener('change', () => refreshPracticeSection());
practiceClassSelect?.addEventListener('change', () => refreshPracticeSection());
teacherSignoutBtn?.addEventListener('click', async () => {
  await signOut(auth).catch(() => {});
  window.location.href = 'login.html';
});

document.getElementById('refresh-classes-btn')?.addEventListener('click', () => refreshClasses());
document.getElementById('refresh-students-btn')?.addEventListener('click', () => refreshStudents());
document.getElementById('refresh-question-bank-btn')?.addEventListener('click', () => refreshQuestionBank());
document.getElementById('refresh-assignments-dashboard-btn')?.addEventListener('click', () => refreshAssignments());
document.getElementById('refresh-practice-dashboard-btn')?.addEventListener('click', () => refreshPracticeSection());

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  const { profile } = await getUserContext({ ensureProfile: false });
  if (!profile || !['teacher', 'admin'].includes(profile.role || '')) {
    teacherSummaryEl.textContent = '当前账号没有教师后台权限，请联系管理员。';
    return;
  }
  state.profile = { id: user.uid, ...profile };
  renderTeacherHeader(user, state.profile);
  populatePracticePageSelect();
  if (state.profile.role !== 'admin') {
    classForm?.querySelectorAll('input,select,button').forEach((el) => el.setAttribute('disabled', 'disabled'));
    studentEditorForm?.querySelectorAll('input,select,button').forEach((el) => el.setAttribute('disabled', 'disabled'));
  }
  await refreshClasses();
  await refreshStudents();
  await refreshQuestionBank();
  await refreshAssignments();
  renderAnalyticsEmpty();
  renderPracticeAnalyticsEmpty();
});
