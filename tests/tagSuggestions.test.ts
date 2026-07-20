import test from "node:test";
import assert from "node:assert/strict";
import { suggestTagsFromContent } from "../src/renderer/src/lib/tagSuggestions";

test("suggests existing tags using title and body matches", () => {
  const suggestions = suggestTagsFromContent({
    title: "放課後児童クラブの夏休み対応",
    body: "夏休みの放課後児童クラブについて、支援員の配置と開所時間を確認する。",
    candidates: ["会議", "放課後児童クラブ", "夏休み", "支援員", "予算"],
  });

  assert.equal(suggestions.length, 3);
  assert.deepEqual(
    new Set(suggestions.map((item) => item.tag)),
    new Set(["放課後児童クラブ", "夏休み", "支援員"]),
  );
  assert.ok(suggestions[0].score >= suggestions[1].score);
});

test("does not suggest tags already selected on the page", () => {
  const suggestions = suggestTagsFromContent({
    title: "FAQ運用",
    body: "FAQを確認して運用ルールを更新する。",
    candidates: ["FAQ", "運用", "会議"],
    activeTags: ["FAQ"],
  });

  assert.deepEqual(suggestions.map((item) => item.tag), ["運用"]);
});

test("uses workspace usage as a tie-breaker among matching tags", () => {
  const suggestions = suggestTagsFromContent({
    title: "会議資料",
    body: "会議の資料を確認する。",
    candidates: ["会議", "資料"],
    usageCounts: { "会議": 20, "資料": 1 },
  });

  assert.equal(suggestions[0].tag, "会議");
  assert.equal(suggestions[0].usageCount, 20);
  assert.equal(suggestions[1].usageCount, 1);
});

test("suggests a frequently co-occurring tag without auto-adding it", () => {
  const suggestions = suggestTagsFromContent({
    title: "保護者向けのお知らせ",
    body: "行事の準備状況を確認する。",
    candidates: ["放課後児童クラブ", "長期休業", "保護者", "支援員"],
    activeTags: ["放課後児童クラブ"],
    relatedTagCounts: { "長期休業": 4, "保護者": 2 },
    relatedTagLabels: {
      "長期休業": ["放課後児童クラブ"],
      "保護者": ["放課後児童クラブ"],
    },
  });

  const related = suggestions.find((item) => item.tag === "長期休業");
  assert.ok(related);
  assert.equal(related.matchedIn, "related");
  assert.equal(related.relatedCount, 4);
  assert.deepEqual(related.relatedTo, ["放課後児童クラブ"]);
});

test("does not invent a tag when no existing candidate matches or relates", () => {
  const suggestions = suggestTagsFromContent({
    title: "防災訓練",
    body: "避難経路を確認する。",
    candidates: ["会議", "予算", "採用"],
  });

  assert.deepEqual(suggestions, []);
});

test("uses small local feedback adjustment without outranking direct title match", () => {
  const suggestions = suggestTagsFromContent({
    title: "会議資料",
    body: "資料を確認する。",
    candidates: ["会議", "資料"],
    feedbackScores: { "会議": -8, "資料": 8 },
  });

  assert.equal(suggestions[0].tag, "会議");
});

test("omits candidates explicitly hidden by the caller", () => {
  const suggestions = suggestTagsFromContent({
    title: "夏休みの対応",
    body: "夏休みの予定を確認する。",
    candidates: ["夏休み", "予定"],
    hiddenCandidates: ["夏休み"],
  });

  assert.deepEqual(suggestions.map((item) => item.tag), ["予定"]);
});


test("suggests a tag from an alias without reading an uninitialized value", () => {
  const suggestions = suggestTagsFromContent({
    title: "学童の夏休み対応",
    body: "保護者への案内を作成する。",
    candidates: ["放課後児童クラブ", "予算"],
    aliases: { "放課後児童クラブ": ["学童", "学童保育"] },
  });

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].tag, "放課後児童クラブ");
  assert.equal(suggestions[0].matchedIn, "alias");
});
