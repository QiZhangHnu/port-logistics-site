import {
  PENDING_EMAIL_KEY,
  auth,
  getUserContext,
  onAuthStateChanged,
  safeStorageSet,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from './firebase-core.js';

const form = document.getElementById('login-form');
const emailEl = document.getElementById('login-email');
const passwordEl = document.getElementById('login-password');
const messageEl = document.getElementById('login-message');

const errorMessages = {
  'auth/invalid-email': '邮箱格式不正确。',
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
  return errorMessages[error?.code] || '登录失败，请稍后再试。';
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

function redirectForRole(profile) {
  if (['teacher', 'admin'].includes(profile?.role || '')) {
    window.location.href = 'teacher-dashboard.html';
    return;
  }
  window.location.href = 'student-center.html';
}

function handleVerifiedParam() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === '1') {
    setMessage('邮箱验证成功，请使用邮箱和密码登录。', 'success');
  }
}

handleVerifiedParam();

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  if (!user.emailVerified) {
    setMessage('登录成功，但邮箱尚未验证，正在发送验证邮件…');
    try {
      await sendVerificationEmailWithFallback(user);
      setMessage('验证邮件已发送，请完成邮箱验证后再登录。', 'success');
    } catch (error) {
      setMessage(getErrorMessage(error), 'error');
    } finally {
      await signOut(auth).catch(() => {});
    }
    return;
  }

  const { profile } = await getUserContext({ ensureProfile: false });
  if (profile?.status === 'disabled') {
    setMessage('该账号已被停用，请联系教师。', 'error');
    await signOut(auth).catch(() => {});
    return;
  }
  setMessage('登录成功，正在跳转…', 'success');
  setTimeout(() => redirectForRole(profile), 300);
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = emailEl?.value.trim();
  const password = passwordEl?.value;
  if (!email || !password) {
    setMessage('请填写邮箱和密码。', 'error');
    return;
  }
  safeStorageSet(PENDING_EMAIL_KEY, email);
  setMessage('正在登录…');
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  }
});

