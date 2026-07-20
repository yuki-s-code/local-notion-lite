# v315 Smart Assist Trusted Answer UX

v315 focuses on the user experience of the FAQ answer screen after v314 made FAQ improvement proposals editable and applicable.

## Main changes

- Shows why the selected FAQ was chosen.
- Shows matched terms used for the selection.
- Shows nearby FAQ candidates directly under the answer.
- Avoids strong wording when confidence is low or insufficient.
- Carries server-side ranking reasons, matched terms, and candidate FAQ data into the chat message model.
- Adds a compact trust panel below FAQ answers.

## Why

In a municipal or internal FAQ system, a fast answer is not enough. Users need to understand whether the result is reliable, why it matched, and what nearby FAQ they can check when the match is ambiguous.

## Expected behavior

High-confidence answers remain concise.

Low or medium-confidence answers now start with a non-assertive note such as:

> このFAQが近い候補ですが、完全一致とは断定していません。

The UI then shows:

- 根拠FAQ
- このFAQを選んだ理由
- matched keyword tags
- 近いFAQ候補
- 確認ポイント / 次の操作 when available

## Files touched

- `src/renderer/src/components/screens/SmartAssistScreen.tsx`
- `src/renderer/src/styles/app.css`
