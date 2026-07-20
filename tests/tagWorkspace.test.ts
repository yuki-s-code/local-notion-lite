import test from 'node:test';
import assert from 'node:assert/strict';
import { getSimilarWorkspaceTagCandidates, getWorkspaceTagStats, moveTagAliases, replaceTagInList } from '../src/renderer/src/lib/tagWorkspace';

test('replaceTagInList replaces and deduplicates a tag', () => {
  assert.deepEqual(replaceTagInList(['学童', '夏休み', '放課後児童クラブ'], '学童', '放課後児童クラブ'), ['放課後児童クラブ', '夏休み']);
});

test('moveTagAliases carries aliases to the surviving tag', () => {
  assert.deepEqual(moveTagAliases({ 学童: ['学童保育'], 放課後児童クラブ: ['放課後クラブ'] }, '学童', '放課後児童クラブ'), {
    放課後児童クラブ: ['放課後クラブ', '学童保育'],
  });
});

test('getWorkspaceTagStats counts each tag once per page', () => {
  const pages: any[] = [
    { properties: { tags: ['学童', '学童', '夏休み'] } },
    { properties: { tags: ['学童'] } },
  ];
  const stats = getWorkspaceTagStats(pages as any, {});
  assert.equal(stats[0].tag, '学童');
  assert.equal(stats[0].count, 2);
});


test('moveTagAliases can retain the former canonical tag as an alias', () => {
  assert.deepEqual(
    moveTagAliases({ 学童: ['学童保育'] }, '学童', '放課後児童クラブ', { preserveSourceAsAlias: true }),
    { 放課後児童クラブ: ['学童保育', '学童'] },
  );
});


test('getWorkspaceTagStats chooses the most-used label as the stable display label', () => {
  const pages: any[] = [
    { properties: { tags: ['FAQ'] } },
    { properties: { tags: ['faq'] } },
    { properties: { tags: ['faq'] } },
  ];
  const stats = getWorkspaceTagStats(pages as any, {});
  assert.equal(stats[0].tag, 'faq');
  assert.equal(stats[0].count, 3);
});


test('similar tag candidates surface an explicit alias linkage without merging automatically', () => {
  const pages: any[] = [
    { properties: { tags: ['学童'] } },
    { properties: { tags: ['放課後児童クラブ'] } },
    { properties: { tags: ['放課後児童クラブ'] } },
  ];
  const stats = getWorkspaceTagStats(pages as any, { 放課後児童クラブ: ['学童'] });
  const candidates = getSimilarWorkspaceTagCandidates(stats, { 放課後児童クラブ: ['学童'] });
  assert.deepEqual(candidates[0] && { sourceTag: candidates[0].sourceTag, targetTag: candidates[0].targetTag }, {
    sourceTag: '学童',
    targetTag: '放課後児童クラブ',
  });
  assert.ok((candidates[0]?.score ?? 0) >= 96);
});

test('similar tag candidates avoid unrelated short tags', () => {
  const pages: any[] = [
    { properties: { tags: ['会議'] } },
    { properties: { tags: ['回答'] } },
  ];
  const stats = getWorkspaceTagStats(pages as any, {});
  assert.deepEqual(getSimilarWorkspaceTagCandidates(stats, {}), []);
});

test('getWorkspaceTagStats surfaces alias-only tags as unused entries', () => {
  const pages: any[] = [{ properties: { tags: ['夏休み'] } }];
  const stats = getWorkspaceTagStats(pages as any, { 廃止候補: ['旧表記'] });
  assert.deepEqual(stats.find((item) => item.tag === '廃止候補'), {
    tag: '廃止候補',
    count: 0,
    aliases: ['旧表記'],
  });
});
