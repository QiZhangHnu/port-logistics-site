import {
  auth,
  clearPendingProfile,
  formatDateTime,
  getPendingProfile,
  getUserContext,
  onAuthStateChanged,
  signOut,
} from './firebase-core.js';
import {
  callClaimStudentProfile,
  listAssignmentsForProfile,
  listStudentAttempts,
} from './course-data.js';

const studentSummaryEl = document.getElementById('student-summary');
const studentRoleEl = document.getElementById('student-role');
const studentNameEl = document.getElementById('student-name');
const studentEmailEl = document.getElementById('student-email');
const studentNoEl = document.getElementById('student-no');
const studentClassEl = document.getElementById('student-class');
const claimForm = document.getElementById('claim-form');
const claimNameEl = document.getElementById('claim-name');
const claimStudentNoEl = document.getElementById('claim-student-no');
const claimClassIdEl = document.getElementById('claim-class-id');
const claimMessageEl = document.getElementById('claim-message');
const assignmentTableBody = document.getElementById('assignment-table-body');
const attemptTableBody = document.getElementById('attempt-table-body');
const refreshAssignmentsBtn = document.getElementById('refresh-assignments-btn');
const refreshAttemptsBtn = document.getElementById('refresh-attempts-btn');
const signoutBtn = document.getElementById('signout-btn');

let currentProfile = null;
let currentAttempts = [];

function setClaimMessage(message, tone = 'info') {
  if (!claimMessageEl) return;
  claimMessageEl.textContent = message || '';
  claimMessageEl.classList.remove('text-red-600', 'text-emerald-600', 'text-slate-600');
  if (!message) {
    claimMessageEl.classList.add('text-slate-600');
    return;
  }
  if (tone === 'error') claimMessageEl.classList.add('text-red-600');
  else if (tone === 'success') claimMessageEl.classList.add('text-emerald-600');
  else claimMessageEl.classList.add('text-slate-600');
}

function renderProfile(profile, user) {
  currentProfile = profile;
  studentSummaryEl.textContent = profile?.classId
    ? `当前已绑定学号 ${profile.studentNo}，可查看作业与成绩。`
    : '当前账号尚未绑定学生身份，请先完成学号和班级绑定。';
  studentRoleEl.textContent = profile?.role || '-';
  studentNameEl.textContent = profile?.name || '-';
  studentEmailEl.textContent = user?.email || '-';
  studentNoEl.textContent = profile?.studentNo || '未绑定';
  studentClassEl.textContent = profile?.classId || '未绑定';

  const pending = getPendingProfile();
  claimNameEl.value = profile?.name || pending?.name || '';
  claimStudentNoEl.value = profile?.studentNo || pending?.studentNo || '';
  claimClassIdEl.value = profile?.classId || pending?.classId || '';

  const locked = Boolean(profile?.studentNo && profile?.classId);
  claimStudentNoEl.toggleAttribute('disabled', locked);
  claimClassIdEl.toggleAttribute('disabled', locked);
}

function renderAssignments(assignments) {
  if (!assignmentTableBody) return;
  if (!assignments.length) {
    assignmentTableBody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-500">当前班级暂无作业。</td></tr>';
    return;
  }
  const attemptMap = new Map(currentAttempts.map((item) => [item.assignmentId, item]));
  assignmentTableBody.innerHTML = assignments.map((assignment) => {
    const attempt = attemptMap.get(assignment.assignmentId);
    const statusLabel = attempt ? attempt.status : (assignment.visibility === 'closed' ? 'closed' : '未开始');
    return `
      <tr>
        <td class="py-4 pr-4 align-top">
          <p class="font-semibold text-ocean-deep">${assignment.title}</p>
          <p class="mt-1 text-xs text-slate-500">${assignment.assignmentId}</p>
        </td>
        <td class="py-4 pr-4 align-top">${formatDateTime(assignment.startAt)}</td>
        <td class="py-4 pr-4 align-top">${formatDateTime(assignment.dueAt)}</td>
        <td class="py-4 pr-4 align-top">${statusLabel}</td>
        <td class="py-4 align-top"><a class="text-ocean-mid font-semibold hover:text-ocean-deep" href="assignment.html?assignmentId=${encodeURIComponent(assignment.assignmentId)}">进入作业</a></td>
      </tr>
    `;
  }).join('');
}

function renderAttempts(attempts) {
  if (!attemptTableBody) return;
  if (!attempts.length) {
    attemptTableBody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-500">还没有作答记录。</td></tr>';
    return;
  }
  attemptTableBody.innerHTML = attempts.map((attempt) => `
    <tr>
      <td class="py-4 pr-4 align-top font-semibold text-ocean-deep">${attempt.assignmentId}</td>
      <td class="py-4 pr-4 align-top">${formatDateTime(attempt.submittedAt)}</td>
      <td class="py-4 pr-4 align-top">${attempt.status}</td>
      <td class="py-4 pr-4 align-top">${attempt.totalScore ?? 0}</td>
      <td class="py-4 pr-4 align-top">${attempt.subjectivePendingCount ?? 0}</td>
    </tr>
  `).join('');
}

async function refreshAttempts() {
  if (!currentProfile) return;
  currentAttempts = await listStudentAttempts({ id: currentProfile.id });
  renderAttempts(currentAttempts);
}

async function refreshAssignments() {
  if (!currentProfile?.classId) {
    renderAssignments([]);
    return;
  }
  const assignments = await listAssignmentsForProfile(currentProfile);
  renderAssignments(assignments);
}

claimForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    name: claimNameEl.value.trim(),
    studentNo: claimStudentNoEl.value.trim().toUpperCase(),
    classId: claimClassIdEl.value.trim().toUpperCase(),
  };
  if (!payload.name || !payload.studentNo || !payload.classId) {
    setClaimMessage('请完整填写姓名、学号和班级编号。', 'error');
    return;
  }
  setClaimMessage('正在保存学生身份…');
  try {
    await callClaimStudentProfile(payload);
    clearPendingProfile();
    const { profile, user } = await getUserContext({ ensureProfile: false });
    renderProfile(profile, user);
    await refreshAssignments();
    await refreshAttempts();
    setClaimMessage('学生身份已绑定。', 'success');
  } catch (error) {
    setClaimMessage(error?.message || '保存失败，请稍后再试。', 'error');
  }
});

refreshAssignmentsBtn?.addEventListener('click', () => refreshAssignments());
refreshAttemptsBtn?.addEventListener('click', () => refreshAttempts());
signoutBtn?.addEventListener('click', async () => {
  await signOut(auth).catch(() => {});
  window.location.href = 'login.html';
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  if (!user.emailVerified) {
    await signOut(auth).catch(() => {});
    window.location.href = 'login.html?verified=1';
    return;
  }
  const { profile } = await getUserContext({ ensureProfile: false });
  if (profile?.status === 'disabled') {
    await signOut(auth).catch(() => {});
    window.location.href = 'login.html';
    return;
  }
  if (profile?.role && profile.role !== 'student') {
    window.location.href = 'teacher-dashboard.html';
    return;
  }
  renderProfile(profile, user);
  await refreshAttempts();
  await refreshAssignments();
});

