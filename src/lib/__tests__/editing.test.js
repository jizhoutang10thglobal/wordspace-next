const { normalizePasteText, isEdited } = require('../editing');

describe('editing（S6 编辑纯逻辑）', () => {
  describe('normalizePasteText', () => {
    it('\\r\\n 与 \\r 都归一为 \\n', () => {
      expect(normalizePasteText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    });

    it('普通文本原样、不 trim 不去空格', () => {
      expect(normalizePasteText('  hello  world  ')).toBe('  hello  world  ');
    });

    it('空串与 null/undefined 安全', () => {
      expect(normalizePasteText('')).toBe('');
      expect(normalizePasteText(null)).toBe('');
      expect(normalizePasteText(undefined)).toBe('');
    });
  });

  describe('isEdited', () => {
    it('串相同 → 未编辑', () => {
      expect(isEdited('<p>a</p>', '<p>a</p>')).toBe(false);
    });

    it('串不同 → 已编辑', () => {
      expect(isEdited('<p>ab</p>', '<p>a</p>')).toBe(true);
    });

    it('空值与基线比较安全', () => {
      expect(isEdited(null, '')).toBe(false);
      expect(isEdited('', null)).toBe(false);
      expect(isEdited('x', null)).toBe(true);
    });
  });
});
