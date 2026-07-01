# V530 — 未捕捉Promise拒否の防止

Electron main processで発生していた `UnhandledPromiseRejectionWarning` を防ぐため、バックグラウンドOCR、OCR heartbeat、ワークスペース集計更新、セマンティック再構築、Electron起動・終了処理のfire-and-forget Promiseに捕捉ハンドラを追加。

エラーは握りつぶさず `console.warn` / `console.error` に対象処理の識別子付きで記録する。
