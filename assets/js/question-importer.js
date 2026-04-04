const PRACTICE_BANKS = [
  { bankId: 'all-single', type: 'single', url: 'practice/all-single-choice.html' },
  { bankId: 'all-multiple', type: 'multiple', url: 'practice/all-multiple-choice.html' },
  { bankId: 'all-fill', type: 'fill_blank', url: 'practice/all-fill-in.html' },
  { bankId: 'all-true-false', type: 'true_false', url: 'practice/all-true-false.html' },
  { bankId: 'all-short', type: 'short_answer', url: 'practice/all-short-answer.html' },
];

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function normalizeStem(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n');
  return cleanText(wrapper.textContent || '');
}

function extractLabeledText(lines, label) {
  const line = lines.find((item) => item.startsWith(label));
  return line ? cleanText(line.replace(label, '')) : '';
}

function extractQuestionLines(answerBox) {
  return Array.from(answerBox?.querySelectorAll('p') || []).map((item) => cleanText(item.textContent || ''));
}

function extractOptions(questionEl) {
  const labels = Array.from(questionEl.querySelectorAll('.option-label'));
  if (!labels.length) {
    return null;
  }
  return labels.map((labelEl) => {
    const input = labelEl.querySelector('input');
    const rawText = cleanText(labelEl.textContent || '');
    const key = (input?.value || rawText.slice(0, 1)).trim().toUpperCase();
    const text = cleanText(rawText.replace(new RegExp(`^${key}[.．、\s]*`), ''));
    return { key, text };
  });
}

function buildKnowledgePointId(knowledgeText) {
  const compact = cleanText(knowledgeText);
  if (!compact) {
    return [];
  }
  const slug = compact
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return [`kp:${slug}`];
}

function splitAcceptableAnswers(answerText) {
  const text = cleanText(answerText);
  if (!text) {
    return [[]];
  }
  const parts = text.split(/[\/／;；,，、]|\s+or\s+/i).map((item) => cleanText(item)).filter(Boolean);
  return [parts.length ? parts : [text]];
}

function parseCorrectAnswer(questionType, answerText) {
  const text = cleanText(answerText);
  if (!text) {
    return null;
  }
  if (questionType === 'multiple') {
    return Array.from(new Set(text.toUpperCase().replace(/[^A-Z]/g, '').split('').filter(Boolean)));
  }
  if (questionType === 'single' || questionType === 'true_false') {
    return text.toUpperCase().replace(/[^A-Z对错√×TF]/g, '').slice(0, 1) || text;
  }
  if (questionType === 'fill_blank') {
    return text;
  }
  return null;
}

function extractChapterCode(knowledgeText, chapterLabel) {
  const codeMatch = cleanText(knowledgeText).match(/^(\d+(?:\.\d+)?)/);
  if (codeMatch) {
    return codeMatch[1];
  }
  const chapterMatch = cleanText(chapterLabel).match(/第\s*(\d+)\s*章/);
  return chapterMatch ? chapterMatch[1] : '';
}

function chapterNumberFromCode(chapterCode, chapterLabel) {
  const fromCode = String(chapterCode || '').match(/^(\d+)/);
  if (fromCode) {
    return Number(fromCode[1]);
  }
  const match = cleanText(chapterLabel).match(/第\s*(\d+)\s*章/);
  return match ? Number(match[1]) : null;
}

function parseAbilityLookup(abilityMap) {
  const lookup = new Map();
  for (const moduleItem of abilityMap?.modules || []) {
    const chapterNumbers = Array.from(new Set((String(moduleItem.chapters || '').match(/\d+/g) || []).map((item) => Number(item))));
    const min = chapterNumbers.length ? Math.min(...chapterNumbers) : null;
    const max = chapterNumbers.length ? Math.max(...chapterNumbers) : null;
    const abilityIds = (moduleItem.abilities || []).map((item) => item.id).filter(Boolean);
    for (let chapter = min || 0; chapter <= (max || 0); chapter += 1) {
      const current = lookup.get(chapter) || [];
      lookup.set(chapter, Array.from(new Set([...current, ...abilityIds])));
    }
  }
  return lookup;
}

function buildQuestionDocs(bank, questionEl, abilityLookup) {
  const answerBox = questionEl.querySelector('.answer');
  const lines = extractQuestionLines(answerBox);
  const sourceTag = questionEl.id;
  const chapterLabel = cleanText(questionEl.querySelector('.badge')?.textContent || '');
  const knowledgeText = extractLabeledText(lines, '知识点：');
  const chapterCode = extractChapterCode(knowledgeText, chapterLabel);
  const chapterNumber = chapterNumberFromCode(chapterCode, chapterLabel);
  const explanation = extractLabeledText(lines, '解析：');
  const answerText = extractLabeledText(lines, '参考答案：');
  const abilityIds = chapterNumber != null ? (abilityLookup.get(chapterNumber) || []) : [];

  return {
    questionItem: {
      questionId: sourceTag,
      bankId: bank.bankId,
      type: bank.type,
      stem: normalizeStem(questionEl.querySelector('.stem')?.innerHTML || ''),
      options: extractOptions(questionEl),
      chapterCode,
      chapterLabel,
      knowledgePointIds: buildKnowledgePointId(knowledgeText),
      abilityIds,
      difficulty: 2,
      sourceTag,
      status: 'active',
    },
    questionKey: {
      questionId: sourceTag,
      autoGradable: bank.type !== 'short_answer',
      correctAnswer: parseCorrectAnswer(bank.type, answerText),
      blankMatchers: bank.type === 'fill_blank' ? splitAcceptableAnswers(answerText) : null,
      subjectiveRubric: bank.type === 'short_answer' ? (explanation || answerText) : null,
      explanation,
      maxScore: bank.type === 'short_answer' ? 10 : 1,
    },
  };
}

async function fetchAbilityLookup() {
  const response = await fetch('能力图谱/src/gangkou_wuliu_ability_map.json', { cache: 'no-store' });
  if (!response.ok) {
    return new Map();
  }
  const abilityMap = await response.json();
  return parseAbilityLookup(abilityMap);
}

export async function buildQuestionSeedFromPracticePages() {
  const abilityLookup = await fetchAbilityLookup();
  const seed = [];

  for (const bank of PRACTICE_BANKS) {
    const response = await fetch(bank.url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`无法读取题库页面：${bank.url}`);
    }
    const html = await response.text();
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(html, 'text/html');
    const questions = Array.from(documentNode.querySelectorAll('.question'));
    for (const questionEl of questions) {
      seed.push(buildQuestionDocs(bank, questionEl, abilityLookup));
    }
  }

  return seed;
}
