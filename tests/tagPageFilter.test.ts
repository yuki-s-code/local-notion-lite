import test from "node:test";
import assert from "node:assert/strict";
import { filterPagesByTags, normalizeTagFilterKey } from "../src/renderer/src/lib/tagPageFilter";

const pages = [
  { id: "a", properties: { tags: ["学童", "夏休み"] } },
  { id: "b", properties: { tags: ["学童", "保護者"] } },
  { id: "c", properties: { tags: ["夏休み"] } },
];

test("normalizes a hash-prefixed tag filter", () => {
  assert.equal(normalizeTagFilterKey(" #学童 "), "学童");
});

test("filters pages using AND semantics for selected tags", () => {
  assert.deepEqual(filterPagesByTags(pages, ["学童", "#夏休み"]).map((page) => page.id), ["a"]);
});

test("returns all pages when no tag filter is selected", () => {
  assert.deepEqual(filterPagesByTags(pages, []).map((page) => page.id), ["a", "b", "c"]);
});
