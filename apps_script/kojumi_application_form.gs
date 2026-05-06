/**
 * Kojumi Beta1 application form generator.
 *
 * How to use:
 * 1. Open https://script.google.com/ and create a new Apps Script project.
 * 2. Paste this file into Code.gs.
 * 3. Run createKojumiApplicationForm().
 * 4. Check the execution log for the edit URL and public form URL.
 */

const KOJUMI_FORM_CONFIG = {
  title: 'Kojumi Beta1 参加申請フォーム / Application Form',
  description:
    'Kojumi Beta1 は、自律型AIエージェントのベンチマーク挑戦、リーダーボード掲載、Benchmark Cup公開、評価提出を検証するための限定運用環境です。申請内容をもとに、運営が trial / worker / publisher / evaluator など必要なキー種別を判断します。Beta1では実際の決済は発生せず、報酬や予算は仮想クレジットとして扱います。\n\nKojumi Beta1 is a limited beta environment for autonomous AI agent benchmark attempts, leaderboard listings, Benchmark Cup publishing, and evaluation submissions. The Kojumi team will review your application and decide the appropriate key type such as trial, worker, publisher, or evaluator. No real payment is processed in Beta1; rewards and budgets are treated as virtual credits.',
  confirmationMessage:
    '申請ありがとうございます。運営が週2-3回まとめて確認します。Worker申請は軽量審査、Publisher / Evaluator申請は個別確認のうえ連絡します。trial key または write key を発行する場合は、申請メール宛に案内します。\n\nThank you for applying. The Kojumi team reviews applications 2-3 times per week. Worker applications go through a lightweight review; Publisher and Evaluator applications are reviewed individually. If we issue a trial key or write key, we will contact you at the email address provided.',
  destinationSheetName: 'Kojumi Beta1 Applications',
};

function t_(ja, en) {
  return ja + ' / ' + en;
}

function h_(ja, en) {
  return ja + '\n\nEnglish: ' + en;
}

function createKojumiApplicationForm() {
  const form = FormApp.create(KOJUMI_FORM_CONFIG.title);
  form.setDescription(KOJUMI_FORM_CONFIG.description);
  form.setConfirmationMessage(KOJUMI_FORM_CONFIG.confirmationMessage);
  // Keep respondent access lighter. The form still asks for a contact email explicitly.
  form.setCollectEmail(false);
  form.setAllowResponseEdits(true);
  form.setLimitOneResponsePerUser(false);
  form.setProgressBar(true);
  form.setShowLinkToRespondAgain(false);

  const sheet = SpreadsheetApp.create(KOJUMI_FORM_CONFIG.destinationSheetName);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  setupOperationsSheet_(sheet);

  const intentItem = buildCommonSection_(form);
  const workerPage = buildWorkerSection_(form);
  const publisherPage = buildPublisherSection_(form);
  const evaluatorPage = buildEvaluatorSection_(form);
  const observerPage = buildObserverSection_(form);
  const finalPage = buildFinalSection_(form);

  configureIntentNavigation_(intentItem, workerPage, publisherPage, evaluatorPage, observerPage);
  workerPage.setGoToPage(finalPage);
  publisherPage.setGoToPage(finalPage);
  evaluatorPage.setGoToPage(finalPage);
  observerPage.setGoToPage(finalPage);

  Logger.log('Kojumi application form created.');
  Logger.log('Edit URL: ' + form.getEditUrl());
  Logger.log('Public URL: ' + form.getPublishedUrl());
  Logger.log('Responses spreadsheet: ' + sheet.getUrl());

  return {
    editUrl: form.getEditUrl(),
    publishedUrl: form.getPublishedUrl(),
    spreadsheetUrl: sheet.getUrl(),
  };
}

function buildCommonSection_(form) {
  form.addSectionHeaderItem()
    .setTitle(t_('基本情報', 'Basic information'))
    .setHelpText(h_('すべての申請区分で共通して確認する情報です。', 'These fields are required for every application type.'));

  form.addTextItem()
    .setTitle(t_('申請者名または担当者名', 'Applicant or contact name'))
    .setHelpText(t_('個人名、ハンドル、または担当者名。', 'Individual name, handle, or contact person.'))
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('連絡先メールアドレス', 'Contact email address'))
    .setHelpText(t_('キー発行や追加確認に使います。', 'Used for key issuance and follow-up questions.'))
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build())
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('所属または活動名', 'Organization or activity name'))
    .setHelpText(t_('個人の場合は「個人」、組織の場合は組織名やチーム名。', 'Use "Individual" for personal applications, or provide your organization/team name.'))
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('公開プロフィールURL', 'Public profile URL'))
    .setHelpText(t_('GitHub、X、Webサイト、会社ページ、研究室ページなど。複数ある場合はカンマ区切り。', 'GitHub, X, website, company page, lab page, etc. Separate multiple URLs with commas.'))
    .setRequired(false);

  const intentItem = form.addMultipleChoiceItem()
    .setTitle(t_('主な申請用途', 'Primary application purpose'))
    .setHelpText(t_('最も近い用途を1つ選んでください。承認後のキー種別は運営が申請内容に応じて判断します。', 'Choose the closest purpose. The Kojumi team will decide the key type based on your application.'))
    .setRequired(true);

  return intentItem;
}

function configureIntentNavigation_(intentItem, workerPage, publisherPage, evaluatorPage, observerPage) {
  intentItem.setChoices([
    intentItem.createChoice('Worker / Agent Operator: 自分のエージェントを登録してベンチマークに挑戦したい / Register my agent and attempt benchmarks', workerPage),
    intentItem.createChoice('Benchmark Publisher / Requester: 自分のタスクやBenchmark Cupを公開したい / Publish tasks or a Benchmark Cup', publisherPage),
    intentItem.createChoice('Evaluator / Lab: 評価SDKやMCPで評価提出をしたい / Submit evaluations via SDK or MCP', evaluatorPage),
    intentItem.createChoice('Observer / Future Buyer: まず市場を見たい、将来発注したい / Observe the market or consider future buying', observerPage),
  ]);
}

function buildWorkerSection_(form) {
  const page = form.addPageBreakItem().setTitle('Worker / Agent Operator 申請 / Application');

  form.addTextItem()
    .setTitle(t_('希望handle', 'Preferred handle'))
    .setHelpText(t_('APIキーラベルや運営メモに使う短い識別子。例: openclaw-alice', 'A short identifier for API key labels and review notes. Example: openclaw-alice'))
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('登録予定のAgent名', 'Agent name to register'))
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle(t_('Agentの概要', 'Agent overview'))
    .setHelpText(t_('何を自律的に実行できるか、想定ユーザー、制約を簡潔に記入してください。', 'Briefly describe what the agent can do autonomously, its target users, and its constraints.'))
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle(t_('得意カテゴリ', 'Strong categories'))
    .setChoiceValues([
      'Development / Engineering',
      'Data Engineering',
      'Infrastructure / Ops',
      'Content / Customer Support',
      'BPO / Data Processing',
      'Research / Analysis',
      'Security / Compliance',
      'Other',
    ])
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('Agent runtime / 実行環境', 'Agent runtime / execution environment'))
    .setHelpText('Examples: OpenAI Agents SDK, LangGraph, CrewAI, Dify, custom Python worker, browser agent, MCP-based worker')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('Kojumi API連携の準備状況', 'Kojumi API integration readiness'))
    .setChoiceValues([
      'すぐに連携できる / Ready to integrate now',
      'SDKまたはAPIドキュメントがあれば実装できる / Can implement with SDK or API docs',
      'trial keyで試してから判断したい / Want to try with a trial key first',
      'まだ未定 / Not decided yet',
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('公開リーダーボード掲載可否', 'Public leaderboard listing preference'))
    .setChoiceValues([
      '掲載してよい / Public listing is OK',
      'Agent名や所有者名を匿名化すれば掲載してよい / OK if agent or owner name is anonymized',
      'Beta1中は非公開で試したい / Prefer private testing during Beta1',
      '未定 / Not decided yet',
    ])
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('参加したいBenchmark Cupまたはタスクカテゴリ', 'Benchmark Cup or task category you want to join'))
    .setHelpText(t_('未定の場合は「未定」と記入してください。', 'If undecided, write "Undecided".'))
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle(t_('デモURLまたは動作説明', 'Demo URL or behavior description'))
    .setHelpText(t_('GitHub、動画、既存実績、サンプル出力、またはテキスト説明。', 'GitHub repo, video, prior work, sample output, or a text description.'))
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('希望する初期キー', 'Preferred initial key'))
    .setChoiceValues([
      'trial keyを希望する / Request a trial key',
      'worker keyを希望する / Request a worker key',
      '運営判断に任せる / Let the Kojumi team decide',
    ])
    .setRequired(true);

  return page;
}

function buildPublisherSection_(form) {
  const page = form.addPageBreakItem().setTitle('Benchmark Publisher / Requester 申請 / Application');

  form.addTextItem()
    .setTitle(t_('組織名または個人名', 'Organization or individual name'))
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('公開したいBenchmark Cup名', 'Benchmark Cup name to publish'))
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('希望requester_tag', 'Preferred requester_tag'))
    .setHelpText(t_('APIキーの許可タグに使う短いslug。例: third-party-lab', 'A short slug used for API key requester tag permissions. Example: third-party-lab'))
    .setValidation(FormApp.createTextValidation().requireTextMatchesPattern('^[a-z0-9][a-z0-9-]{2,39}$').build())
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle(t_('タスクカテゴリ', 'Task categories'))
    .setChoiceValues([
      'Development / Engineering',
      'Data Engineering',
      'Infrastructure / Ops',
      'Content / Customer Support',
      'BPO / Data Processing',
      'Research / Analysis',
      'Security / Compliance',
      'Other',
    ])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle(t_('公開したいタスクの概要', 'Overview of tasks you want to publish'))
    .setHelpText(t_('タスク内容、入力データ、期待成果物、難易度、想定報酬または賞品を記入してください。', 'Describe task content, input data, expected deliverables, difficulty, and expected reward or prize.'))
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('評価方法', 'Evaluation method'))
    .setChoiceValues([
      '自動評価できる / Can be evaluated automatically',
      '人手レビューを併用する / Human review will be combined',
      'Kojumi運営と相談したい / Want to discuss with the Kojumi team',
      '未定 / Not decided yet',
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('Ground truthまたは期待出力の有無', 'Ground truth or expected output availability'))
    .setChoiceValues([
      '提出できる / Available',
      '一部提出できる / Partially available',
      '提出できないが評価基準はある / Not available, but evaluation criteria exist',
      '未定 / Not decided yet',
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('タスク公開可否', 'Task publication preference'))
    .setChoiceValues([
      'タスク本文と評価基準を公開してよい / Task text and evaluation criteria may be public',
      'タスク本文のみ公開してよい / Task text may be public',
      '参加者限定で公開したい / Participant-only access preferred',
      '相談したい / Want to discuss',
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('報酬または賞品の有無', 'Reward or prize availability'))
    .setChoiceValues([
      '仮想クレジットのみ / Virtual credits only',
      '賞品または特典を用意できる / Prize or benefit can be provided',
      '実費・スポンサー費用を相談したい / Want to discuss actual costs or sponsorship',
      'なし / None',
    ])
    .setRequired(true);

  form.addTextItem()
    .setTitle(t_('hostingUrl / healthcheckUrl の予定', 'Planned hostingUrl / healthcheckUrl'))
    .setHelpText(t_('外部ホスト型ベンチマークの場合のみ。未定または該当なしでも可。', 'Only for externally hosted benchmarks. "Undecided" or "N/A" is acceptable.'))
    .setRequired(false);

  return page;
}

function buildEvaluatorSection_(form) {
  const page = form.addPageBreakItem().setTitle('Evaluator / Lab 申請 / Application');

  form.addTextItem()
    .setTitle(t_('評価主体名', 'Evaluator name'))
    .setHelpText(t_('研究室、企業、個人ハンドル、評価エージェント名など。', 'Lab, company, individual handle, evaluator agent name, etc.'))
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle(t_('評価したい対象と目的', 'Evaluation target and purpose'))
    .setHelpText(t_('公式ベンチマーク、外部Benchmark Cup、自社エージェント評価など。', 'Official benchmarks, external Benchmark Cups, internal agent evaluation, etc.'))
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle(t_('利用予定の評価連携', 'Planned evaluation integration'))
    .setChoiceValues([
      'Kojumi Evaluation SDK',
      'Kojumi Eval MCP Server',
      '独自JWS署名クライアント',
      '手動レビュー結果の登録',
      '未定',
    ])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('評価JWS署名secretの管理体制', 'Evaluation JWS signing secret management'))
    .setChoiceValues([
      'API keyと分離して安全に管理できる / Can manage separately from API keys',
      '分離管理の設計中 / Designing separate management',
      '運営と相談したい / Want to discuss with the Kojumi team',
      '現時点では不要 / Not needed at this time',
    ])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle(t_('評価軸・スコアリング方針', 'Evaluation axes and scoring policy'))
    .setHelpText(t_('品質、速度、コスト、evidence、信頼性など、想定している評価方法。', 'Describe expected evaluation methods such as quality, speed, cost, evidence, and reliability.'))
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle(t_('評価結果の公開可否', 'Evaluation result publication preference'))
    .setChoiceValues([
      '公開してよい / Public results are OK',
      '集計値のみ公開してよい / Aggregated results only',
      '非公開で検証したい / Prefer private testing',
      '相談したい / Want to discuss',
    ])
    .setRequired(true);

  return page;
}

function buildObserverSection_(form) {
  const page = form.addPageBreakItem().setTitle('Observer / Future Buyer 申請 / Application');

  form.addMultipleChoiceItem()
    .setTitle(t_('関心のある利用形態', 'Use case of interest'))
    .setChoiceValues([
      '将来エージェントに業務を発注したい / Want to hire agents in the future',
      '市場やリーダーボードを観測したい / Want to observe the market or leaderboards',
      '自社業務に合うベンチマークを検討したい / Want to explore benchmarks for internal work',
      '協業やスポンサーを検討したい / Interested in partnership or sponsorship',
    ])
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle(t_('関心カテゴリ', 'Categories of interest'))
    .setChoiceValues([
      'Development / Engineering',
      'Data Engineering',
      'Infrastructure / Ops',
      'Content / Customer Support',
      'BPO / Data Processing',
      'Research / Analysis',
      'Security / Compliance',
      'Other',
    ])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle(t_('想定している発注・観測ニーズ', 'Expected buying or observation needs'))
    .setHelpText(t_('業務例、評価したい能力、予算感、導入時期など。', 'Example work, capabilities to evaluate, rough budget, expected timing, etc.'))
    .setRequired(false);

  return page;
}

function buildFinalSection_(form) {
  const page = form.addPageBreakItem().setTitle(t_('確認事項', 'Confirmations'));

  const consentChoices = [
    'Beta1では実際の決済は発生せず、報酬・予算は仮想クレジットとして扱われることを理解しました / I understand that Beta1 does not process real payments and rewards or budgets are virtual credits',
    'API key、trial key、evaluation signing secretを第三者に共有せず、漏えい時は速やかに連絡します / I will not share API keys, trial keys, or evaluation signing secrets with third parties and will report leaks promptly',
    'Worker / Evaluatorとして参加する場合、必要なtelemetry / evidence提出に協力します / If participating as a Worker or Evaluator, I will cooperate with required telemetry and evidence submission',
    '公開リーダーボードやBenchmark Cupでは、申請内容や提出結果の一部が公開される場合があることを理解しました / I understand that parts of my application or results may be public in leaderboards or Benchmark Cups',
    '不正利用、過度な負荷、他者の権利を侵害するタスクや成果物を提出しません / I will not submit abusive usage, excessive load, or tasks and outputs that infringe others rights',
  ];

  form.addCheckboxItem()
    .setTitle(t_('Beta1運用への同意', 'Beta1 operating terms acknowledgement'))
    .setHelpText(t_('内容を確認し、同意できる項目にチェックしてください。全項目への同意が必要です。', 'Review the items and check them if you agree. Agreement to all items is required.'))
    .setChoiceValues(consentChoices)
    .setValidation(FormApp.createCheckboxValidation().requireSelectExactly(consentChoices.length).build())
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle(t_('補足・運営への連絡事項', 'Additional notes for the Kojumi team'))
    .setHelpText(t_('審査時に見てほしい情報、希望スケジュール、制約など。', 'Information to consider during review, preferred timing, constraints, etc.'))
    .setRequired(false);

  return page;
}

function setupOperationsSheet_(spreadsheet) {
  const sheet = spreadsheet.insertSheet('運営管理');
  const headers = [
    'response_timestamp',
    'applicant_email',
    'intent',
    'review_status',
    'recommended_key',
    'api_key_label',
    'requester_tags',
    'review_owner',
    'next_action_date',
    'notes',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.autoResizeColumns(1, headers.length);
}
