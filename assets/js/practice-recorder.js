import { currentUserReady, getUserContext } from './firebase-core.js';
import {
  ensurePracticeAttempt,
  listPracticeAnswers,
  savePracticeAnswer,
} from './course-data.js';

const SAVE_DEBOUNCE_MS = 500;

function detectQuestionType(questionEl) {
  const questionId = String(questionEl?.id || '');
  if (questionId.startsWith('all-single-')) return 'single';
  if (questionId.startsWith('all-multiple-')) return 'multiple';
  if (questionId.startsWith('all-tf-')) return 'true_false';
  if (questionId.startsWith('all-fill-')) return 'fill_blank';
  if (questionId.startsWith('all-short-')) return 'short_answer';

  if (questionEl.querySelector('input[type="checkbox"]')) return 'multiple';
  if (questionEl.querySelector('input[type="radio"]')) return 'single';
  if (questionEl.querySelector('textarea')) return 'short_answer';
  return 'short_answer';
}

function buildTrueFalseOption(questionId, value, labelText) {
  const label = document.createElement('label');
  label.className = 'option-label';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = questionId;
  input.value = value;
  label.appendChild(input);
  label.append(document.createTextNode(labelText));
  return label;
}

function ensureTrueFalseOptions() {
  const questions = document.querySelectorAll('.question[id^="all-tf-"]');
  questions.forEach((questionEl) => {
    const optionsEl = questionEl.querySelector('.options');
    if (!optionsEl || optionsEl.querySelector('input')) {
      return;
    }
    optionsEl.appendChild(buildTrueFalseOption(questionEl.id, 'T', ' True'));
    optionsEl.appendChild(buildTrueFalseOption(questionEl.id, 'F', ' False'));
  });
}

function collectResponsePayload(questionEl, questionType) {
  if (questionType === 'multiple') {
    const selectedList = Array.from(questionEl.querySelectorAll('input[type="checkbox"]:checked'))
      .map((item) => item.value);
    return { selectedList };
  }

  if (questionType === 'single' || questionType === 'true_false') {
    const selected = questionEl.querySelector('input[type="radio"]:checked')?.value || '';
    return { selected };
  }

  const text = questionEl.querySelector('textarea')?.value || '';
  if (questionType === 'fill_blank') {
    return { blanks: [text], text };
  }
  return { text };
}

function applySavedAnswer(questionEl, answer) {
  if (!questionEl || !answer?.responsePayload) {
    return;
  }
  const payload = answer.responsePayload;
  const type = detectQuestionType(questionEl);

  if (type === 'multiple') {
    const selected = new Set(Array.isArray(payload.selectedList) ? payload.selectedList : []);
    questionEl.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = selected.has(input.value);
    });
    return;
  }

  if (type === 'single' || type === 'true_false') {
    const selected = String(payload.selected || '');
    questionEl.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.checked = input.value === selected;
    });
    return;
  }

  const textarea = questionEl.querySelector('textarea');
  if (textarea) {
    const text = String(payload.text || (Array.isArray(payload.blanks) ? payload.blanks[0] : '') || '');
    textarea.value = text;
  }
}

export function initPracticeRecorder({ pageId = '' } = {}) {
  const state = {
    ready: false,
    attemptId: '',
    answers: new Map(),
    timers: new Map(),
  };

  const persistQuestion = async (questionEl, answerRevealedOverride = null) => {
    if (!state.ready || !questionEl?.id) {
      return;
    }
    const questionId = questionEl.id;
    const questionType = detectQuestionType(questionEl);
    const existing = state.answers.get(questionId);
    const nextAnswerRevealed = answerRevealedOverride === null
      ? Boolean(existing?.answerRevealed)
      : Boolean(answerRevealedOverride || existing?.answerRevealed);

    const responsePayload = collectResponsePayload(questionEl, questionType);
    await savePracticeAnswer({
      attemptId: state.attemptId,
      questionId,
      questionType,
      responsePayload,
      answerRevealed: nextAnswerRevealed,
    });

    state.answers.set(questionId, {
      ...(existing || {}),
      questionId,
      questionType,
      responsePayload,
      answerRevealed: nextAnswerRevealed,
    });
  };

  const queuePersist = (questionEl, immediate = false) => {
    if (!questionEl?.id) {
      return;
    }
    const questionId = questionEl.id;
    const timer = state.timers.get(questionId);
    if (timer) {
      window.clearTimeout(timer);
      state.timers.delete(questionId);
    }
    if (immediate) {
      persistQuestion(questionEl).catch((error) => {
        console.error('Practice answer save failed:', error);
      });
      return;
    }
    const nextTimer = window.setTimeout(() => {
      state.timers.delete(questionId);
      persistQuestion(questionEl).catch((error) => {
        console.error('Practice answer save failed:', error);
      });
    }, SAVE_DEBOUNCE_MS);
    state.timers.set(questionId, nextTimer);
  };

  const bindQuestionInputs = () => {
    document.querySelectorAll('.question').forEach((questionEl) => {
      const inputs = questionEl.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      inputs.forEach((input) => {
        input.addEventListener('change', () => queuePersist(questionEl, true));
      });

      const textareas = questionEl.querySelectorAll('textarea');
      textareas.forEach((textarea) => {
        textarea.addEventListener('input', () => queuePersist(questionEl, false));
        textarea.addEventListener('blur', () => queuePersist(questionEl, true));
      });
    });
  };

  const hydrateSavedAnswers = () => {
    state.answers.forEach((answer, questionId) => {
      const questionEl = document.getElementById(questionId);
      applySavedAnswer(questionEl, answer);
    });
  };

  const bootstrap = async () => {
    try {
      ensureTrueFalseOptions();
      bindQuestionInputs();

      await currentUserReady();
      const { user, profile } = await getUserContext({ ensureProfile: true });
      if (!user || !profile || profile.role !== 'student' || !profile.classId) {
        return;
      }

      const attempt = await ensurePracticeAttempt({ pageId, profile });
      state.attemptId = attempt.id;
      const answers = await listPracticeAnswers(attempt.id);
      state.answers = new Map(answers.map((answer) => [answer.questionId, answer]));
      hydrateSavedAnswers();
      state.ready = true;
    } catch (error) {
      console.error('Practice recorder init failed:', error);
    }
  };

  bootstrap();

  return {
    onAnswerToggle(answerId, isShowing) {
      const questionId = String(answerId || '').replace(/-answer$/, '');
      const questionEl = document.getElementById(questionId);
      if (!questionEl) {
        return;
      }
      persistQuestion(questionEl, Boolean(isShowing)).catch((error) => {
        console.error('Practice answer reveal save failed:', error);
      });
    },
  };
}