import {
  COURSE_ID,
  auth,
  collection,
  db,
  doc,
  formatDateTime,
  fromDateTimeLocalInputValue,
  getDoc,
  getDocs,
  getExistingUserProfile,
  orderBy,
  query,
  roleLabel,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from './firebase-core.js';
import { buildQuestionSeedFromPracticePages } from './question-importer.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactText(value) {
  return String(value || '').trim();
}

function uniqueById(records) {
  const map = new Map();
  for (const record of records) {
    if (record?.id) {
      map.set(record.id, record);
    }
  }
  return Array.from(map.values());
}

function mergeSnapshotDocs(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export function buildAttemptId(assignmentId, uid) {
  return `${assignmentId}__${uid}`;
}

export function buildPracticeAttemptId(pageId, uid) {
  return `practice__${pageId}__${uid}`;
}

function requireCurrentUid() {
  const uid = auth.currentUser?.uid || '';
  if (!uid) {
    throw new Error('未检测到登录状态，请重新登录。');
  }
  return uid;
}

function buildEmptyResponsePayload(questionType) {
  if (questionType === 'multiple') {
    return { selectedList: [] };
  }
  if (questionType === 'fill_blank') {
    return { blanks: [''], text: '' };
  }
  if (questionType === 'single' || questionType === 'true_false') {
    return { selected: '' };
  }
  return { text: '' };
}

function normalizeOptionToken(value) {
  return compactText(value).replace(/\s+/g, '').toUpperCase();
}

function normalizeFreeText(value) {
  return compactText(value).replace(/\s+/g, '').toLowerCase();
}

function normalizeTrueFalseToken(value) {
  const token = normalizeOptionToken(value);
  if (['T', 'TRUE', 'Y', 'YES', '对', '√'].includes(token)) return 'T';
  if (['F', 'FALSE', 'N', 'NO', '错', '×', 'X'].includes(token)) return 'F';
  return token;
}

function hasSameMembers(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }
  return true;
}

function flattenBlankMatchers(blankMatchers = []) {
  return asArray(blankMatchers).map((group) => asArray(group).map((item) => normalizeFreeText(item)).filter(Boolean));
}

export function practicePageQuestionPrefix(pageId) {
  return {
    'all-single-choice': 'all-single-',
    'all-multiple-choice': 'all-multiple-',
    'all-fill-in': 'all-fill-',
    'all-true-false': 'all-tf-',
    'all-short-answer': 'all-short-',
  }[compactText(pageId)] || '';
}

export function formatPracticeResponsePayload(questionType, responsePayload = {}) {
  if (questionType === 'multiple') {
    const selectedList = asArray(responsePayload.selectedList).filter(Boolean);
    return selectedList.length ? selectedList.join(', ') : '未作答';
  }
  if (questionType === 'single' || questionType === 'true_false') {
    return compactText(responsePayload.selected) || '未作答';
  }
  if (questionType === 'fill_blank') {
    const blanks = asArray(responsePayload.blanks).filter((item) => compactText(item));
    if (blanks.length) {
      return blanks.join(' / ');
    }
  }
  return compactText(responsePayload.text) || '未作答';
}

export function formatPracticeExpectedAnswer(questionType, questionKey = {}) {
  if (questionType === 'multiple') {
    const answers = asArray(questionKey.correctAnswer).filter(Boolean);
    return answers.length ? answers.join(', ') : '无标准答案';
  }
  if (questionType === 'single' || questionType === 'true_false') {
    return compactText(questionKey.correctAnswer) || '无标准答案';
  }
  if (questionType === 'fill_blank') {
    const groups = flattenBlankMatchers(questionKey.blankMatchers);
    if (groups.length) {
      return groups.map((group) => group.join(' / ')).join('；');
    }
    return compactText(questionKey.correctAnswer) || '无标准答案';
  }
  return compactText(questionKey.subjectiveRubric || questionKey.explanation) || '主观题，需教师判断';
}

export function evaluatePracticeAnswer({ answer, questionKey }) {
  const questionType = compactText(answer?.questionType);
  const payload = answer?.responsePayload || {};

  if (!questionKey || questionType === 'short_answer') {
    return { autoCorrect: null, objective: false };
  }

  if (questionType === 'multiple') {
    const expectedSet = new Set(asArray(questionKey.correctAnswer).map((item) => normalizeOptionToken(item)).filter(Boolean));
    const selectedSet = new Set(asArray(payload.selectedList).map((item) => normalizeOptionToken(item)).filter(Boolean));
    if (!expectedSet.size) {
      return { autoCorrect: null, objective: true };
    }
    return { autoCorrect: hasSameMembers(selectedSet, expectedSet), objective: true };
  }

  if (questionType === 'single') {
    const expected = normalizeOptionToken(questionKey.correctAnswer);
    if (!expected) {
      return { autoCorrect: null, objective: true };
    }
    return { autoCorrect: normalizeOptionToken(payload.selected) === expected, objective: true };
  }

  if (questionType === 'true_false') {
    const expected = normalizeTrueFalseToken(questionKey.correctAnswer);
    if (!expected) {
      return { autoCorrect: null, objective: true };
    }
    return { autoCorrect: normalizeTrueFalseToken(payload.selected) === expected, objective: true };
  }

  if (questionType === 'fill_blank') {
    const responseBlanks = asArray(payload.blanks).length
      ? asArray(payload.blanks)
      : [payload.text];
    const normalizedResponses = responseBlanks.map((item) => normalizeFreeText(item)).filter((item) => item !== '');
    if (!normalizedResponses.length) {
      return { autoCorrect: false, objective: true };
    }
    const matcherGroups = flattenBlankMatchers(questionKey.blankMatchers);
    if (matcherGroups.length) {
      const groups = matcherGroups.length === normalizedResponses.length
        ? matcherGroups
        : [matcherGroups.flat()];
      const autoCorrect = normalizedResponses.every((item, index) => (groups[index] || []).includes(item));
      return { autoCorrect, objective: true };
    }
    const expected = normalizeFreeText(questionKey.correctAnswer);
    if (!expected) {
      return { autoCorrect: null, objective: true };
    }
    return { autoCorrect: normalizedResponses[0] === expected, objective: true };
  }

  return { autoCorrect: null, objective: false };
}

export async function callClaimStudentProfile(payload) {
  const uid = requireCurrentUid();
  const name = compactText(payload?.name);
  const studentNo = compactText(payload?.studentNo).toUpperCase();
  const classId = compactText(payload?.classId).toUpperCase();
  if (!name || !studentNo || !classId) {
    throw new Error('请完整填写姓名、学号和班级编号。');
  }

  const ref = doc(db, 'users', uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new Error('未找到当前账号资料，请重新登录后再试。');
  }

  const profile = snapshot.data();
  if (profile.role !== 'student') {
    throw new Error('当前账号不是学生身份，不能绑定学号。');
  }
  const boundStudentNo = compactText(profile.studentNo).toUpperCase();
  const boundClassId = compactText(profile.classId).toUpperCase();
  if (boundStudentNo && boundClassId && (boundStudentNo !== studentNo || boundClassId !== classId)) {
    throw new Error('该账号已绑定学号和班级，不能直接改绑，请联系管理员。');
  }

  await updateDoc(ref, {
    name,
    studentNo: boundStudentNo || studentNo,
    classId: boundClassId || classId,
    updatedAt: serverTimestamp(),
  });

  const updated = await getDoc(ref);
  return { ok: true, profile: { id: updated.id, ...updated.data() } };
}

export async function callSubmitAssignmentAttempt(assignmentId) {
  const uid = requireCurrentUid();
  const profile = await getExistingUserProfile(uid);
  if (!profile || profile.role !== 'student') {
    throw new Error('只有学生账号可以提交作业。');
  }

  const { assignment, questions } = await getAssignmentBundle(assignmentId);
  if (assignment.visibility !== 'published') {
    throw new Error('当前作业不可提交。');
  }
  if (!asArray(assignment.targetClassIds).includes(profile.classId || '')) {
    throw new Error('该作业不属于当前学生班级。');
  }

  const attempt = await ensureDraftAttempt({
    assignmentId,
    profile: { id: uid, ...profile },
  });
  if (attempt.status !== 'draft') {
    throw new Error('该作业已经提交，不能重复提交。');
  }

  const existingAnswers = await listAttemptAnswers(attempt.id);
  const answerMap = new Map(existingAnswers.map((answer) => [answer.questionId, answer]));
  const batch = writeBatch(db);
  let manualPendingCount = 0;

  for (const question of questions) {
    const answerRef = doc(db, 'courses', COURSE_ID, 'attempts', attempt.id, 'answers', question.questionId);
    const existing = answerMap.get(question.questionId);
    const responsePayload = existing?.responsePayload || buildEmptyResponsePayload(question.type);
    manualPendingCount += 1;

    if (existing) {
      batch.update(answerRef, {
        responsePayload,
        needsManualReview: true,
        locked: true,
        savedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
      });
    } else {
      batch.set(answerRef, {
        questionId: question.questionId,
        questionType: question.type,
        responsePayload,
        autoCorrect: null,
        autoScore: 0,
        manualScore: 0,
        finalScore: 0,
        needsManualReview: true,
        manualComment: '',
        gradedBy: null,
        gradedAt: null,
        locked: true,
        savedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
      });
    }
  }

  batch.update(doc(db, 'courses', COURSE_ID, 'attempts', attempt.id), {
    status: 'submitted',
    objectivePendingCount: 0,
    subjectivePendingCount: manualPendingCount,
    lastSavedAt: serverTimestamp(),
    submittedAt: serverTimestamp(),
  });
  await batch.commit();

  const submitted = await getDoc(doc(db, 'courses', COURSE_ID, 'attempts', attempt.id));
  return submitted.exists()
    ? { id: submitted.id, ...submitted.data() }
    : { attemptId: attempt.id, status: 'submitted' };
}

export async function callAdminSetUserProfile(payload) {
  const uid = compactText(payload?.uid);
  if (!uid) {
    throw new Error('缺少用户 uid。');
  }

  const role = compactText(payload?.role) || 'student';
  if (!['student', 'teacher', 'admin'].includes(role)) {
    throw new Error('角色字段不合法。');
  }
  const status = compactText(payload?.status) || 'active';
  if (!['active', 'disabled'].includes(status)) {
    throw new Error('账号状态不合法。');
  }

  const assignedClassIds = role === 'teacher'
    ? asArray(payload?.assignedClassIds).map((item) => compactText(item).toUpperCase()).filter(Boolean)
    : [];
  const nextStudentNo = role === 'student' ? compactText(payload?.studentNo).toUpperCase() : '';
  const nextClassId = role === 'student' ? compactText(payload?.classId).toUpperCase() : '';

  await updateDoc(doc(db, 'users', uid), {
    name: compactText(payload?.name),
    role,
    status,
    studentNo: nextStudentNo || null,
    classId: nextClassId || null,
    assignedClassIds,
    updatedAt: serverTimestamp(),
  });

  const updated = await getDoc(doc(db, 'users', uid));
  return updated.exists() ? { id: updated.id, ...updated.data() } : null;
}

export async function listCourseClasses(profile) {
  if (!profile) {
    return [];
  }
  if (profile.role === 'admin') {
    const snapshot = await getDocs(query(collection(db, 'courses', COURSE_ID, 'classes'), orderBy('name')));
    return mergeSnapshotDocs(snapshot);
  }
  if (profile.role === 'teacher') {
    const refs = await Promise.all(asArray(profile.assignedClassIds).map(async (classId) => {
      const snapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'classes', classId));
      return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
    }));
    return refs.filter(Boolean);
  }
  if (profile.classId) {
    const snapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'classes', profile.classId));
    return snapshot.exists() ? [{ id: snapshot.id, ...snapshot.data() }] : [];
  }
  return [];
}

export async function saveClassRecord(payload) {
  const classId = compactText(payload.classId).toUpperCase();
  if (!classId) {
    throw new Error('请填写班级编号。');
  }
  const ref = doc(db, 'courses', COURSE_ID, 'classes', classId);
  const existing = await getDoc(ref);
  await setDoc(ref, {
    classId,
    name: compactText(payload.name),
    grade: compactText(payload.grade),
    term: compactText(payload.term),
    teacherUids: asArray(payload.teacherUids).map((item) => compactText(item)).filter(Boolean),
    studentCount: Number(payload.studentCount || existing.data()?.studentCount || 0),
    status: payload.status || 'active',
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function listUsersByFilters({ profile, classId, status, keyword, roles = [] }) {
  if (!profile) {
    return [];
  }

  const requestedClassId = compactText(classId).toUpperCase();
  if (profile.role === 'teacher' && requestedClassId && !asArray(profile.assignedClassIds).includes(requestedClassId)) {
    return [];
  }

  const constraints = [];
  if (requestedClassId) {
    constraints.push(where('classId', '==', requestedClassId));
  }
  if (roles.length === 1) {
    constraints.push(where('role', '==', roles[0]));
  }
  const snapshot = await getDocs(query(collection(db, 'users'), ...constraints, orderBy('createdAt', 'desc')));
  const rows = mergeSnapshotDocs(snapshot);
  const roleSet = roles.length ? new Set(roles) : null;
  const keywordValue = compactText(keyword).toLowerCase();

  return rows.filter((row) => {
    if (profile.role === 'teacher' && row.classId && !asArray(profile.assignedClassIds).includes(row.classId)) {
      return false;
    }
    if (status && row.status !== status) {
      return false;
    }
    if (roleSet && !roleSet.has(row.role)) {
      return false;
    }
    if (!keywordValue) {
      return true;
    }
    const haystack = [row.name, row.studentNo, row.email, row.classId].map((item) => compactText(item).toLowerCase()).join(' ');
    return haystack.includes(keywordValue);
  });
}

export async function listQuestionItems(filters = {}) {
  const snapshot = await getDocs(query(collection(db, 'courses', COURSE_ID, 'question_items'), orderBy('questionId')));
  const rows = mergeSnapshotDocs(snapshot);
  const keyword = compactText(filters.keyword).toLowerCase();
  return rows.filter((row) => {
    if (filters.type && row.type !== filters.type) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    const haystack = [row.questionId, row.stem, row.chapterLabel, row.chapterCode].map((item) => compactText(item).toLowerCase()).join(' ');
    return haystack.includes(keyword);
  });
}

export async function listQuestionKeysByPrefix(prefix = '') {
  const normalizedPrefix = compactText(prefix);
  const snapshot = await getDocs(query(collection(db, 'courses', COURSE_ID, 'question_keys'), orderBy('questionId')));
  const rows = mergeSnapshotDocs(snapshot);
  if (!normalizedPrefix) {
    return rows;
  }
  return rows.filter((row) => compactText(row.questionId).startsWith(normalizedPrefix));
}

export async function importQuestionBank() {
  const seed = await buildQuestionSeedFromPracticePages();
  const courseDocRef = doc(db, 'courses', COURSE_ID);
  let batch = writeBatch(db);
  let opCount = 0;

  const flush = async () => {
    if (opCount === 0) {
      return;
    }
    await batch.commit();
    batch = writeBatch(db);
    opCount = 0;
  };

  batch.set(courseDocRef, {
    code: COURSE_ID,
    title: '港口物流',
    status: 'active',
    currentTerm: '2025-2026-2',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  opCount += 1;

  for (const { questionItem, questionKey } of seed) {
    batch.set(doc(db, 'courses', COURSE_ID, 'question_items', questionItem.questionId), {
      ...questionItem,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    batch.set(doc(db, 'courses', COURSE_ID, 'question_keys', questionKey.questionId), {
      ...questionKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    opCount += 2;
    if (opCount >= 380) {
      await flush();
    }
  }

  await flush();
  return { importedCount: seed.length };
}

export async function listAssignmentsForProfile(profile) {
  if (!profile) {
    return [];
  }

  const rows = [];
  const col = collection(db, 'courses', COURSE_ID, 'assignments');

  if (profile.role === 'student' && profile.classId) {
    const snapshot = await getDocs(query(col, where('targetClassIds', 'array-contains', profile.classId), orderBy('dueAt', 'desc')));
    return mergeSnapshotDocs(snapshot).filter((item) => ['published', 'closed'].includes(item.visibility));
  }

  if (profile.role === 'admin') {
    const snapshot = await getDocs(query(col, orderBy('dueAt', 'desc')));
    return mergeSnapshotDocs(snapshot);
  }

  for (const classId of asArray(profile.assignedClassIds)) {
    const snapshot = await getDocs(query(col, where('targetClassIds', 'array-contains', classId), orderBy('dueAt', 'desc')));
    rows.push(...mergeSnapshotDocs(snapshot));
  }
  return uniqueById(rows).sort((left, right) => {
    const leftTime = left.dueAt?.seconds || 0;
    const rightTime = right.dueAt?.seconds || 0;
    return rightTime - leftTime;
  });
}

export async function createAssignmentRecord({ profile, payload, selectedQuestions }) {
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    throw new Error('只有教师或管理员可以创建作业。');
  }
  const targetClassIds = asArray(payload.targetClassIds).map((item) => compactText(item).toUpperCase()).filter(Boolean);
  if (!targetClassIds.length) {
    throw new Error('请至少选择一个班级。');
  }
  if (profile.role === 'teacher') {
    const allowedClasses = new Set(asArray(profile.assignedClassIds).map((item) => compactText(item).toUpperCase()));
    const unauthorizedClass = targetClassIds.find((item) => !allowedClasses.has(item));
    if (unauthorizedClass) {
      throw new Error(`你无权向班级 ${unauthorizedClass} 发布作业。`);
    }
  }
  if (!selectedQuestions.length) {
    throw new Error('请至少选择一道题目。');
  }

  const assignmentId = `asg-${Date.now()}`;
  const createdAt = serverTimestamp();
  const questionCount = selectedQuestions.length;
  const objectiveTotalScore = selectedQuestions.filter((item) => item.type !== 'short_answer').reduce((sum, item) => sum + Number(item.score), 0);
  const subjectiveTotalScore = selectedQuestions.filter((item) => item.type === 'short_answer').reduce((sum, item) => sum + Number(item.score), 0);
  const totalScore = objectiveTotalScore + subjectiveTotalScore;

  await setDoc(doc(db, 'courses', COURSE_ID, 'assignments', assignmentId), {
    assignmentId,
    title: compactText(payload.title),
    description: compactText(payload.description),
    targetClassIds,
    visibility: payload.visibility,
    startAt: fromDateTimeLocalInputValue(payload.startAt),
    dueAt: fromDateTimeLocalInputValue(payload.dueAt),
    allowLateSubmit: false,
    resultReleasePolicy: payload.resultReleasePolicy,
    questionCount,
    objectiveTotalScore,
    subjectiveTotalScore,
    totalScore,
    createdBy: profile.id,
    createdAt,
    updatedAt: serverTimestamp(),
  });

  let batch = writeBatch(db);
  let opCount = 0;
  const flush = async () => {
    if (!opCount) {
      return;
    }
    await batch.commit();
    batch = writeBatch(db);
    opCount = 0;
  };

  selectedQuestions.forEach((item, index) => {
    batch.set(doc(db, 'courses', COURSE_ID, 'assignments', assignmentId, 'items', item.questionId), {
      itemId: item.questionId,
      questionId: item.questionId,
      order: index + 1,
      score: Number(item.score),
      required: true,
      sectionTitle: null,
    }, { merge: true });
    opCount += 1;
  });

  await flush();
  return assignmentId;
}

export async function getAssignmentBundle(assignmentId) {
  const assignmentSnapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'assignments', assignmentId));
  if (!assignmentSnapshot.exists()) {
    throw new Error('未找到该作业。');
  }
  const assignment = { id: assignmentSnapshot.id, ...assignmentSnapshot.data() };
  const itemSnapshot = await getDocs(query(collection(db, 'courses', COURSE_ID, 'assignments', assignmentId, 'items'), orderBy('order')));
  const items = mergeSnapshotDocs(itemSnapshot);
  const questions = await Promise.all(items.map(async (item) => {
    const snapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'question_items', item.questionId));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data(), score: item.score, order: item.order } : null;
  }));
  return { assignment, items, questions: questions.filter(Boolean) };
}

export async function ensureDraftAttempt({ assignmentId, profile }) {
  const attemptId = buildAttemptId(assignmentId, profile.id);
  const ref = doc(db, 'courses', COURSE_ID, 'attempts', attemptId);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...snapshot.data() };
  }
  await setDoc(ref, {
    attemptId,
    assignmentId,
    uid: profile.id,
    studentNo: profile.studentNo || '',
    studentName: profile.name || '',
    classId: profile.classId || '',
    status: 'draft',
    objectiveScore: 0,
    subjectiveScore: 0,
    totalScore: 0,
    objectivePendingCount: 0,
    subjectivePendingCount: 0,
    teacherFeedback: '',
    startedAt: serverTimestamp(),
    lastSavedAt: null,
    submittedAt: null,
    gradedAt: null,
    graderUid: null,
    resultReleasedAt: null,
  });
  const created = await getDoc(ref);
  return { id: created.id, ...created.data() };
}

export async function listAttemptAnswers(attemptId) {
  const snapshot = await getDocs(collection(db, 'courses', COURSE_ID, 'attempts', attemptId, 'answers'));
  return mergeSnapshotDocs(snapshot);
}

export async function saveAttemptAnswer({ assignmentId, profile, question, responsePayload }) {
  const attempt = await ensureDraftAttempt({ assignmentId, profile });
  if (attempt.status !== 'draft') {
    throw new Error('该作业已提交，不能继续修改。');
  }
  const attemptId = attempt.id;
  await setDoc(doc(db, 'courses', COURSE_ID, 'attempts', attemptId, 'answers', question.questionId), {
    questionId: question.questionId,
    questionType: question.type,
    responsePayload,
    autoCorrect: null,
    autoScore: 0,
    manualScore: 0,
    finalScore: 0,
    needsManualReview: false,
    manualComment: '',
    gradedBy: null,
    gradedAt: null,
    locked: false,
    savedAt: serverTimestamp(),
    submittedAt: null,
  }, { merge: true });
  await updateDoc(doc(db, 'courses', COURSE_ID, 'attempts', attemptId), { lastSavedAt: serverTimestamp() });
  return attemptId;
}


export async function ensurePracticeAttempt({ pageId, profile }) {
  const normalizedPageId = compactText(pageId);
  if (!normalizedPageId) {
    throw new Error('Missing practice page id.');
  }
  const attemptId = buildPracticeAttemptId(normalizedPageId, profile.id);
  const ref = doc(db, 'courses', COURSE_ID, 'practice_attempts', attemptId);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...snapshot.data() };
  }

  await setDoc(ref, {
    attemptId,
    pageId: normalizedPageId,
    uid: profile.id,
    studentNo: profile.studentNo || '',
    studentName: profile.name || '',
    classId: profile.classId || '',
    status: 'in_progress',
    startedAt: serverTimestamp(),
    lastSavedAt: null,
    updatedAt: serverTimestamp(),
  });

  const created = await getDoc(ref);
  return { id: created.id, ...created.data() };
}

export async function listPracticeAnswers(attemptId) {
  const snapshot = await getDocs(collection(db, 'courses', COURSE_ID, 'practice_attempts', attemptId, 'answers'));
  return mergeSnapshotDocs(snapshot);
}

export async function listPracticeAttempts({ pageId = '', classId = '' } = {}) {
  const snapshot = await getDocs(query(collection(db, 'courses', COURSE_ID, 'practice_attempts'), orderBy('updatedAt', 'desc')));
  let rows = mergeSnapshotDocs(snapshot);
  if (pageId) {
    rows = rows.filter((row) => row.pageId === pageId);
  }
  if (classId) {
    rows = rows.filter((row) => row.classId === classId);
  }
  return rows;
}

export async function savePracticeAnswer({
  attemptId,
  questionId,
  questionType,
  responsePayload,
  answerRevealed = false,
}) {
  const normalizedAttemptId = compactText(attemptId);
  const normalizedQuestionId = compactText(questionId);
  if (!normalizedAttemptId || !normalizedQuestionId) {
    throw new Error('Missing attemptId or questionId.');
  }

  await setDoc(doc(db, 'courses', COURSE_ID, 'practice_attempts', normalizedAttemptId, 'answers', normalizedQuestionId), {
    questionId: normalizedQuestionId,
    questionType: compactText(questionType) || 'short_answer',
    responsePayload: responsePayload || {},
    answerRevealed: Boolean(answerRevealed),
    answerRevealedAt: answerRevealed ? serverTimestamp() : null,
    savedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await updateDoc(doc(db, 'courses', COURSE_ID, 'practice_attempts', normalizedAttemptId), {
    lastSavedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function getPracticeReviewBundle(attemptId, { questionMap = new Map(), questionKeyMap = new Map() } = {}) {
  const attemptSnapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'practice_attempts', attemptId));
  if (!attemptSnapshot.exists()) {
    throw new Error('未找到练习记录。');
  }
  const attempt = { id: attemptSnapshot.id, ...attemptSnapshot.data() };
  const answers = await listPracticeAnswers(attemptId);
  const questionIds = Array.from(new Set(answers.map((answer) => answer.questionId).filter(Boolean)));

  const missingQuestionIds = questionIds.filter((questionId) => !questionMap.has(questionId));
  await Promise.all(missingQuestionIds.map(async (questionId) => {
    const snapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'question_items', questionId));
    if (snapshot.exists()) {
      questionMap.set(questionId, { id: snapshot.id, ...snapshot.data() });
    }
  }));

  const missingQuestionKeyIds = questionIds.filter((questionId) => !questionKeyMap.has(questionId));
  await Promise.all(missingQuestionKeyIds.map(async (questionId) => {
    const snapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'question_keys', questionId));
    if (snapshot.exists()) {
      questionKeyMap.set(questionId, { id: snapshot.id, ...snapshot.data() });
    }
  }));

  return {
    attempt,
    answers,
    questions: questionIds.map((questionId) => questionMap.get(questionId)).filter(Boolean),
    questionKeys: questionIds.map((questionId) => questionKeyMap.get(questionId)).filter(Boolean),
  };
}

export async function listStudentAttempts(profile) {
  if (!profile?.id) {
    return [];
  }
  const snapshot = await getDocs(query(collection(db, 'courses', COURSE_ID, 'attempts'), where('uid', '==', profile.id), orderBy('submittedAt', 'desc')));
  return mergeSnapshotDocs(snapshot);
}

export async function listAssignmentAttempts({ assignmentId, classId, status }) {
  if (!assignmentId) {
    return [];
  }
  const constraints = [where('assignmentId', '==', assignmentId)];
  if (classId) {
    constraints.push(where('classId', '==', classId));
  }
  const snapshot = await getDocs(query(collection(db, 'courses', COURSE_ID, 'attempts'), ...constraints, orderBy('submittedAt', 'desc')));
  let rows = mergeSnapshotDocs(snapshot);
  if (status) {
    rows = rows.filter((row) => row.status === status);
  }
  return rows;
}

export async function getAttemptReviewBundle(attemptId) {
  const attemptSnapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'attempts', attemptId));
  if (!attemptSnapshot.exists()) {
    throw new Error('未找到作答记录。');
  }
  const attempt = { id: attemptSnapshot.id, ...attemptSnapshot.data() };
  const answers = await listAttemptAnswers(attemptId);
  const assignmentSnapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'assignments', attempt.assignmentId));
  const assignment = assignmentSnapshot.exists() ? { id: assignmentSnapshot.id, ...assignmentSnapshot.data() } : null;
  const questions = await Promise.all(answers.map(async (answer) => {
    const snapshot = await getDoc(doc(db, 'courses', COURSE_ID, 'question_items', answer.questionId));
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  }));
  return { attempt, assignment, answers, questions: questions.filter(Boolean) };
}

export async function saveManualReview({ profile, attempt, answers, reviewMap, teacherFeedback }) {
  const batch = writeBatch(db);
  let objectiveScore = 0;
  let subjectiveScore = 0;
  let pendingCount = 0;
  let totalScore = 0;

  for (const answer of answers) {
    const review = reviewMap.get(answer.questionId) || {};
    const isSubjective = answer.questionType === 'short_answer';
    const manualScore = Number(review.manualScore ?? answer.manualScore ?? 0);
    const needsManualReview = Boolean(review.needsManualReview);
    const finalScore = Number(answer.autoScore || 0) + manualScore;

    if (isSubjective) {
      subjectiveScore += manualScore;
    } else {
      objectiveScore += finalScore;
    }
    if (needsManualReview) {
      pendingCount += 1;
    }
    totalScore += finalScore;

    batch.update(doc(db, 'courses', COURSE_ID, 'attempts', attempt.id, 'answers', answer.questionId), {
      manualScore,
      finalScore,
      needsManualReview,
      manualComment: compactText(review.manualComment ?? answer.manualComment ?? ''),
      gradedBy: profile.id,
      gradedAt: serverTimestamp(),
    });
  }

  const nextStatus = pendingCount === 0 ? 'graded' : 'submitted';
  batch.update(doc(db, 'courses', COURSE_ID, 'attempts', attempt.id), {
    teacherFeedback: compactText(teacherFeedback),
    objectiveScore,
    subjectiveScore,
    totalScore,
    subjectivePendingCount: pendingCount,
    status: nextStatus,
    gradedAt: nextStatus === 'graded' ? serverTimestamp() : null,
    graderUid: profile.id,
    resultReleasedAt: nextStatus === 'graded' ? serverTimestamp() : null,
  });
  await batch.commit();
}

function formatKnowledgeLabel(id, fallback = '未标注知识点') {
  const value = compactText(id).replace(/^kp:/i, '').replace(/-/g, ' ');
  return value || fallback;
}

function formatAbilityLabel(id) {
  const value = compactText(id);
  return value ? `能力 ${value}` : '未标注能力';
}

function buildKnowledgeRefs(question) {
  const knowledgeIds = asArray(question?.knowledgePointIds).filter(Boolean);
  if (knowledgeIds.length) {
    return knowledgeIds.map((id) => ({
      id,
      label: formatKnowledgeLabel(id),
      chapterCode: compactText(question?.chapterCode),
      chapterLabel: compactText(question?.chapterLabel),
    }));
  }

  const fallbackId = compactText(question?.chapterCode || question?.chapterLabel || question?.questionId) || 'unknown';
  return [{
    id: `chapter:${fallbackId}`,
    label: compactText(question?.chapterLabel || question?.chapterCode) || '未标注章节',
    chapterCode: compactText(question?.chapterCode),
    chapterLabel: compactText(question?.chapterLabel),
  }];
}

function createMasteryBucket(rate) {
  if (rate >= 85) return 'strong';
  if (rate >= 60) return 'warning';
  return 'weak';
}

export function buildAssignmentAnalytics({ assignment, attempts, questionMap, classStudents }) {
  const totalPossibleScore = Number(assignment?.totalScore || 0);
  const allStudents = uniqueById(classStudents);
  const submittedAttempts = attempts.filter((item) => ['submitted', 'graded', 'returned'].includes(item.status));
  const gradedAttempts = attempts.filter((item) => ['graded', 'returned'].includes(item.status));
  const pendingManualReview = attempts.filter((item) => Number(item.subjectivePendingCount || 0) > 0).length;
  const submittedUids = new Set(submittedAttempts.map((item) => item.uid).filter(Boolean));
  const unsubmittedStudents = Math.max(0, allStudents.length - submittedUids.size);
  const totalScore = submittedAttempts.reduce((sum, item) => sum + Number(item.totalScore || 0), 0);
  const avgScore = submittedAttempts.length ? totalScore / submittedAttempts.length : 0;
  const avgScoreRate = submittedAttempts.length && totalPossibleScore > 0
    ? (avgScore / totalPossibleScore) * 100
    : 0;
  const gradedAvgScore = gradedAttempts.length
    ? gradedAttempts.reduce((sum, item) => sum + Number(item.totalScore || 0), 0) / gradedAttempts.length
    : 0;
  const gradedAvgScoreRate = gradedAttempts.length && totalPossibleScore > 0
    ? (gradedAvgScore / totalPossibleScore) * 100
    : 0;

  const knowledgeCounter = new Map();
  const abilityCounter = new Map();
  const studentMetrics = new Map();
  let objectiveCount = 0;
  let objectiveCorrect = 0;

  const ensureStudentMetric = (attempt) => {
    const key = attempt.uid || attempt.studentNo || attempt.attemptId;
    if (!studentMetrics.has(key)) {
      const rawScore = Number(attempt.totalScore || 0);
      studentMetrics.set(key, {
        uid: attempt.uid || '',
        studentNo: attempt.studentNo || '-',
        studentName: attempt.studentName || '-',
        classId: attempt.classId || '-',
        status: attempt.status || '-',
        score: rawScore,
        scoreRate: totalPossibleScore > 0 ? (rawScore / totalPossibleScore) * 100 : 0,
        pendingManualReview: Number(attempt.subjectivePendingCount || 0),
        incorrectObjectiveCount: 0,
        objectiveCount: 0,
        submittedAt: attempt.submittedAt || null,
      });
    }
    return studentMetrics.get(key);
  };

  for (const attempt of attempts) {
    const studentMetric = ensureStudentMetric(attempt);
    for (const answer of asArray(attempt.answers)) {
      const question = questionMap.get(answer.questionId);
      if (!question || answer.autoCorrect === null) {
        continue;
      }

      objectiveCount += 1;
      studentMetric.objectiveCount += 1;
      if (answer.autoCorrect) {
        objectiveCorrect += 1;
      } else {
        studentMetric.incorrectObjectiveCount += 1;
      }

      buildKnowledgeRefs(question).forEach((knowledgeRef) => {
        const current = knowledgeCounter.get(knowledgeRef.id) || {
          ...knowledgeRef,
          totalCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          studentIds: new Set(),
          questionIds: new Set(),
        };
        current.totalCount += 1;
        current.studentIds.add(attempt.uid || attempt.studentNo || attempt.attemptId);
        current.questionIds.add(answer.questionId);
        if (answer.autoCorrect) {
          current.correctCount += 1;
        } else {
          current.incorrectCount += 1;
        }
        knowledgeCounter.set(knowledgeRef.id, current);
      });

      asArray(question.abilityIds).forEach((id) => {
        const current = abilityCounter.get(id) || {
          id,
          label: formatAbilityLabel(id),
          totalCount: 0,
          correctCount: 0,
          incorrectCount: 0,
        };
        current.totalCount += 1;
        if (answer.autoCorrect) {
          current.correctCount += 1;
        } else {
          current.incorrectCount += 1;
        }
        abilityCounter.set(id, current);
      });
    }
  }

  const scoreDistribution = [
    { label: '90-100', min: 90, max: 100, count: 0 },
    { label: '80-89', min: 80, max: 89.999, count: 0 },
    { label: '70-79', min: 70, max: 79.999, count: 0 },
    { label: '60-69', min: 60, max: 69.999, count: 0 },
    { label: '0-59', min: 0, max: 59.999, count: 0 },
  ];
  submittedAttempts.forEach((attempt) => {
    const rate = totalPossibleScore > 0 ? (Number(attempt.totalScore || 0) / totalPossibleScore) * 100 : 0;
    const bucket = scoreDistribution.find((item) => rate >= item.min && rate <= item.max);
    if (bucket) {
      bucket.count += 1;
    }
  });

  const knowledgeMastery = Array.from(knowledgeCounter.values())
    .map((item) => {
      const masteryRate = item.totalCount ? (item.correctCount / item.totalCount) * 100 : 0;
      return {
        id: item.id,
        label: item.label,
        chapterCode: item.chapterCode,
        chapterLabel: item.chapterLabel,
        masteryRate: Number(masteryRate.toFixed(2)),
        totalCount: item.totalCount,
        correctCount: item.correctCount,
        incorrectCount: item.incorrectCount,
        studentCount: item.studentIds.size,
        questionCount: item.questionIds.size,
        level: createMasteryBucket(masteryRate),
      };
    })
    .sort((left, right) => {
      if (left.masteryRate !== right.masteryRate) {
        return left.masteryRate - right.masteryRate;
      }
      return right.totalCount - left.totalCount;
    });

  const abilityMastery = Array.from(abilityCounter.values())
    .map((item) => {
      const masteryRate = item.totalCount ? (item.correctCount / item.totalCount) * 100 : 0;
      return {
        id: item.id,
        label: item.label,
        masteryRate: Number(masteryRate.toFixed(2)),
        totalCount: item.totalCount,
        incorrectCount: item.incorrectCount,
        level: createMasteryBucket(masteryRate),
      };
    })
    .sort((left, right) => {
      if (left.masteryRate !== right.masteryRate) {
        return left.masteryRate - right.masteryRate;
      }
      return right.totalCount - left.totalCount;
    });

  const riskStudents = Array.from(studentMetrics.values())
    .map((item) => ({
      ...item,
      scoreRate: Number(item.scoreRate.toFixed(2)),
    }))
    .sort((left, right) => {
      if (left.scoreRate !== right.scoreRate) {
        return left.scoreRate - right.scoreRate;
      }
      if (left.incorrectObjectiveCount !== right.incorrectObjectiveCount) {
        return right.incorrectObjectiveCount - left.incorrectObjectiveCount;
      }
      return right.pendingManualReview - left.pendingManualReview;
    });

  const missingStudents = allStudents
    .filter((student) => !submittedUids.has(student.id))
    .map((student) => ({
      uid: student.id,
      studentNo: student.studentNo || '-',
      studentName: student.name || '-',
      classId: student.classId || '-',
      status: 'missing',
      score: 0,
      scoreRate: 0,
      pendingManualReview: 0,
      incorrectObjectiveCount: 0,
      objectiveCount: 0,
      submittedAt: null,
    }));

  const masteryBucketSummary = knowledgeMastery.reduce((summary, item) => {
    summary[item.level] += 1;
    return summary;
  }, { strong: 0, warning: 0, weak: 0 });

  const sortCounter = (counter) => Array.from(counter.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  const knowledgeWeaknessCounter = new Map();
  const abilityWeaknessCounter = new Map();
  knowledgeMastery
    .filter((item) => item.incorrectCount > 0)
    .forEach((item) => knowledgeWeaknessCounter.set(item.label, item.incorrectCount));
  abilityMastery
    .filter((item) => item.incorrectCount > 0)
    .forEach((item) => abilityWeaknessCounter.set(item.label, item.incorrectCount));

  const submissionRate = allStudents.length
    ? (submittedAttempts.length / allStudents.length) * 100
    : 0;
  const masteryRate = knowledgeMastery.length
    ? knowledgeMastery.reduce((sum, item) => sum + item.masteryRate, 0) / knowledgeMastery.length
    : 0;

  return {
    assignmentTitle: assignment?.title || '',
    totalStudents: allStudents.length,
    submissionCount: submittedAttempts.length,
    avgScore: Number(avgScore.toFixed(2)),
    avgScoreRate: Number(avgScoreRate.toFixed(2)),
    gradedAvgScore: Number(gradedAvgScore.toFixed(2)),
    gradedAvgScoreRate: Number(gradedAvgScoreRate.toFixed(2)),
    correctRate: objectiveCount ? Number(((objectiveCorrect / objectiveCount) * 100).toFixed(2)) : 0,
    submissionRate: Number(submissionRate.toFixed(2)),
    masteryRate: Number(masteryRate.toFixed(2)),
    unsubmittedStudents,
    pendingManualReview,
    scoreDistribution,
    knowledgeMastery,
    weakKnowledgeMasteryTopN: knowledgeMastery.slice(0, 6),
    abilityMastery,
    weakAbilityMasteryTopN: abilityMastery.slice(0, 6),
    studentRiskTopN: missingStudents.concat(riskStudents).slice(0, 8),
    missingStudents: missingStudents.slice(0, 8),
    masteryBucketSummary,
    wrongKnowledgePointTopN: sortCounter(knowledgeWeaknessCounter),
    wrongAbilityTopN: sortCounter(abilityWeaknessCounter),
  };
}

export function buildPracticeAnalytics({ pageTitle, attempts, questionMap, questionKeyMap, classStudents }) {
  const allStudents = uniqueById(classStudents);
  const activeAttempts = attempts.filter((item) => asArray(item.answers).length > 0);
  const activeUids = new Set(activeAttempts.map((item) => item.uid).filter(Boolean));
  const participationRate = allStudents.length ? (activeAttempts.length / allStudents.length) * 100 : 0;
  const unstartedStudents = Math.max(0, allStudents.length - activeUids.size);

  const knowledgeCounter = new Map();
  const abilityCounter = new Map();
  const studentMetrics = new Map();
  let objectiveCount = 0;
  let objectiveCorrect = 0;
  let totalAnsweredCount = 0;
  let answerRevealedCount = 0;
  let subjectiveAnswerCount = 0;

  const ensureStudentMetric = (attempt) => {
    const key = attempt.uid || attempt.studentNo || attempt.attemptId;
    if (!studentMetrics.has(key)) {
      studentMetrics.set(key, {
        uid: attempt.uid || '',
        studentNo: attempt.studentNo || '-',
        studentName: attempt.studentName || '-',
        classId: attempt.classId || '-',
        status: attempt.status || 'in_progress',
        scoreRate: 0,
        pendingManualReview: 0,
        incorrectObjectiveCount: 0,
        objectiveCount: 0,
        answeredCount: 0,
        answerRevealedCount: 0,
        correctObjectiveCount: 0,
        lastSavedAt: attempt.lastSavedAt || attempt.updatedAt || null,
      });
    }
    return studentMetrics.get(key);
  };

  for (const attempt of activeAttempts) {
    const studentMetric = ensureStudentMetric(attempt);
    for (const answer of asArray(attempt.answers)) {
      const question = questionMap.get(answer.questionId);
      const questionKey = questionKeyMap.get(answer.questionId);
      const evaluation = evaluatePracticeAnswer({ answer, questionKey });

      totalAnsweredCount += 1;
      studentMetric.answeredCount += 1;

      if (answer.answerRevealed) {
        answerRevealedCount += 1;
        studentMetric.answerRevealedCount += 1;
      }

      if (!evaluation.objective) {
        subjectiveAnswerCount += 1;
        continue;
      }

      objectiveCount += 1;
      studentMetric.objectiveCount += 1;

      if (evaluation.autoCorrect) {
        objectiveCorrect += 1;
        studentMetric.correctObjectiveCount += 1;
      } else {
        studentMetric.incorrectObjectiveCount += 1;
      }

      if (!question) {
        continue;
      }

      buildKnowledgeRefs(question).forEach((knowledgeRef) => {
        const current = knowledgeCounter.get(knowledgeRef.id) || {
          ...knowledgeRef,
          totalCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          studentIds: new Set(),
          questionIds: new Set(),
        };
        current.totalCount += 1;
        current.studentIds.add(attempt.uid || attempt.studentNo || attempt.attemptId);
        current.questionIds.add(answer.questionId);
        if (evaluation.autoCorrect) {
          current.correctCount += 1;
        } else {
          current.incorrectCount += 1;
        }
        knowledgeCounter.set(knowledgeRef.id, current);
      });

      asArray(question.abilityIds).forEach((id) => {
        const current = abilityCounter.get(id) || {
          id,
          label: formatAbilityLabel(id),
          totalCount: 0,
          correctCount: 0,
          incorrectCount: 0,
        };
        current.totalCount += 1;
        if (evaluation.autoCorrect) {
          current.correctCount += 1;
        } else {
          current.incorrectCount += 1;
        }
        abilityCounter.set(id, current);
      });
    }
  }

  const knowledgeMastery = Array.from(knowledgeCounter.values())
    .map((item) => {
      const masteryRate = item.totalCount ? (item.correctCount / item.totalCount) * 100 : 0;
      return {
        id: item.id,
        label: item.label,
        chapterCode: item.chapterCode,
        chapterLabel: item.chapterLabel,
        masteryRate: Number(masteryRate.toFixed(2)),
        totalCount: item.totalCount,
        correctCount: item.correctCount,
        incorrectCount: item.incorrectCount,
        studentCount: item.studentIds.size,
        questionCount: item.questionIds.size,
        level: createMasteryBucket(masteryRate),
      };
    })
    .sort((left, right) => {
      if (left.masteryRate !== right.masteryRate) {
        return left.masteryRate - right.masteryRate;
      }
      return right.totalCount - left.totalCount;
    });

  const abilityMastery = Array.from(abilityCounter.values())
    .map((item) => {
      const masteryRate = item.totalCount ? (item.correctCount / item.totalCount) * 100 : 0;
      return {
        id: item.id,
        label: item.label,
        masteryRate: Number(masteryRate.toFixed(2)),
        totalCount: item.totalCount,
        incorrectCount: item.incorrectCount,
        level: createMasteryBucket(masteryRate),
      };
    })
    .sort((left, right) => {
      if (left.masteryRate !== right.masteryRate) {
        return left.masteryRate - right.masteryRate;
      }
      return right.totalCount - left.totalCount;
    });

  const riskStudents = Array.from(studentMetrics.values())
    .map((item) => {
      const correctRate = item.objectiveCount ? (item.correctObjectiveCount / item.objectiveCount) * 100 : 0;
      return {
        ...item,
        scoreRate: Number(correctRate.toFixed(2)),
      };
    })
    .sort((left, right) => {
      if (left.scoreRate !== right.scoreRate) {
        return left.scoreRate - right.scoreRate;
      }
      if (left.answeredCount !== right.answeredCount) {
        return left.answeredCount - right.answeredCount;
      }
      return right.answerRevealedCount - left.answerRevealedCount;
    });

  const missingStudents = allStudents
    .filter((student) => !activeUids.has(student.id))
    .map((student) => ({
      uid: student.id,
      studentNo: student.studentNo || '-',
      studentName: student.name || '-',
      classId: student.classId || '-',
      status: 'missing',
      scoreRate: 0,
      pendingManualReview: 0,
      incorrectObjectiveCount: 0,
      objectiveCount: 0,
      answeredCount: 0,
      answerRevealedCount: 0,
      lastSavedAt: null,
    }));

  const masteryBucketSummary = knowledgeMastery.reduce((summary, item) => {
    summary[item.level] += 1;
    return summary;
  }, { strong: 0, warning: 0, weak: 0 });

  const avgAnsweredCount = activeAttempts.length ? totalAnsweredCount / activeAttempts.length : 0;
  const correctRate = objectiveCount ? (objectiveCorrect / objectiveCount) * 100 : 0;
  const revealRate = totalAnsweredCount ? (answerRevealedCount / totalAnsweredCount) * 100 : 0;
  const masteryRate = knowledgeMastery.length
    ? knowledgeMastery.reduce((sum, item) => sum + item.masteryRate, 0) / knowledgeMastery.length
    : 0;

  return {
    pageTitle: pageTitle || '',
    totalStudents: allStudents.length,
    participationCount: activeAttempts.length,
    participationRate: Number(participationRate.toFixed(2)),
    unstartedStudents,
    avgAnsweredCount: Number(avgAnsweredCount.toFixed(2)),
    correctRate: Number(correctRate.toFixed(2)),
    revealRate: Number(revealRate.toFixed(2)),
    objectiveCount,
    subjectiveAnswerCount,
    totalAnsweredCount,
    answerRevealedCount,
    masteryRate: Number(masteryRate.toFixed(2)),
    knowledgeMastery,
    weakKnowledgeMasteryTopN: knowledgeMastery.slice(0, 6),
    abilityMastery,
    weakAbilityMasteryTopN: abilityMastery.slice(0, 6),
    studentRiskTopN: missingStudents.concat(riskStudents).slice(0, 8),
    missingStudents: missingStudents.slice(0, 8),
    masteryBucketSummary,
  };
}

export function summarizeAssignmentRow(row, attempts = []) {
  const related = attempts.filter((item) => item.assignmentId === row.assignmentId);
  const gradedCount = related.filter((item) => item.status === 'graded').length;
  const submittedCount = related.filter((item) => ['submitted', 'graded', 'returned'].includes(item.status)).length;
  const avgScore = gradedCount
    ? related.filter((item) => item.status === 'graded').reduce((sum, item) => sum + Number(item.totalScore || 0), 0) / gradedCount
    : 0;
  return {
    ...row,
    submittedCount,
    gradedCount,
    avgScore: Number(avgScore.toFixed(2)),
    dueAtLabel: formatDateTime(row.dueAt),
    startAtLabel: formatDateTime(row.startAt),
    createdByLabel: row.createdBy,
    targetClassIdsLabel: asArray(row.targetClassIds).join(', '),
    visibilityLabel: row.visibility,
    resultReleasePolicyLabel: row.resultReleasePolicy,
  };
}

export async function getUserProfileById(uid) {
  return getExistingUserProfile(uid);
}

export { formatDateTime, roleLabel };


