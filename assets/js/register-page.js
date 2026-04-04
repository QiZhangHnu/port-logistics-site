import {
  PENDING_EMAIL_KEY,
  auth,
  clearPendingProfile,
  createUserWithEmailAndPassword,
  deleteUser,
  ensureCurrentUserProfile,
  getPendingProfile,
  onAuthStateChanged,
  safeStorageGet,
  safeStorageRemove,
  safeStorageSet,
  sendEmailVerification,
  setPendingProfile,
  signInWithEmailAndPassword,
  signOut,
} from './firebase-core.js';
import { callClaimStudentProfile } from './course-data.js';

const form = document.getElementById('register-form');
const nameEl = document.getElementById('register-name');
const studentNoEl = document.getElementById('register-student-no');
const classIdEl = document.getElementById('register-class-id');
const emailEl = document.getElementById('register-email');
const passwordEl = document.getElementById('register-password');
const messageEl = document.getElementById('register-message');
const verificationPanel = document.getElementById('verification-panel');
const verificationEmailEl = document.getElementById('verification-email');
const resendVerificationBtn = document.getElementById('resend-verification');
const checkVerificationBtn = document.getElementById('check-verification');
const verificationCooldownEl = document.getElementById('verification-cooldown');

const RESEND_COOLDOWN_SECONDS = 60;
let resendCooldownRemaining = 0;
let resendCooldownTimer = null;
let suppressUnverifiedAutoSignOut = false;

const errorMessages = {
  'auth/email-already-in-use': '该邮箱已注册，请直接登录。',
  'auth/invalid-email': '邮箱格式不正确。',
  'auth/weak-password': '密码至少 6 位。',
  'auth/user-not-found': '用户不存在，请先注册。',
  'auth/wrong-password': '密码错误，请重试。',
  'auth/invalid-credential': '邮箱或密码不正确。',
  'auth/invalid-login-credentials': '邮箱或密码不正确。',
  'auth/user-disabled': '该账号已被禁用。',
  'auth/too-many-requests': '请求过多，请稍后再试。',
  'auth/network-request-failed': '网络异常，请检查连接。',
  'auth/invalid-continue-uri': '验证跳转地址无效。',
  'auth/unauthorized-continue-uri': '当前域名尚未加入 Firebase 授权列表。',
};

function setMessage(message, tone = 'info') {
  if (!messageEl) return;
  messageEl.textContent = message || '';
  messageEl.classList.remove('text-red-600', 'text-emerald-600', 'text-slate-600');
  if (!message) {
    messageEl.classList.add('text-slate-600');
    return;
  }
  if (tone === 'error') messageEl.classList.add('text-red-600');
  else if (tone === 'success') messageEl.classList.add('text-emerald-600');
  else messageEl.classList.add('text-slate-600');
}

function getErrorMessage(error) {
  return errorMessages[error?.code] || (error?.message || '注册失败，请稍后再试。');
}

function showVerificationPanel(email) {
  const value = (email || '').trim();
  if (value) safeStorageSet(PENDING_EMAIL_KEY, value);
  if (verificationEmailEl) verificationEmailEl.textContent = value;
  verificationPanel?.classList.remove('hidden');
}

function hideVerificationPanel() {
  verificationPanel?.classList.add('hidden');
  if (verificationCooldownEl) verificationCooldownEl.textContent = '';
}

function updateResendCooldownUI() {
  const disabled = resendCooldownRemaining > 0;
  resendVerificationBtn?.toggleAttribute('disabled', disabled);
  resendVerificationBtn?.classList.toggle('opacity-60', disabled);
  resendVerificationBtn?.classList.toggle('cursor-not-allowed', disabled);
  if (verificationCooldownEl) {
    verificationCooldownEl.textContent = disabled ? `可在 ${resendCooldownRemaining}s 后重新发送。` : '';
  }
}

function startResendCooldown(seconds = RESEND_COOLDOWN_SECONDS) {
  resendCooldownRemaining = Math.max(0, Number(seconds) || 0);
  if (resendCooldownTimer) clearInterval(resendCooldownTimer);
  updateResendCooldownUI();
  if (resendCooldownRemaining <= 0) return;
  resendCooldownTimer = setInterval(() => {
    resendCooldownRemaining = Math.max(0, resendCooldownRemaining - 1);
    updateResendCooldownUI();
    if (resendCooldownRemaining <= 0 && resendCooldownTimer) {
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
    }
  }, 1000);
}

function buildVerificationActionCodeSettings() {
  const protocol = window.location?.protocol || '';
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  const url = new URL('login.html', window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('verified', '1');
  return { url: url.toString() };
}

async function sendVerificationEmailWithFallback(user) {
  const actionCodeSettings = buildVerificationActionCodeSettings();
  try {
    if (actionCodeSettings) {
      await sendEmailVerification(user, actionCodeSettings);
    } else {
      await sendEmailVerification(user);
    }
  } catch (error) {
    const code = error?.code || '';
    if (actionCodeSettings && (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri')) {
      await sendEmailVerification(user);
      return;
    }
    throw error;
  }
}

async function applyPendingClaimIfPossible() {
  const pending = getPendingProfile();
  if (!pending?.studentNo || !pending?.classId || !pending?.name) {
    return;
  }
  try {
    await ensureCurrentUserProfile(pending.name);
    await callClaimStudentProfile({
      name: pending.name,
      studentNo: pending.studentNo,
      classId: pending.classId,
    });
    clearPendingProfile();
  } catch (error) {
    setMessage(`账号已验证，但学生身份绑定未完成：${getErrorMessage(error)}`, 'error');
  }
}

const pendingEmail = safeStorageGet(PENDING_EMAIL_KEY) || '';
if (pendingEmail && emailEl && !emailEl.value) {
  emailEl.value = pendingEmail;
}
const pendingProfile = getPendingProfile();
if (pendingProfile) {
  if (nameEl && !nameEl.value) nameEl.value = pendingProfile.name || '';
  if (studentNoEl && !studentNoEl.value) studentNoEl.value = pendingProfile.studentNo || '';
  if (classIdEl && !classIdEl.value) classIdEl.value = pendingProfile.classId || '';
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  if (user.emailVerified) {
    await applyPendingClaimIfPossible();
    safeStorageRemove(PENDING_EMAIL_KEY);
    hideVerificationPanel();
    setMessage('邮箱已验证，正在进入学生中心…', 'success');
    setTimeout(() => {
      window.location.href = 'student-center.html';
    }, 400);
    return;
  }
  showVerificationPanel(user.email || '');
  if (suppressUnverifiedAutoSignOut) return;
  setMessage('邮箱尚未验证，请先完成验证（如未收到可重新发送）。');
  await signOut(auth).catch(() => {});
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    name: nameEl?.value.trim(),
    studentNo: studentNoEl?.value.trim().toUpperCase(),
    classId: classIdEl?.value.trim().toUpperCase(),
    email: emailEl?.value.trim(),
    password: passwordEl?.value,
  };
  if (!payload.name || !payload.studentNo || !payload.classId || !payload.email || !payload.password) {
    setMessage('请完整填写姓名、学号、班级、邮箱和密码。', 'error');
    return;
  }
  setPendingProfile({ name: payload.name, studentNo: payload.studentNo, classId: payload.classId });
  safeStorageSet(PENDING_EMAIL_KEY, payload.email);
  setMessage('正在创建账号…');
  suppressUnverifiedAutoSignOut = true;
  let credential = null;
  try {
    credential = await createUserWithEmailAndPassword(auth, payload.email, payload.password);
    showVerificationPanel(payload.email);
    setMessage('正在发送验证邮件…');
    await sendVerificationEmailWithFallback(credential.user);
    startResendCooldown();
    setMessage('验证邮件已发送，请完成邮箱验证后返回本页点击“我已完成验证”。', 'success');
    await signOut(auth).catch(() => {});
  } catch (error) {
    if (credential?.user) {
      await deleteUser(credential.user).catch(() => {});
      await signOut(auth).catch(() => {});
    }
    setMessage(getErrorMessage(error), 'error');
  } finally {
    suppressUnverifiedAutoSignOut = false;
  }
});

resendVerificationBtn?.addEventListener('click', async () => {
  if (resendCooldownRemaining > 0) return;
  const email = emailEl?.value.trim();
  const password = passwordEl?.value;
  if (!email || !password) {
    setMessage('请先填写邮箱和密码，再重新发送验证邮件。', 'error');
    return;
  }
  suppressUnverifiedAutoSignOut = true;
  setMessage('正在重新发送验证邮件…');
  try {
    const loginCredential = await signInWithEmailAndPassword(auth, email, password);
    showVerificationPanel(email);
    await sendVerificationEmailWithFallback(loginCredential.user);
    await signOut(auth).catch(() => {});
    startResendCooldown();
    setMessage('验证邮件已重新发送，请查收。', 'success');
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  } finally {
    suppressUnverifiedAutoSignOut = false;
  }
});

checkVerificationBtn?.addEventListener('click', async () => {
  const email = emailEl?.value.trim();
  const password = passwordEl?.value;
  if (!email || !password) {
    setMessage('请先填写邮箱和密码。', 'error');
    return;
  }
  setMessage('正在检查邮箱验证状态…');
  suppressUnverifiedAutoSignOut = true;
  try {
    const loginCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = loginCredential.user;
    await user.reload();
    if (!user.emailVerified) {
      await signOut(auth).catch(() => {});
      showVerificationPanel(email);
      setMessage('邮箱尚未验证，请先完成邮箱中的验证操作。', 'error');
      return;
    }
    await applyPendingClaimIfPossible();
    safeStorageRemove(PENDING_EMAIL_KEY);
    hideVerificationPanel();
    setMessage('邮箱验证完成，注册成功，正在进入学生中心…', 'success');
    setTimeout(() => {
      window.location.href = 'student-center.html';
    }, 400);
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  } finally {
    suppressUnverifiedAutoSignOut = false;
  }
});
