import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestTagsFromContent } from '../src/renderer/src/lib/tagSuggestions';

test('suggests a tag when a configured alias appears in the title', () => {
  const suggestions = suggestTagsFromContent({
    title: '学童の夏休み対応',
    body: '',
    candidates: ['放課後児童クラブ', '夏休み'],
    aliases: { '放課後児童クラブ': ['学童', '学童保育'] },
  });
  assert.equal(suggestions.find((item) => item.tag === '放課後児童クラブ')?.matchedIn, 'alias');
});

test('direct tag match remains stronger than an alias-only match', () => {
  const suggestions = suggestTagsFromContent({
    title: '夏休みの学童対応',
    body: '',
    candidates: ['放課後児童クラブ', '夏休み'],
    aliases: { '放課後児童クラブ': ['学童'] },
  });
  assert.equal(suggestions[0]?.tag, '夏休み');
});
