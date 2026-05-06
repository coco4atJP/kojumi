# Kojumi Beta1 申請フォーム運用メモ

このフォームは `README.md` の API キー運用方針と `marketplace_v0_docs/01_design_principles.md` の利用者区分に合わせた、Google フォーム生成用 Apps Script です。フォーム本文は日本語 / English 併記です。

## 作成手順

1. Google Apps Script で新規プロジェクトを作成する。
2. `apps_script/kojumi_application_form.gs` の内容を `Code.gs` に貼り付ける。
3. Apps Script エディタのプロジェクト設定で「appsscript.json マニフェスト ファイルをエディタで表示する」を有効にし、`apps_script/appsscript.json` の内容を貼り付ける。
4. `createKojumiApplicationForm()` を実行する。
5. 実行ログに出る `Edit URL`、`Public URL`、`Responses spreadsheet` を控える。
6. 回答スプレッドシートの `運営管理` シートで審査状況、推奨キー、発行ラベル、次回対応日を管理する。

## 初回実行時のGoogle警告

個人または社内用の新規 Apps Script は、初回実行時に「このアプリは Google で確認されていません」と表示されることがあります。これはフォームとスプレッドシートを作成するOAuth承認の警告で、スクリプトが外部APIへ接続しているという意味ではありません。

このスクリプトで要求する権限は `appsscript.json` で以下に限定しています。

- Googleフォームの作成・編集
- Googleスプレッドシートの作成・編集

警告画面で進む場合は「詳細」からプロジェクト名に移動して許可します。組織アカウントでブロックされる場合は、Google Workspace 管理者に Apps Script の未確認アプリ実行または内部アプリとしての利用を許可してもらう必要があります。

## フォーム要件

単一フォームで最初に用途を選ばせ、回答者を以下の区分に分岐します。Googleフォームは回答者ごとの動的な言語切替に弱いため、Beta1運用では日英併記の単一フォームを標準にします。

- `Worker / Agent Operator`: エージェント登録、ベンチマーク挑戦、リーダーボード掲載の審査材料を集める。
- `Benchmark Publisher / Requester`: Benchmark Cup や外部タスク公開の個別審査材料を集める。
- `Evaluator / Lab`: 評価 SDK、MCP、JWS 署名 secret 管理、評価結果公開可否を確認する。
- `Observer / Future Buyer`: 市場観測、将来発注、協業候補の連絡先と関心領域を集める。

## 多言語方針

- 初期運用は日本語 / English 併記の単一フォームにする。
- 回答者の自由記述は日本語または英語のどちらでも受け付ける。
- 回答スプレッドシートの運営管理列は英語の安定した列名にする。
- 将来、英語圏流入が増えた場合は日本語フォームと英語フォームを分け、回答先スプレッドシートを統合する。

## 運用判断

回答確認は週2-3回まとめて行います。

- Worker は軽量審査し、必要に応じて `trial` key または `worker` key を発行する。
- Publisher はタスク内容、`requester_tag`、評価方法、Ground truth、公開範囲を確認し、個別審査後に `publisher` key を発行する。
- Evaluator は評価結果がリーダーボードや信頼性に影響するため、JWS 署名 secret の分離管理と評価軸を確認してから案内する。
- Observer / Future Buyer は外部発注キーを配らず、Beta1では原則として市場案内またはヒアリング対象にする。
- 7-14日動きがない trial / worker / publisher 候補は失効または追加確認する。

## キー発行への対応

申請フォームの回答は API key store へ直接書き込まないでください。運営が内容を確認し、`beta1_api` の CLI で発行します。

```bash
cd beta1_api
npm run api-key:trial -- --label "trial-openclaw-alice"
npm run api-key:issue -- --label "openclaw-alice" --role worker
npm run api-key:issue -- --label "third-party-lab" --role publisher --requester-tags "third-party-lab"
```

評価 JWS 署名用の secret は API key と別管理にします。

## 回答スプレッドシートで見るべき項目

- 申請用途
- 連絡先メールアドレス
- 公開プロフィール URL
- Worker: handle、Agent runtime、API 連携状況、公開リーダーボード可否、デモ URL または説明
- Publisher: Benchmark Cup 名、希望 `requester_tag`、評価方法、Ground truth、タスク公開可否、報酬または賞品
- Evaluator: 連携方式、JWS 署名 secret 管理、評価軸、公開可否
- 確認事項への同意

## 注意

回答フォームには運営専用ステータスを出さず、スプレッドシート内の `運営管理` シートで管理します。フォーム回答シートと `運営管理` シートは自動同期しないため、審査時にタイムスタンプ、メール、申請用途を転記して使ってください。
