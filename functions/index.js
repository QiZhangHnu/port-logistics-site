'use strict';

const admin = require('firebase-admin');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { gradeAutoResponse } = require('./grading');

admin.initializeApp();

const db = admin.firestore();
const COURSE_ID = 'PORT-LOG';

function trimString(value, fieldName) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${fieldName} is required.`);
  }
  return normalized;
}

function normalizeClassId(value) {
  return trimString(value, 'classId').replace(/\s+/g, '').toUpperCase();
}

function normalizeStudentNo(value) {
  return trimString(value, 'studentNo').replace(/\s+/g, '').toUpperCase();
}

function courseRef() {
  return db.collection('courses').doc(COURSE_ID);
}

function classRef(classId) {
  return courseRef().collection('classes').doc(classId);
}

function studentIndexRef(studentNo) {
  return courseRef().collection('student_no_index').doc(studentNo);
}

function assignmentRef(assignmentId) {
  return courseRef().collection('assignments').doc(assignmentId);
}

function questionItemRef(questionId) {
  return courseRef().collection('question_items').doc(questionId);
}

function questionKeyRef(questionId) {
  return courseRef().collection('question_keys').doc(questionId);
}

function attemptRef(attemptId) {
  return courseRef().collection('attempts').doc(attemptId);
}

function answerRef(attemptId, questionId) {
  return attemptRef(attemptId).collection('answers').doc(questionId);
}

async function getUserProfileOrThrow(uid) {
  const snapshot = await db.collection('users').doc(uid).get();
  if (!snapshot.exists) {
    throw new HttpsError('failed-precondition', 'User profile does not exist.');
  }
  return { ref: snapshot.ref, data: snapshot.data() };
}

exports.claimStudentProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email || '';
  const emailVerified = Boolean(request.auth.token.email_verified);
  const studentNo = normalizeStudentNo(request.data?.studentNo);
  const classId = normalizeClassId(request.data?.classId);
  const name = trimString(request.data?.name, 'name');

  await db.runTransaction(async (transaction) => {
    const userRef = db.collection('users').doc(uid);
    const userSnap = await transaction.get(userRef);
    const classSnap = await transaction.get(classRef(classId));
    if (!classSnap.exists) {
      throw new HttpsError('not-found', 'Class does not exist.');
    }
    if (classSnap.data().status === 'archived') {
      throw new HttpsError('failed-precondition', 'Class is archived.');
    }

    const indexRef = studentIndexRef(studentNo);
    const indexSnap = await transaction.get(indexRef);
    if (indexSnap.exists && indexSnap.data().uid !== uid) {
      throw new HttpsError('already-exists', 'studentNo has already been claimed.');
    }

    if (userSnap.exists) {
      const current = userSnap.data();
      if (current.role && current.role !== 'student') {
        throw new HttpsError('permission-denied', 'Only student accounts can claim a student profile.');
      }
      if (current.studentNo && current.studentNo !== studentNo) {
        throw new HttpsError('failed-precondition', 'studentNo has already been bound to this account.');
      }
      if (current.classId && current.classId !== classId) {
        throw new HttpsError('failed-precondition', 'classId has already been bound to this account.');
      }
    }

    const isNewBinding = !userSnap.exists || !userSnap.data().studentNo;
    const now = admin.firestore.FieldValue.serverTimestamp();

    transaction.set(
      userRef,
      {
        role: 'student',
        name,
        email,
        emailVerified,
        studentNo,
        classId,
        assignedClassIds: [],
        status: 'active',
        createdAt: userSnap.exists ? userSnap.data().createdAt || now : now,
        updatedAt: now,
        lastLoginAt: userSnap.exists ? userSnap.data().lastLoginAt || null : null,
      },
      { merge: true }
    );

    transaction.set(indexRef, {
      uid,
      name,
      classId,
      status: 'active',
      boundAt: now,
    });

    if (isNewBinding) {
      transaction.set(
        classRef(classId),
        {
          studentCount: admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        },
        { merge: true }
      );
    }
  });

  return {
    ok: true,
    uid,
    studentNo,
    classId,
    name,
  };
});

exports.adminSetUserProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const adminProfile = await getUserProfileOrThrow(request.auth.uid);
  if (adminProfile.data.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const uid = trimString(request.data?.uid, 'uid');
  const targetRef = db.collection('users').doc(uid);
  const payload = request.data || {};

  await db.runTransaction(async (transaction) => {
    const targetSnap = await transaction.get(targetRef);
    if (!targetSnap.exists) {
      throw new HttpsError('not-found', 'Target user profile does not exist.');
    }

    const current = targetSnap.data();
    const nextRole = payload.role ? trimString(payload.role, 'role') : current.role;
    const nextStatus = payload.status ? trimString(payload.status, 'status') : current.status;
    const nextName = payload.name ? trimString(payload.name, 'name') : current.name;
    const nextAssignedClassIds = Array.isArray(payload.assignedClassIds)
      ? payload.assignedClassIds.map((item) => normalizeClassId(item))
      : Array.isArray(current.assignedClassIds)
        ? current.assignedClassIds
        : [];

    const now = admin.firestore.FieldValue.serverTimestamp();
    const updatePayload = {
      role: nextRole,
      status: nextStatus,
      name: nextName,
      assignedClassIds: nextAssignedClassIds,
      updatedAt: now,
    };

    const currentStudentNo = current.studentNo || null;
    const nextStudentNo = payload.studentNo === undefined
      ? currentStudentNo
      : payload.studentNo
        ? normalizeStudentNo(payload.studentNo)
        : null;
    const currentClassId = current.classId || null;
    const nextClassId = payload.classId === undefined
      ? currentClassId
      : payload.classId
        ? normalizeClassId(payload.classId)
        : null;

    if (nextRole === 'student') {
      updatePayload.studentNo = nextStudentNo;
      updatePayload.classId = nextClassId;
      if (!nextStudentNo || !nextClassId) {
        throw new HttpsError('invalid-argument', 'studentNo and classId are required for student users.');
      }

      const nextClassSnap = await transaction.get(classRef(nextClassId));
      if (!nextClassSnap.exists) {
        throw new HttpsError('not-found', 'Target class does not exist.');
      }

      const nextIndexSnap = await transaction.get(studentIndexRef(nextStudentNo));
      if (nextIndexSnap.exists && nextIndexSnap.data().uid !== uid) {
        throw new HttpsError('already-exists', 'studentNo has already been claimed.');
      }

      transaction.set(studentIndexRef(nextStudentNo), {
        uid,
        name: nextName,
        classId: nextClassId,
        status: nextStatus,
        boundAt: now,
      });

      if (currentStudentNo && currentStudentNo !== nextStudentNo) {
        transaction.delete(studentIndexRef(currentStudentNo));
      }

      if (currentClassId && currentClassId !== nextClassId) {
        transaction.set(classRef(currentClassId), { studentCount: admin.firestore.FieldValue.increment(-1), updatedAt: now }, { merge: true });
        transaction.set(classRef(nextClassId), { studentCount: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true });
      } else if (!currentClassId && nextClassId) {
        transaction.set(classRef(nextClassId), { studentCount: admin.firestore.FieldValue.increment(1), updatedAt: now }, { merge: true });
      }
    } else {
      updatePayload.studentNo = null;
      updatePayload.classId = null;
      if (currentStudentNo) {
        transaction.delete(studentIndexRef(currentStudentNo));
      }
      if (currentClassId) {
        transaction.set(classRef(currentClassId), { studentCount: admin.firestore.FieldValue.increment(-1), updatedAt: now }, { merge: true });
      }
    }

    transaction.set(targetRef, updatePayload, { merge: true });
  });

  return { ok: true, uid };
});

exports.submitAssignmentAttempt = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const uid = request.auth.uid;
  const courseId = trimString(request.data?.courseId || COURSE_ID, 'courseId');
  const assignmentId = trimString(request.data?.assignmentId, 'assignmentId');
  if (courseId !== COURSE_ID) {
    throw new HttpsError('invalid-argument', 'Unsupported courseId.');
  }

  const userProfile = await getUserProfileOrThrow(uid);
  if (userProfile.data.role !== 'student') {
    throw new HttpsError('permission-denied', 'Only students can submit attempts.');
  }
  if (!userProfile.data.classId || !userProfile.data.studentNo) {
    throw new HttpsError('failed-precondition', 'Student profile is incomplete.');
  }

  const attemptId = `${assignmentId}__${uid}`;
  const assignmentSnapshot = await assignmentRef(assignmentId).get();
  if (!assignmentSnapshot.exists) {
    throw new HttpsError('not-found', 'Assignment not found.');
  }

  const assignment = assignmentSnapshot.data();
  if (!Array.isArray(assignment.targetClassIds) || !assignment.targetClassIds.includes(userProfile.data.classId)) {
    throw new HttpsError('permission-denied', 'Assignment is not available for this class.');
  }
  if (assignment.visibility !== 'published') {
    throw new HttpsError('failed-precondition', 'Assignment is not open for submission.');
  }

  const now = admin.firestore.Timestamp.now();
  if (assignment.startAt && assignment.startAt.toMillis() > now.toMillis()) {
    throw new HttpsError('failed-precondition', 'Assignment has not started.');
  }
  if (assignment.dueAt && assignment.dueAt.toMillis() < now.toMillis()) {
    throw new HttpsError('deadline-exceeded', 'Assignment is already overdue.');
  }

  const attemptSnapshot = await attemptRef(attemptId).get();
  if (!attemptSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'Draft attempt does not exist.');
  }

  const attempt = attemptSnapshot.data();
  if (attempt.uid !== uid || attempt.status !== 'draft') {
    throw new HttpsError('failed-precondition', 'Attempt can no longer be submitted.');
  }

  const itemsSnapshot = await assignmentRef(assignmentId).collection('items').orderBy('order').get();
  const answersSnapshot = await attemptRef(attemptId).collection('answers').get();
  const answersById = new Map(answersSnapshot.docs.map((doc) => [doc.id, doc]));

  let objectiveScore = 0;
  let subjectiveScore = 0;
  let subjectivePendingCount = 0;
  const batch = db.batch();

  for (const itemDoc of itemsSnapshot.docs) {
    const item = itemDoc.data();
    const questionId = item.questionId;
    const answerSnapshot = answersById.get(questionId);
    const answerData = answerSnapshot ? answerSnapshot.data() : null;

    const questionSnapshot = await questionItemRef(questionId).get();
    if (!questionSnapshot.exists) {
      throw new HttpsError('failed-precondition', `question item missing: ${questionId}`);
    }
    const questionItem = questionSnapshot.data();

    const keySnapshot = await questionKeyRef(questionId).get();
    if (!keySnapshot.exists) {
      throw new HttpsError('failed-precondition', `question key missing: ${questionId}`);
    }
    const key = keySnapshot.data();
    const questionType = answerData?.questionType || questionItem.type || 'short_answer';
    const responsePayload = answerData?.responsePayload || {};

    if (key.autoGradable) {
      const grading = gradeAutoResponse(questionType, responsePayload, key, item.score || key.maxScore || 0);
      objectiveScore += grading.autoScore;
      batch.set(
        answerRef(attemptId, questionId),
        {
          questionId,
          questionType,
          responsePayload,
          autoCorrect: grading.autoCorrect,
          autoScore: grading.autoScore,
          manualScore: 0,
          finalScore: grading.autoScore,
          needsManualReview: false,
          manualComment: '',
          gradedBy: null,
          gradedAt: null,
          locked: true,
          savedAt: answerData?.savedAt || admin.firestore.FieldValue.serverTimestamp(),
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      subjectivePendingCount += 1;
      batch.set(
        answerRef(attemptId, questionId),
        {
          questionId,
          questionType,
          responsePayload,
          autoCorrect: null,
          autoScore: 0,
          manualScore: Number(answerData?.manualScore || 0),
          finalScore: Number(answerData?.manualScore || 0),
          needsManualReview: true,
          manualComment: String(answerData?.manualComment || ''),
          gradedBy: answerData?.gradedBy || null,
          gradedAt: answerData?.gradedAt || null,
          locked: true,
          savedAt: answerData?.savedAt || admin.firestore.FieldValue.serverTimestamp(),
          submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  const totalScore = objectiveScore + subjectiveScore;
  batch.set(
    attemptRef(attemptId),
    {
      status: 'submitted',
      objectiveScore,
      subjectiveScore,
      totalScore,
      objectivePendingCount: 0,
      subjectivePendingCount,
      lastSavedAt: admin.firestore.FieldValue.serverTimestamp(),
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      gradedAt: null,
      graderUid: null,
      resultReleasedAt: null,
    },
    { merge: true }
  );

  await batch.commit();

  return {
    ok: true,
    attemptId,
    assignmentId,
    objectiveScore,
    subjectiveScore,
    totalScore,
    subjectivePendingCount,
  };
});


