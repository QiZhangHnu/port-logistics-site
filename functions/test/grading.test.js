'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeAutoResponse, normalizeText } = require('../grading');

test('normalizeText strips spaces and punctuation', () => {
  assert.equal(normalizeText(' 港口 物流。 '), '港口物流');
});

test('single choice grading matches the exact option', () => {
  const result = gradeAutoResponse('single', { selected: 'B' }, { correctAnswer: 'B' }, 2);
  assert.deepEqual(result, { autoCorrect: true, autoScore: 2, needsManualReview: false });
});

test('multiple choice grading requires an exact set match', () => {
  const result = gradeAutoResponse('multiple', { selectedList: ['B', 'A'] }, { correctAnswer: ['A', 'B'] }, 3);
  assert.deepEqual(result, { autoCorrect: true, autoScore: 3, needsManualReview: false });
});

test('fill blank grading normalizes text', () => {
  const result = gradeAutoResponse('fill_blank', { blanks: [' 基础 性 '] }, { blankMatchers: [['基础性']], correctAnswer: '基础性' }, 1);
  assert.deepEqual(result, { autoCorrect: true, autoScore: 1, needsManualReview: false });
});

test('short answer grading falls back to manual review', () => {
  const result = gradeAutoResponse('short_answer', { text: '港口设施分为基础设施和经营设施。' }, { correctAnswer: null }, 5);
  assert.deepEqual(result, { autoCorrect: null, autoScore: 0, needsManualReview: true });
});
