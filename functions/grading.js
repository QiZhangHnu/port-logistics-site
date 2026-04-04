'use strict';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、“”‘’；：,.!?()（）【】\[\]-]/g, '');
}

function normalizeOptionSet(values) {
  return Array.from(
    new Set((Array.isArray(values) ? values : []).map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))
  ).sort();
}

function compareSingle(selected, correctAnswer) {
  return String(selected || '').trim().toUpperCase() === String(correctAnswer || '').trim().toUpperCase();
}

function compareMultiple(selectedList, correctAnswer) {
  const selected = normalizeOptionSet(selectedList);
  const correct = normalizeOptionSet(correctAnswer);
  if (selected.length !== correct.length) {
    return false;
  }
  return selected.every((value, index) => value === correct[index]);
}

function compareFillBlank(responsePayload, questionKey) {
  const textCandidate = normalizeText(
    Array.isArray(responsePayload?.blanks) && responsePayload.blanks.length
      ? responsePayload.blanks.join('')
      : responsePayload?.text
  );
  if (!textCandidate) {
    return false;
  }

  const matcherGroups = Array.isArray(questionKey.blankMatchers) && questionKey.blankMatchers.length
    ? questionKey.blankMatchers
    : [[questionKey.correctAnswer]];

  return matcherGroups.some((group) =>
    (Array.isArray(group) ? group : [group]).some((candidate) => normalizeText(candidate) === textCandidate)
  );
}

function gradeAutoResponse(questionType, responsePayload, questionKey, maxScore) {
  const score = Number(maxScore || 0);

  switch (questionType) {
    case 'single':
    case 'true_false': {
      const isCorrect = compareSingle(responsePayload?.selected, questionKey.correctAnswer);
      return { autoCorrect: isCorrect, autoScore: isCorrect ? score : 0, needsManualReview: false };
    }
    case 'multiple': {
      const isCorrect = compareMultiple(responsePayload?.selectedList, questionKey.correctAnswer);
      return { autoCorrect: isCorrect, autoScore: isCorrect ? score : 0, needsManualReview: false };
    }
    case 'fill_blank': {
      const isCorrect = compareFillBlank(responsePayload, questionKey);
      return { autoCorrect: isCorrect, autoScore: isCorrect ? score : 0, needsManualReview: false };
    }
    default:
      return { autoCorrect: null, autoScore: 0, needsManualReview: true };
  }
}

module.exports = {
  gradeAutoResponse,
  normalizeText,
  compareSingle,
  compareMultiple,
  compareFillBlank,
};
