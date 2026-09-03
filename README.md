# 協和資糧 繁殖管理

協和資糧の繁殖管理PWAです。Google Apps Scriptバックエンドは、認証処理を含むため公開リポジトリでは管理しません。

## 構成

- ルート: GitHub Pagesで配信するPWA
- `apps-script-project/`: ローカル取得したApps Script（Git管理外）
- `tests/`: Apps Script用ローカルテスト（Git管理外）

## 自動日報

自動日報は、このPWAのApps Scriptバックエンドには組み込みません。Drive上の独立したApps Scriptプロジェクト「協和資糧 自動日報」が、生産データを読み取り専用で参照します。

独立した日報GASは元シートの行差分を監視し、日報用の状態と履歴を専用のDriveファイルへ保存します。BT測定は、当日測定した母豚だけを対象に直近7日間の値を横並びの表で表示します。分娩、ほ育事故、状態変更などは入力時刻順の一覧で表示し、日付と時刻は日本時間で処理します。

日報GAS側で明示的に有効化するまで、メール送信と定期トリガーは動きません。

## ローカルテスト

```bash
node --check apps-script-project/offline_sync.js
```

Apps Scriptの取得・反映コマンドは `apps-script-project/` で実行します。
