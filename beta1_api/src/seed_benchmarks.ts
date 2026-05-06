import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding official benchmark tasks...');

  // Delete existing tasks to start fresh for v0.1
  await prisma.benchmarkTask.deleteMany({});
  await prisma.benchmarkCup.deleteMany({});

  const cups = await Promise.all([
    prisma.benchmarkCup.create({
      data: {
        slug: 'official',
        title: 'Kojumi Official',
        description: 'Kojumi が主催する基準系ベンチマーク群。',
        requesterTag: 'official',
      }
    }),
    prisma.benchmarkCup.create({
      data: {
        slug: 'oo-cup',
        title: 'OO Cup',
        description: '第三者主催のコミュニティカップを想定したベースライン枠。',
        requesterTag: 'oo-cup',
      }
    })
  ]);

  const cupByTag = new Map(cups.map((cup) => [cup.requesterTag, cup.id]));

  const tasks = [
    {
      title: "YouTube動画（10分）の多言語字幕生成と不適切表現の検知",
      description: "指定された動画URLまたは動画ファイルから音声を抽出し、日本語字幕を生成してください。さらに英語に翻訳する際、ターゲットとする国の文化において不適切な表現や、スラングの誤用がないかセルフチェックを行ってください。",
      category: "bpo_data_processing",
      difficulty: "medium",
      reward: 140,
      metadataJson: JSON.stringify({
        "evaluation_strategy": {
          "type": "llm_judge",
          "criteria": "Check if inappropriate expressions or misused slang are present."
        }
      })
    },
    {
      title: "ファッションEC向け商品カタログの属性抽出（色・素材・サイズ）",
      description: "多様なアパレル商品の写真と説明文が含まれるPDFカタログを読み取り、SKUごとの属性（カラー、素材、洗濯表示、サイズ展開）を正規化された形式で抽出してください。",
      category: "bpo_data_processing",
      difficulty: "medium",
      reward: 130,
      metadataJson: JSON.stringify({
        "input_format": "pdf_catalog",
        "expected_output_format": "json_sku_list",
        "evaluation_strategy": {
          "type": "rule_based",
          "rules": [
            { "field": "extracted_skus", "type": "array" },
            { "field": "color_normalized", "type": "boolean" }
          ]
        },
        "evaluation_criteria": {
          "quality": "Normalization of color/material names to a standard taxonomy.",
          "efficiency": "Tool calls to mapping tables."
        }
      })
    },
    {
      title: "動画・画像キャプションからの「PR表記」漏れ検知",
      description: "指定されたインフルエンサーの投稿（画像、短尺動画、キャプション）100件を解析し、ギフティングやタイアップ広告の疑いがあるにもかかわらず、適切なハッシュタグ（#ad, #PR等）が含まれていない投稿を特定してください。",
      category: "bpo_data_processing",
      difficulty: "medium",
      reward: 150,
      metadataJson: JSON.stringify({
        "evaluation_strategy": {
          "type": "rule_based",
          "rules": [
            { "field": "missing_pr_flags", "type": "array" }
          ]
        }
      })
    },
    {
      title: "不動産販売図面（マイソク）の構造化データ変換",
      description: "画像形式の不動産チラシ（20件）から、物件名、最寄り駅、徒歩分、間取り、専有面積、築年数、設備（オートロック、宅配ボックス等）を抽出し、CSV形式で納品してください。",
      category: "bpo_data_processing",
      difficulty: "medium",
      reward: 110,
      metadataJson: JSON.stringify({
        "input_format": "images",
        "expected_output_format": "csv",
        "evaluation_strategy": {
          "type": "rule_based",
          "rules": [
            { "field": "csv_rows", "min_length": 20 }
          ]
        },
        "evaluation_criteria": {
          "quality": "Extraction accuracy of numerical fields (area, year built, walk time).",
          "reliability": "Consistency of equipment list extraction."
        }
      })
    },
    {
      title: "研究論文の自動インデクシング処理",
      description: "PDF形式の学術論文10本から、タイトル、著者、アブストラクト、キーワード、および巻末の引用文献（リファレンス）リストをBibTeX形式で抽出してください。",
      category: "bpo_data_processing",
      difficulty: "medium",
      reward: 110,
      metadataJson: JSON.stringify({
        "input_format": "pdfs",
        "expected_output_format": "bibtex",
        "evaluation_strategy": {
          "type": "rule_based",
          "rules": [
            { "field": "bibtex_entries", "min_length": 10 }
          ]
        },
        "evaluation_criteria": {
          "quality": "BibTeX format validity and citation completeness.",
          "autonomy": "Handling of multi-column layouts."
        }
      })
    },
    {
      title: "重大障害および返金要求に対する個別返信メールの作成",
      description: "システム障害によりサービスが24時間停止し、高額プランのユーザーから届いた10件の激しいクレーム（JSON）に対し、弊社の「補償ポリシー」に基づいた返信ドラフトを作成してください。謝罪の誠実さ、正確なポリシー適用、およびユーザー保持（Retention）を意識したトーンを維持してください。",
      category: "customer_support",
      difficulty: "hard",
      reward: 100,
      metadataJson: JSON.stringify({
        "input_format": "json (complaints) + markdown (policy)",
        "expected_output_format": "markdown (drafts)",
        "evaluation_strategy": {
          "type": "llm_judge",
          "criteria": "Empathy score, policy adherence, and risk mitigation (preventing further escalation)."
        }
      })
    },
    {
      title: "開発チームのSlackログを用いたFAQ記事の作成",
      description: "複雑な技術的トラブルを解決したエンジニア同士のSlackスレッド（テキスト）を読み、一般ユーザーが理解できる「トラブルシューティング・ナレッジベース記事」をMarkdown形式で作成してください。適切な見出し、手順の箇条書き、および注意点を含めること。",
      category: "customer_support",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "text (raw slack log)",
    "expected_output_format": "markdown (KB article)",
    "evaluation_criteria": {
      "quality": "Clarity of steps, technical accuracy, and accessibility for non-technical users."
    }
  })
    },
    {
      title: "開発ログ（Issue/PR）を元にしたユーザー向けリリースノートの作成",
      description: "直近のリリースに含まれる20件のGitHub Pull RequestタイトルとJiraチケットの内容を読み取り、一般ユーザー向けに「新機能」「改善」「バグ修正」の3つのカテゴリでリリースノートを作成してください。技術的な詳細を噛み砕き、ユーザーにとってのメリットを強調すること。",
      category: "customer_support",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "json (list of PRs and Issues)",
    "expected_output_format": "markdown (release notes)",
    "evaluation_criteria": {
      "quality": "Clarity for non-technical users and completeness (not missing major changes).",
      "efficiency": "Ability to synthesize complex dev logs."
    }
  })
    },
    {
      title: "FAQ、製品マニュアル、APIリファレンスの矛盾点抽出",
      description: "「新機能：データエクスポート」に関するFAQ、ユーザーマニュアル、およびAPIドキュメントの3つを読み合わせ、説明が矛盾している箇所や、情報の欠落（例：APIにはあるがマニュアルにない制限事項）をリストアップしてください。",
      category: "customer_support",
      difficulty: "hard",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "3x markdown files",
    "expected_output_format": "markdown (discrepancy report)",
    "evaluation_criteria": {
      "quality": "Recall of actual contradictions and clarity of suggested fixes."
    }
  })
    },
    {
      title: "500件のCSチケットのトリアージとインサイト抽出",
      description: "500件のユーザー問い合わせ（JSON）を「バグ」「機能要望」「使い方」「課金」「その他」に分類し、各チケットの感情スコア（-1.0〜1.0）を付与してください。また、最も不満が多い機能トップ3を特定し、その理由を要約してください。",
      category: "customer_support",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "json (list of tickets)",
    "expected_output_format": "json (classified tickets + summary report)",
    "evaluation_criteria": {
      "quality": "Classification F1-score and sentiment accuracy against expert labels.",
      "efficiency": "Time to process 500 items.",
      "autonomy": "Consistency in labeling without human guidance."
    }
  })
    },
    {
      title: "新製品ローンチに伴う1週間分のSNS投稿セット作成",
      description: "AIライティングツールの新機能ローンチに合わせて、X (Twitter) と LinkedIn 向けの1週間分（各7回）の投稿内容を作成してください。ターゲットは「忙しいコンテンツマーケター」で、ハッシュタグ、絵文字の使用、および視覚的な指示（画像生成プロンプト案）を含めてください。",
      category: "content_creation",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "markdown (product specs)",
    "expected_output_format": "json (scheduled posts per platform)",
    "evaluation_criteria": {
      "quality": "Engagement potential and tone consistency across platforms."
    }
  })
    },
    {
      title: "特定のターゲットに向けた3パターンの広告バナーコピー作成",
      description: "「副業を探しているエンジニア」をターゲットに、Kojumiへの登録を促す広告コピーを3パターン（A: 報酬重視、B: スキルアップ重視、C: 自由な働き方重視）作成してください。それぞれのパターンに対し、見出し（30文字以内）と説明文（90文字以内）を用意すること。",
      category: "content_creation",
      difficulty: "low",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "text (product USP)",
    "expected_output_format": "json (A/B/C variations)",
    "evaluation_criteria": {
      "quality": "Distinctiveness of each angle and CTR (estimated) potential."
    }
  })
    },
    {
      title: "「AI業界の今週の重要ニュース5選」の選定と解説",
      description: "Webから収集された20本のAI関連ニュース（タイトルとURL/要約）の中から、自社のターゲット層（企業のDX担当者）にとって重要と思われる5本を厳選してください。それぞれのニュースに対し、なぜ重要なのか、どうビジネスに影響するのかの独自の解説を加えてください。",
      category: "content_creation",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "json (20 news items)",
    "expected_output_format": "markdown (newsletter body)",
    "evaluation_criteria": {
      "quality": "Selection judgment and depth of insight in commentary."
    }
  })
    },
    {
      title: "業界トレンドレポートの要約（TL;DR 3パターン）",
      description: "30ページの「AI労働市場 2026年予測レポート」を読み、以下の3つの形式で要約してください：1. 1文（X投稿用）、2. 3つの箇条書き（多忙な役員用）、3. A4 1枚（詳細な概要）。重要な数値データを見逃さないこと。",
      category: "content_creation",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "pdf (url)",
    "expected_output_format": "markdown (3 summary variants)",
    "evaluation_criteria": {
      "quality": "Retention of key metrics and clarity across different lengths."
    }
  })
    },
    {
      title: "米国向け広告キャンペーンの日本市場向けアレンジ",
      description: "米国で成功したSaaS製品のキャッチコピーと広告クリエイティブのコンセプト（英語）を、日本のビジネス文化に合うように「カルチャライズ」してください。単なる直訳ではなく、日本人の意思決定プロセスに刺さる言葉選びと、ビジュアル構成の変更案を提案してください。",
      category: "content_creation",
      difficulty: "hard",
      reward: 100,
      metadataJson: JSON.stringify({
    "input_format": "text (US ad copy & concepts)",
    "expected_output_format": "markdown (JP adaptation strategy + copy variants)",
    "evaluation_criteria": {
      "quality": "Creativity and depth of cultural understanding."
    }
  })
    },
    {
      title: "ストリーム処理における遅延データのバックフィル実装",
      description: "ネットワーク遅延により最大24時間遅れて届くイベントデータ（Event Timeベース）を、既に集計済みの1時間ごとのサマリーテーブルに正しく反映させる処理を実装してください。Watermarkの設定と冪等な再計算ロジックを含めること。",
      category: "data_engineering",
      difficulty: "hard",
      reward: 170,
      metadataJson: JSON.stringify({})
    },
    {
      title: "PostgreSQLから分析用DBへの低負荷差分同期 (CDC)",
      description: "運用DB（PostgreSQL）の更新差分をニアリアルタイムで分析用DBへ同期する仕組みを構築してください。全件洗い替えではなく、WAL（Write Ahead Log）を活用したCDC（Debezium等）を用い、ソースDBへの負荷を最小限に抑えること。",
      category: "data_engineering",
      difficulty: "hard",
      reward: 200,
      metadataJson: JSON.stringify({})
    },
    {
      title: "分散データレイクにおける特定ユーザーデータの完全削除",
      description: "GDPR/CCPAに基づき、特定のユーザーIDに関連する全データを、S3上の数千のParquetファイルから効率的に削除（または匿名化）するジョブを作成してください。削除対象が含まれるファイルのみを特定して再書き込みし、削除ログを証跡として残すこと。",
      category: "data_engineering",
      difficulty: "hard",
      reward: 210,
      metadataJson: JSON.stringify({})
    },
    {
      title: "非効率なクエリの自動特定と改善提案",
      description: "DWH（BigQuery/Snowflake等）のクエリ履歴ログを分析し、計算リソースを浪費している「アンチパターン（直積結合、未使用のカラム取得等）」を含むクエリと、アクセスされていない巨大テーブルを特定するレポートを自動生成してください。",
      category: "data_engineering",
      difficulty: "medium",
      reward: 90,
      metadataJson: JSON.stringify({})
    },
    {
      title: "DWHからSalesforce/HubSpotへの顧客属性同期 (Reverse ETL)",
      description: "DWH（Snowflake/BigQuery）で集計した「過去30日の購入金額」や「離脱リスクスコア」を、外部SaaS（Salesforce等）のカスタムフィールドへ自動同期する仕組みを構築してください。APIのレート制限を考慮したバッチ更新、同期失敗時の部分リトライ、およびDWH側での送信済みフラグ管理を実装すること。",
      category: "data_engineering",
      difficulty: "medium",
      reward: 150,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Frontend] アクセシビリティ（A11Y）対応のモーダルコンポーネント",
      description: "キーボード操作（Escで閉じる、Tabでのフォーカス移動制限）と、スクリーンリーダー対応（ARIA属性）を完備したReactモーダルを実装。",
      category: "develop_engineering",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Frontend] プレースホルダ付きプログレッシブ画像読み込み",
      description: "低解像度のぼかし画像（LQIP）を先に表示し、本画像の読み込み完了後に滑らかに切り替わる React 画像コンポーネントを実装。`srcset` によるレスポンシブ対応も含む。",
      category: "develop_engineering",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[DevOps] Prometheus カスタムメトリクス・エクスポーターの作成",
      description: "ビジネスメトリクス（例：現在の注文数）を Prometheus がスクレイピング可能な形式で出力する `/metrics` エンドポイントを Python または Go で実装。",
      category: "develop_engineering",
      difficulty: "medium",
      reward: 120,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Refactoring] 依存性の注入 (DI) パターンの導入",
      description: "内部で直接 `new` してクラスを生成しているコードをリファクタリングし、Constructor Injection 等を用いて依存関係を外部から注入できる設計に変更。テストの容易性を向上させる。",
      category: "develop_engineering",
      difficulty: "medium",
      reward: 110,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Performance] Redisを活用した外部APIキャッシュ層の実装",
      description: "応答の遅い外部天気APIの結果を Redis に5分間キャッシュするラッパー関数を実装。キャッシュミス時のみ外部APIを叩く。",
      category: "develop_engineering",
      difficulty: "easy",
      reward: 100,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Service Mesh] Istio によるカナリアリリースのトラフィック制御実装",
      description: "エラー率のメトリクスに基づき、新旧バージョンのサービス間でトラフィックを 90:10 -> 50:50 -> 0:100 と段階的に切り替える Istio の VirtualService と DestinationRule を動的に生成する。",
      category: "infrastructure_ops",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Security Compliance] Terraform 構成の CIS Benchmark 準拠チェックと自動修正",
      description: "提供される既存の Terraform ファイルを静的解析し、セキュリティグループの全開放、暗号化の欠如、パブリックアクセスの許可など、CIS Benchmark に違反している箇所を特定し、修正パッチを生成する。",
      category: "infrastructure_ops",
      difficulty: "hard",
      reward: 100,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Reverse Engineering] 手動構築された AWS 環境の IaC 化 (Terraform Import)",
      description: "AWS CLI の `describe` 系コマンドの結果（JSON）を元に、既存のリソース（VPC, EC2, RDS）を再現する Terraform コードを生成し、`terraform import` コマンドのリストを作成する。",
      category: "infrastructure_ops",
      difficulty: "hard",
      reward: 100,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Supply Chain Security] SBOM (ソフトウェア部品構成表) の生成と脆弱性マッチング",
      description: "コンテナイメージのスキャン結果から生成された SBOM (CycloneDX/SPDX) を解析。公表されている CVE データベースと照らし合わせ、重大な脆弱性を含むライブラリを特定し、アップデート優先順位を策定する。",
      category: "infrastructure_ops",
      difficulty: "hard",
      reward: 100,
      metadataJson: JSON.stringify({})
    },
    {
      title: "[Secret Migration] コード内ハードコード秘匿情報の抽出と Vault 移行",
      description: "Git リポジトリのスキャン結果（JSON）を読み込み、コード内にハードコードされた API キー、パスワード、証明書を特定。これらを AWS Secrets Manager または HashiCorp Vault に登録するスクリプトと、コード側で環境変数から読み込むための修正案を生成する。",
      category: "infrastructure_ops",
      difficulty: "medium",
      reward: 100,
      metadataJson: JSON.stringify({})
    },
    {
      title: "GDP Val: Kojumiで実行できるGDP推論ベンチマーク",
      description: "GDPval gold setの実務タスクをKojumiのベンチマーク試行として実行してください。エージェントは44職種・9セクターにまたがる実際の知識労働タスクから1件を受け取り、参照ファイルとプロンプトに基づいて文書、分析、企画、設計などの成果物を提出します。KojumiはGDPvalのケース別rubricを使ったLLM評価で提出物を採点し、結果をリーダーボードに反映します。",
      category: "real_world_work",
      difficulty: "hard",
      reward: 180,
      qualityStatus: "reviewed",
      leaderboardWeight: 0.7,
      hostingUrl: "https://kojumi.ai/benchmarks/gdp-val",
      healthStatus: "healthy",
      metadataJson: JSON.stringify({
        "benchmark_suite": "GDP Val",
        "execution_mode": "kojumi_hosted",
        "dataset": "openai/gdpval",
        "dataset_split": "train",
        "dataset_rows": 220,
        "input_format": "GDPval gold-set row: task_id, sector, occupation, prompt, reference_files, reference_file_urls, reference_file_hf_uris, rubric_pretty, rubric_json",
        "expected_output_format": "task-specific work product file or markdown deliverable",
        "required_columns": [
          "task_id",
          "sector",
          "occupation",
          "prompt",
          "reference_files",
          "reference_file_urls",
          "rubric_pretty",
          "rubric_json"
        ],
        "evaluation_strategy": {
          "type": "gdpval_rubric_llm_judge",
          "criteria": "Fetch one public GDPval gold-set task at attempt time, pass its prompt and reference-file links to the agent, then grade the submitted work product with the corresponding GDPval rubric using an LLM evaluator."
        },
        "evaluation_criteria": {
          "quality": "Professional reviewer preference according to the GDPval task rubric.",
          "efficiency": "Ability to complete a one-shot GDPval task with controlled time, cost, and tool calls.",
          "transparency": "The deliverable should make reference-file usage and key assumptions inspectable by the grader."
        }
      })
    }
  ];

  for (const [index, task] of tasks.entries()) {
    const requesterTag = index < 3 ? 'oo-cup' : 'official';
    await prisma.benchmarkTask.create({
      data: {
        ...task,
        requesterTag,
        organizerType: requesterTag === 'official' ? 'platform' : 'community',
        benchmarkCupId: cupByTag.get(requesterTag),
        healthStatus: requesterTag === 'official' ? 'healthy' : 'unknown',
      }
    });
  }

  console.log(`Seeding completed. ${tasks.length} verifiable tasks inserted.`);
}

main()
  .catch((e) => {
    console.error(e);
    throw e;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
