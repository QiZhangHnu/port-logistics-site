import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js";
import {
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-functions.js";

export {
  addDoc,
  collection,
  createUserWithEmailAndPassword,
  deleteDoc,
  deleteUser,
  doc,
  getDoc,
  getDocs,
  httpsCallable,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  sendEmailVerification,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updateDoc,
  where,
  writeBatch,
};

export const firebaseConfig = {
  apiKey: "AIzaSyCZQkYOqqrYVoh7em3vqa2_cQGTl54mDwY",
  authDomain: "port-logistics-website.firebaseapp.com",
  projectId: "port-logistics-website",
  storageBucket: "port-logistics-website.firebasestorage.app",
  messagingSenderId: "408055072268",
  appId: "1:408055072268:web:ecafc91d732134028a9029",
  measurementId: "G-LBWF59BH23",
};

export const COURSE_ID = "PORT-LOG";
export const PENDING_EMAIL_KEY = "pendingVerificationEmail";
export const PENDING_PROFILE_KEY = "portLogPendingProfile";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
try {
  getAnalytics(app);
} catch (error) {
  // Analytics is optional in local/static environments.
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

export function getDefaultUserName(user, fallback = "访客") {
  const email = user?.email || "";
  const fromEmail = email.includes("@") ? email.split("@")[0] : email;
  return (user?.displayName || fromEmail || fallback).trim();
}

export function buildDefaultStudentProfile(user, nameHint = "") {
  return {
    role: "student",
    name: (nameHint || getDefaultUserName(user, "学生")).trim(),
    email: user?.email || "",
    emailVerified: Boolean(user?.emailVerified),
    studentNo: null,
    classId: null,
    assignedClassIds: [],
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: null,
  };
}

export function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

export function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Ignore storage failures.
  }
}

export function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    // Ignore storage failures.
  }
}

export function getPendingProfile() {
  const raw = safeStorageGet(PENDING_PROFILE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

export function setPendingProfile(profile) {
  safeStorageSet(PENDING_PROFILE_KEY, JSON.stringify(profile || {}));
}

export function clearPendingProfile() {
  safeStorageRemove(PENDING_PROFILE_KEY);
}

export async function currentUserReady() {
  if (auth.currentUser) {
    return auth.currentUser;
  }
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user || null);
    });
  });
}

export async function getExistingUserProfile(uid) {
  if (!uid) {
    return null;
  }
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function ensureCurrentUserProfile(nameHint = "") {
  const user = auth.currentUser || (await currentUserReady());
  if (!user) {
    throw new Error("未检测到已登录用户。");
  }
  const ref = doc(db, "users", user.uid);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...snapshot.data() };
  }
  const profile = buildDefaultStudentProfile(user, nameHint);
  await setDoc(ref, profile);
  const created = await getDoc(ref);
  return { id: created.id, ...created.data() };
}

export async function getUserContext(options = {}) {
  const user = auth.currentUser || (await currentUserReady());
  if (!user) {
    return { user: null, profile: null };
  }
  const profile = options.ensureProfile === false
    ? await getExistingUserProfile(user.uid)
    : await ensureCurrentUserProfile(options.nameHint || "");
  return { user, profile };
}

export function callable(name) {
  return httpsCallable(functions, name);
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function toDateTimeLocalInputValue(value) {
  if (!value) {
    return "";
  }
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalInputValue(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function roleLabel(role) {
  if (role === "admin") return "管理员";
  if (role === "teacher") return "教师";
  return "学生";
}

export function questionTypeLabel(type) {
  return {
    single: "单选题",
    multiple: "多选题",
    true_false: "判断题",
    fill_blank: "填空题",
    short_answer: "简答题",
  }[type] || type;
}

