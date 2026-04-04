import {
  auth,
  formatDateTime,
  getUserContext,
  onAuthStateChanged,
  questionTypeLabel,
  signOut,
} from './firebase-core.js';
import {
  callSubmitAssignmentAttempt,
  ensureDraftAttempt,
  getAssignmentBundle,
  listAttemptAnswers,
  saveAttemptAnswer,
} from './course-data.js';

const assignmentTitleEl = document.getElementById('assignment-title');
const assignmentClassesEl = document.getElementById('assignment-classes');
const assignmentStartAtEl = document.getElementById('assignment-start-at');
const assignmentDueAtEl = document.getElementById('assignment-due-at');
const attemptStatusEl = document.getElementById('attempt-status');
const assignmentDescriptionEl = document.getElementById('assignment-description');
const assignmentMessageEl = document.getElementById('assignment-message');
const submitBtn = document.getElementById('submit-assignment-btn');
const questionListEl = document.getElementById('question-list');

const params = new URLSearchParams(window.location.search);
const assignmentId = params.get('assignmentId') || '';

let currentProfile = null;
let currentAssignment = null;
let currentQuestions = [];
let currentAnswers = new Map();
let currentAttempt = null;
const saveTimers = new Map();

function setMessage(message, tone = 'info') {
  assignmentMessageEl.textContent = message || '';
  assignmentMessageEl.classList.remove('text-red-600', 'text-emerald-600', 'text-slate-600');
  if (!message) {
    assignmentMessageEl.classList.add('text-slate-600');
    return;
  }
  if (tone === 'error') assignmentMessageEl.classList.add('text-red-600');
  else if (tone === 'success') assignmentMessageEl.classList.add('text-emerald-600');
  else assignmentMessageEl.classList.add('text-slate-600');
}

function getStoredAnswer(questionId) {
  return currentAnswers.get(questionId) || null;
}

function renderQuestion(question) {
  const answer = getStoredAnswer(question.questionId);
  const locked = currentAttempt?.status !== 'draft';
  const score = Number(question.score || 0);
  const header = `
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-xs uppercase tracking-wide text-ocean-mid">${question.chapterLabel || '课程题目'} · ${questionTypeLabel(question.type)}</p>
        <h2 class="mt-2 text-lg font-semibold text-ocean-deep">${question.order}. ${question.stem}</h2>
      </div>
      <span class="inline-flex rounded-full bg-ocean-light/40 px-3 py-1 text-sm font-semibold text-ocean-deep">${score} 分</span>
    </div>
  `;

  let body = '';
  if (question.type === 'single' || question.type === 'true_false') {
    body = `
      <div class="space-y-3 mt-4">
        ${question.options.map((option) => `
          <label class="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 hover:border-ocean-mid transition">
            <input ${locked ? 'disabled' : ''} type="radio" name="${question.questionId}" value="${option.key}" ${answer?.responsePayload?.selected === option.key ? 'checked' : ''} class="mt-1 h-4 w-4 text-ocean-mid" />
            <span><span class="font-semibold text-ocean-deep">${option.key}.</span> ${option.text}</span>
          </label>
        `).join('')}
      </div>
    `;
  } else if (question.type === 'multiple') {
    const selected = new Set(answer?.responsePayload?.selectedList || []);
    body = `
      <div class="space-y-3 mt-4">
        ${question.options.map((option) => `
          <label class="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3 hover:border-ocean-mid transition">
            <input ${locked ? 'disabled' : ''} type="checkbox" name="${question.questionId}" value="${option.key}" ${selected.has(option.key) ? 'checked' : ''} class="mt-1 h-4 w-4 text-ocean-mid" />
            <span><span class="font-semibold text-ocean-deep">${option.key}.</span> ${option.text}</span>
          </label>
        `).join('')}
      </div>
    `;
  } else {
    const value = answer?.responsePayload?.text || (answer?.responsePayload?.blanks || [''])[0] || '';
    body = `
      <div class="mt-4">
        <textarea ${locked ? 'disabled' : ''} data-question-id="${question.questionId}" class="question-textarea min-h-[7rem] w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 focus:border-ocean-mid focus:outline-none focus:ring-2 focus:ring-ocean-mid/20">${value}</textarea>
      </div>
    `;
  }

  const feedback = currentAttempt?.status === 'graded' || currentAttempt?.status === 'returned'
    ? `
      <div class="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
        <p>系统得分：${answer?.autoScore ?? 0}</p>
        <p>人工得分：${answer?.manualScore ?? 0}</p>
        <p>最终得分：${answer?.finalScore ?? 0}</p>
        <p>教师评语：${answer?.manualComment || '暂无'}</p>
      </div>
    `
    : '';

  return `
    <article class="rounded-3xl bg-white border border-slate-200 shadow-sm p-6" data-question-card="${question.questionId}">
      ${header}
      ${body}
      ${feedback}
    </article>
  `;
}

function renderQuestions() {
  questionListEl.innerHTML = currentQuestions.map((question) => renderQuestion(question)).join('');
  bindQuestionInputs();
}

function collectResponsePayload(question) {
  if (question.type === 'single' || question.type === 'true_false') {
    const checked = document.querySelector(`input[name="${question.questionId}"]:checked`);
    return { selected: checked?.value || '' };
  }
  if (question.type === 'multiple') {
    const selectedList = Array.from(document.querySelectorAll(`input[name="${question.questionId}"]:checked`)).map((item) => item.value);
    return { selectedList };
  }
  const textarea = questionListEl.querySelector(`textarea[data-question-id="${question.questionId}"]`);
  const text = textarea?.value || '';
  if (question.type === 'fill_blank') {
    return { blanks: [text], text };
  }
  return { text };
}

async function queueSave(question) {
  if (!currentProfile || currentAttempt?.status !== 'draft') {
    return;
  }
  const payload = collectResponsePayload(question);
  currentAnswers.set(question.questionId, {
    questionId: question.questionId,
    questionType: question.type,
    responsePayload: payload,
    autoCorrect: null,
    autoScore: 0,
    manualScore: 0,
    finalScore: 0,
    manualComment: '',
  });
  setMessage(`正在保存第 ${question.order} 题…`);
  try {
    const attemptId = await saveAttemptAnswer({
      assignmentId: currentAssignment.assignmentId,
      profile: currentProfile,
      question,
      responsePayload: payload,
    });
    currentAttempt = { ...(currentAttempt || {}), id: attemptId, status: 'draft' };
    setMessage(`第 ${question.order} 题已自动保存。`, 'success');
  } catch (error) {
    setMessage(error?.message || '保存失败，请稍后再试。', 'error');
  }
}

function bindQuestionInputs() {
  currentQuestions.forEach((question) => {
    if (question.type === 'single' || question.type === 'true_false' || question.type === 'multiple') {
      const inputs = questionListEl.querySelectorAll(`input[name="${question.questionId}"]`);
      inputs.forEach((input) => {
        input.addEventListener('change', () => queueSave(question));
      });
      return;
    }
    const textarea = questionListEl.querySelector(`textarea[data-question-id="${question.questionId}"]`);
    textarea?.addEventListener('input', () => {
      const timer = saveTimers.get(question.questionId);
      if (timer) window.clearTimeout(timer);
      const nextTimer = window.setTimeout(() => queueSave(question), 500);
      saveTimers.set(question.questionId, nextTimer);
    });
  });
}

async function loadAttemptState() {
  currentAttempt = await ensureDraftAttempt({ assignmentId: currentAssignment.assignmentId, profile: currentProfile });
  const answers = await listAttemptAnswers(currentAttempt.id);
  currentAnswers = new Map(answers.map((answer) => [answer.questionId, answer]));
  attemptStatusEl.textContent = currentAttempt.status || '-';
}

submitBtn?.addEventListener('click', async () => {
  if (!currentAssignment) return;
  if (currentAttempt?.status !== 'draft') {
    setMessage('该作业已经提交，不能重复提交。', 'error');
    return;
  }
  setMessage('正在提交作业，请稍候…');
  try {
    const result = await callSubmitAssignmentAttempt(currentAssignment.assignmentId);
    currentAttempt = { ...currentAttempt, ...result, status: 'submitted' };
    attemptStatusEl.textContent = 'submitted';
    submitBtn.setAttribute('disabled', 'disabled');
    await loadAttemptState();
    renderQuestions();
    setMessage('作业已提交，当前为待教师批改状态。', 'success');
  } catch (error) {
    setMessage(error?.message || '提交失败，请稍后再试。', 'error');
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  if (!assignmentId) {
    assignmentTitleEl.textContent = '缺少 assignmentId';
    setMessage('请从学生中心进入具体作业。', 'error');
    submitBtn.setAttribute('disabled', 'disabled');
    return;
  }
  if (!user.emailVerified) {
    await signOut(auth).catch(() => {});
    window.location.href = 'login.html?verified=1';
    return;
  }

  const { profile } = await getUserContext({ ensureProfile: false });
  if (['teacher', 'admin'].includes(profile?.role || '')) {
    window.location.href = 'teacher-dashboard.html';
    return;
  }
  if (!profile?.classId) {
    window.location.href = 'student-center.html';
    return;
  }
  currentProfile = profile;

  const { assignment, questions } = await getAssignmentBundle(assignmentId);
  if (!assignment.targetClassIds.includes(profile.classId)) {
    setMessage('该作业不属于当前学生班级。', 'error');
    submitBtn.setAttribute('disabled', 'disabled');
    return;
  }

  currentAssignment = assignment;
  currentQuestions = questions;
  assignmentTitleEl.textContent = assignment.title;
  assignmentClassesEl.textContent = assignment.targetClassIds.join(', ');
  assignmentStartAtEl.textContent = formatDateTime(assignment.startAt);
  assignmentDueAtEl.textContent = formatDateTime(assignment.dueAt);
  assignmentDescriptionEl.textContent = assignment.description || '暂无作业说明。';

  await loadAttemptState();
  renderQuestions();
  if (currentAttempt?.status !== 'draft') {
    submitBtn.setAttribute('disabled', 'disabled');
    setMessage('该作业已提交，当前为只读状态。');
  }
});


