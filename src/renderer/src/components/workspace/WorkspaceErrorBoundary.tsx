import React from "react";

type State = { error: Error | null };

export class WorkspaceErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[workspace] render failed", error, info);
  }

  private reset = () => {
    try {
      localStorage.removeItem("local-notion:workspace-layout-v776");
      localStorage.removeItem("local-notion:workspace-feature-tabs-v775");
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="workspace-error-boundary-v776">
        <section>
          <span aria-hidden="true">⚠</span>
          <h1>ワークスペースを復旧できます</h1>
          <p>{this.state.error.message || "画面の読み込み中にエラーが発生しました。"}</p>
          <button type="button" onClick={this.reset}>レイアウトを初期化して再読み込み</button>
        </section>
      </main>
    );
  }
}
