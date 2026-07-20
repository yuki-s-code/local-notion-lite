/** Editor-only local AI transformation. It deliberately receives only the
 * generation primitives it needs, so it cannot accidentally invoke workspace
 * retrieval, semantic indexing, or shared-folder operations. */
export class EditorAiEditService {
  constructor(private readonly deps: {
    getSettings: () => Promise<any>;
    checkEngine: () => Promise<any>;
    runGeneration: (prompt: string, settings: any, engine: any) => Promise<any>;
    cleanGeneratedText: (value: string, prompt: string) => string;
  }) {}

  async generate(input: any): Promise<any> {
    const operation = [
      "summary",
      "rewrite",
      "bullets",
      "todo",
      "custom",
    ].includes(String(input?.operation || ""))
      ? String(input.operation)
      : "custom";
    const sourceText = String(input?.text || "")
      .replace(/\r\n/g, "\n")
      .trim();
    const customInstruction = String(input?.instruction || "").trim();
    if (!sourceText)
      return {
        ok: false,
        generated: false,
        message: "編集する文章がありません。",
      };
    if (sourceText.length > 8_000)
      return {
        ok: false,
        generated: false,
        message: "選択範囲が長すぎます。8,000文字以内にしてください。",
      };
    if (operation === "custom" && !customInstruction)
      return {
        ok: false,
        generated: false,
        message: "AIへの指示を入力してください。",
      };

    const action =
      operation === "summary"
        ? "次の文章を、内容・固有名詞・数値を変えずに簡潔に要約してください。"
        : operation === "rewrite"
          ? "次の文章だけを、意味・事実・数値・固有名詞を変えずに、やさしく読みやすい日本語へ書き換えてください。"
          : operation === "bullets"
            ? "次の文章だけを、内容を落とさず、読みやすい箇条書きへ整理してください。"
            : operation === "todo"
              ? "次の文章だけから、実行すべきTODO・確認事項・期限を箇条書きで抽出してください。本文にない内容は追加しないでください。"
              : customInstruction;

    const settings = await this.deps.getSettings();
    const check = await this.deps.checkEngine();
    if (!settings.enabled || settings.provider !== "llama-cpp" || !check?.ok) {
      return {
        ok: false,
        generated: false,
        message:
          check?.message ||
          "ローカル生成AIが有効になっていません。生成AI設定を確認してください。",
      };
    }

    const prompt = [
      "あなたは文章編集専用のローカルAIです。",
      "以下の【編集対象】だけを編集してください。ワークスペース検索、関連情報検索、タグ、ページ名、参照候補、根拠、説明、前置き、感想、注意書きは一切出力しないでください。",
      "元の文章にない事実、人物、場所、日付、数値、制度、候補を追加しないでください。",
      "出力は編集後の本文だけにしてください。引用符、Markdownコードブロック、「編集結果:」などの見出しは不要です。",
      operation === "rewrite"
        ? "文章の長さは元文の0.7倍〜1.3倍を目安にし、要約しすぎないでください。"
        : "",
      `【依頼】\n${action}`,
      "",
      `【編集対象】\n${sourceText}`,
      "",
      "【出力】",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const runSettings = {
        ...settings,
        maxTokens: Math.max(
          96,
          Math.min(
            768,
            operation === "summary" ? 320 : Number(settings.maxTokens || 384),
          ),
        ),
        contextSize: Math.max(
          1024,
          Math.min(4096, Number(settings.contextSize || 2048)),
        ),
        temperature: Math.max(
          0,
          Math.min(0.35, Number(settings.temperature ?? 0.15)),
        ),
      } as any;
      const generated = await this.deps.runGeneration(
        prompt,
        runSettings,
        check,
      );
      // Editor AI must not depend on Smart Assist's answer normalizer: that
      // normalizer intentionally uses workspace grounding state and lives inside
      // the chat-answer flow. Keep editor output isolated and only remove
      // presentation wrappers the local model may add.
      const answer = String(
        this.deps.cleanGeneratedText(generated.text, prompt) ||
          generated.text ||
          "",
      )
        .replace(/^```(?:markdown|md|text)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .replace(/^(?:編集結果|書き換え後|要約結果|出力)\s*[:：]\s*/i, "")
        .trim();
      if (!answer) throw new Error("生成AIの編集結果が空でした。");
      if (
        /^(?:関連しそうな情報|一番近いのは|関連候補|根拠|参照候補)/.test(answer)
      ) {
        throw new Error(
          "編集専用の回答ではない出力を検出したため、適用を停止しました。もう一度実行してください。",
        );
      }
      return {
        ok: true,
        generated: true,
        answer,
        elapsedMs: generated.elapsedMs,
        operation,
        mode: "editor-only-v453",
      };
    } catch (error: any) {
      return {
        ok: false,
        generated: false,
        message: String(error?.message || "AI編集に失敗しました。"),
      };
    }
  
  }
}
