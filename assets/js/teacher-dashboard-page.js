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
  callAdminSetUserProfile,
  createAssignmentRecord,
  getAttemptReviewBundle,
  importQuestionBank,
  listAssignmentAttempts,
  listAssignmentsForProfile,
  listCourseClasses,
  listQuestionItems,
  listUsersByFilters,
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
const teacherSignoutBtn = document.getElementById('teacher-signout-btn');

const state = {
  profile: null,
  classes: [],
  students: [],
  questions: [],
  assignments: [],
  attemptsByAssignmentId: new Map(),
  selectedQuestionIds: new Set(),
  selectedAttemptId: '',
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
  state.questions = await listQuestionItems({ keyword: questionSearchInput.value, type: questionTypeFilter.value });
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
    analyticsPanel.textContent = '请选择作业后查看提交、批改和错因分析。';
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
    analyticsPanel.innerHTML = `
      <p class="font-semibold text-ocean-deep">${analytics.assignmentTitle}</p>
      <p class="mt-2">提交人数：${analytics.submissionCount}，平均分：${analytics.avgScore}，客观题正确率：${analytics.correctRate}%</p>
      <p class="mt-1">未提交人数：${analytics.unsubmittedStudents}，主观题待批改：${analytics.pendingManualReview}</p>
      <p class="mt-3 font-semibold text-ocean-deep">错题知识点 TopN</p>
      <p class="mt-1">${analytics.wrongKnowledgePointTopN.map((item) => `${item.key} (${item.count})`).join('，') || '暂无'}</p>
      <p class="mt-3 font-semibold text-ocean-deep">薄弱能力 TopN</p>
      <p class="mt-1">${analytics.wrongAbilityTopN.map((item) => `${item.key} (${item.count})`).join('，') || '暂无'}</p>
    `;
  }
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
teacherSignoutBtn?.addEventListener('click', async () => {
  await signOut(auth).catch(() => {});
  window.location.href = 'login.html';
});

document.getElementById('refresh-classes-btn')?.addEventListener('click', () => refreshClasses());
document.getElementById('refresh-students-btn')?.addEventListener('click', () => refreshStudents());
document.getElementById('refresh-question-bank-btn')?.addEventListener('click', () => refreshQuestionBank());
document.getElementById('refresh-assignments-dashboard-btn')?.addEventListener('click', () => refreshAssignments());

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
  if (state.profile.role !== 'admin') {
    classForm?.querySelectorAll('input,select,button').forEach((el) => el.setAttribute('disabled', 'disabled'));
    studentEditorForm?.querySelectorAll('input,select,button').forEach((el) => el.setAttribute('disabled', 'disabled'));
  }
  await refreshClasses();
  await refreshStudents();
  await refreshQuestionBank();
  await refreshAssignments();
  analyticsPanel.textContent = '请选择作业后查看提交、批改和错因分析。';
});
