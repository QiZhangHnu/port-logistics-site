import {
  auth,
  getDefaultUserName,
  getUserContext,
  onAuthStateChanged,
  roleLabel,
  signOut,
} from './firebase-core.js';

const accountMenuBtn = document.getElementById('account-menu-btn');
const accountBtnAvatarEl = document.getElementById('account-btn-avatar');
const accountMenuOverlay = document.getElementById('account-menu-overlay');
const accountMenuEl = document.getElementById('account-menu');
const accountMenuCloseBtn = document.getElementById('account-menu-close');
const accountMenuEmailEl = document.getElementById('account-menu-email');
const accountMenuAvatarEl = document.getElementById('account-menu-avatar');
const accountMenuGreetingEl = document.getElementById('account-menu-greeting');
const accountMenuRegisterLink = document.getElementById('account-menu-register');
const accountMenuLoginLink = document.getElementById('account-menu-login');
const accountMenuSwitchLink = document.getElementById('account-menu-switch');
const accountMenuSignOutBtn = document.getElementById('account-menu-signout');
const accountMenuMessageEl = document.getElementById('account-menu-message');
const accountMenuStudentCenter = document.getElementById('account-menu-student-center');
const accountMenuTeacherCenter = document.getElementById('account-menu-teacher-center');

const errorMessages = {
  'auth/too-many-requests': '请求过多，请稍后再试。',
  'auth/network-request-failed': '网络异常，请检查连接。',
};

function setMessage(message, tone = 'info') {
  if (!accountMenuMessageEl) return;
  accountMenuMessageEl.textContent = message || '';
  accountMenuMessageEl.classList.remove('text-red-600', 'text-emerald-600', 'text-slate-600');
  if (!message) {
    accountMenuMessageEl.classList.add('text-slate-600');
    return;
  }
  if (tone === 'error') accountMenuMessageEl.classList.add('text-red-600');
  else if (tone === 'success') accountMenuMessageEl.classList.add('text-emerald-600');
  else accountMenuMessageEl.classList.add('text-slate-600');
}

function getErrorMessage(error) {
  return errorMessages[error?.code] || '操作失败，请稍后再试。';
}

function getAvatarText(user, profile) {
  const first = (profile?.name || getDefaultUserName(user, '访客')).trim().slice(0, 1);
  return first ? first.toUpperCase() : '访';
}

function setAccountMenuOpen(open) {
  accountMenuEl?.classList.toggle('hidden', !open);
  accountMenuOverlay?.classList.toggle('hidden', !open);
  accountMenuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) accountMenuCloseBtn?.focus();
}

function renderMenu(user, profile) {
  const avatarText = user ? getAvatarText(user, profile) : '访';
  if (accountBtnAvatarEl) accountBtnAvatarEl.textContent = avatarText;
  if (accountMenuAvatarEl) accountMenuAvatarEl.textContent = avatarText;
  if (accountMenuEmailEl) accountMenuEmailEl.textContent = user?.email || '未登录';
  if (accountMenuGreetingEl) {
    accountMenuGreetingEl.textContent = user
      ? `${profile?.name || getDefaultUserName(user, '同学')}，${roleLabel(profile?.role)}您好！`
      : '您好，欢迎访问！';
  }
  const loggedIn = !!user;
  accountMenuRegisterLink?.classList.toggle('hidden', loggedIn);
  accountMenuLoginLink?.classList.toggle('hidden', loggedIn);
  accountMenuSwitchLink?.classList.toggle('hidden', !loggedIn);
  accountMenuSignOutBtn?.classList.toggle('hidden', !loggedIn);
  accountMenuStudentCenter?.classList.toggle('hidden', !loggedIn || (profile?.role && profile.role !== 'student'));
  accountMenuTeacherCenter?.classList.toggle('hidden', !loggedIn || !['teacher', 'admin'].includes(profile?.role || ''));
}

accountMenuBtn?.addEventListener('click', () => {
  const open = !accountMenuEl || accountMenuEl.classList.contains('hidden');
  setAccountMenuOpen(open);
});
accountMenuCloseBtn?.addEventListener('click', () => setAccountMenuOpen(false));
accountMenuOverlay?.addEventListener('click', () => setAccountMenuOpen(false));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setAccountMenuOpen(false);
});

accountMenuSwitchLink?.addEventListener('click', async (event) => {
  event.preventDefault();
  setMessage('正在退出并跳转到登录页…');
  try {
    await signOut(auth);
    window.location.href = 'login.html';
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  }
});

accountMenuSignOutBtn?.addEventListener('click', async () => {
  setMessage('正在退出登录…');
  try {
    await signOut(auth);
    setMessage('已退出登录。', 'success');
    setAccountMenuOpen(false);
  } catch (error) {
    setMessage(getErrorMessage(error), 'error');
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderMenu(null, null);
    return;
  }
  if (!user.emailVerified) {
    renderMenu(null, null);
    setMessage('邮箱尚未验证，请先完成验证后再登录。', 'error');
    await signOut(auth).catch(() => {});
    return;
  }
  const { profile } = await getUserContext({ ensureProfile: false });
  if (profile?.status === 'disabled') {
    setMessage('该账号已被停用，请联系教师。', 'error');
    await signOut(auth).catch(() => {});
    renderMenu(null, null);
    return;
  }
  renderMenu(user, profile);
  if (!profile) {
    setMessage('账号已登录，请前往学生中心完善资料，或联系管理员开通教师权限。');
  }
});

