# 協和資糧 繁殖管理

協和資糧の繁殖管理PWAです。Google Apps Scriptバックエンドは、認証処理を含むため公開リポジトリでは管理しません。

## 構成

- ルート: GitHub Pagesで配信するPWA
- `apps-script-project/`: ローカル取得したApps Script（Git管理外）
- `tests/`: Apps Script用ローカルテスト（Git管理外）

## 自動日報

アプリで保存に成功した操作は、`アプリ同期履歴`へ入力内容と端末入力日時も記録します。日報は前回送信後に保存された操作をまとめるため、圏外で遅れて同期された入力も次回分に含まれます。

BT測定は、当日測定した母豚だけを対象に直近7日間の値を横並びの表で表示します。分娩、ほ育事故、状態変更などは入力時刻順の一覧で表示します。スプレッドシートのタイムゾーンにかかわらず、日報の日付と時刻は日本時間で処理します。

送信を有効にする前は、Apps Scriptの `previewKyowaDailyProductionReport()` で件名と本文を確認します。確認後に `activateKyowaDailyProductionReport('送信先メールアドレス')` を一度実行すると、毎日17:10頃（日本時間）のトリガーが作成されます。有効化時にテストメールは送信しません。

停止するときは `deactivateKyowaDailyProductionReport()` を実行します。

## ローカルテスト

```bash
node --check apps-script-project/offline_sync.js
node --check apps-script-project/daily_report.js
node tests/daily_report.test.js
```

Apps Scriptの取得・反映コマンドは `apps-script-project/` で実行します。
