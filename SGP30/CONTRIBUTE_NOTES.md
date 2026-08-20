# 工程7 コントリビュート準備メモ

提出範囲の決定、PR 説明文の下書き、想定される質問への回答をまとめたもの。
**このファイルは手元の作業用で、提出はしません。**

---

## 提出範囲の決定（案B）

| 項目                                  | 提出 | 備考                                                                             |
| ------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| ドライバー 6メソッド                  | ✅   | `init` / `read` / `readRaw` / `readSerialNumber` / `getBaseline` / `setBaseline` |
| `packages/sgp30/README.md`            | ✅   | `PACKAGE_README.md` が下書き                                                     |
| `esm-examples/sgp30/`（基本 example） | ✅   | `main.js` + `readme.md` + `schematic.png`                                        |
| `esm-examples/sgp30_baseline/`        | ❌   | **提出しない**                                                                   |
| `main_baseline.js`                    | ❌   | **提出しない。** 手元のリグレッションテストとして残す                            |
| ベースラインの永続化                  | ❌   | 後続 PR の候補                                                                   |
| `Set_humidity` / `Measure_test`       | ❌   | 検証不能・制約未確認のため見送り                                                 |

### `main_baseline.js` を提出しない理由

**あれは example ではなくテストです。** `esm-examples` は初学者向けの最小限のデモであり、
assertion と `throw` が入っているのは異物です。「なぜ example が例外を投げるのか」と
問われたときに反論しづらいため、手元に残します。

副次的な利点として、**「Sensirion は約60分と言っているのに、なぜ15秒の値を使っているのか」
という質問自体が発生しません。** この質問は答えにくいものでした。

ドライバーのメソッド自体は各10行程度で、実機検証も済んでいるため残します。
パラメータ順の罠を README に記録できることには独立した価値があります。

---

## PR 説明文の下書き

### ベースラインの保存・復元について

```
このドライバーは getBaseline() / setBaseline() でベースラインの読み書きを提供しますが、
値の永続化そのものは実装していません。保存先・保存間隔・鮮度判定はアプリケーション側の
方針であり、ドライバーの責務ではないと考えたためです。
また esm-examples には状態をディスクに永続化する前例がないため、example にも含めていません。

Sensirion の Driver Integration Guide が定める条件は README に明記しており、
アプリケーション側で統合ガイド準拠の実装ができる状態にしています。

- 有効な値が返るまで: iaq_init から約60分
- 保存してよくなるまで: 12時間の連続運転
- 保存の推奨間隔: 約1時間ごと
- 保存値の有効期限: 最大7日

検証範囲を明記しておきます。実機 (Raspberry Pi Zero + M5Stack U088) で確認したのは
I2C レベルの挙動、すなわちパラメータ順・書き込みの反映・元の値への復元までです。
12時間運転後の学習済みベースラインを保存・復元して精度が改善することは未検証です。
必要であれば追試します。
```

### 実機での動作確認内容

```
Raspberry Pi Zero + M5Stack TVOC/eCO2 Unit (U088) で確認しました。

- init(): feature set を読んで初期化が通る
- readSerialNumber(): 000001f9293c が毎回同じ値で返る
- read(): 起動15秒間は 400ppm / 0ppb の固定値、以降は物理応答あり
  （息を吹きかけて 400 -> 1580ppm、エタノールで 400 -> 27246ppm）
- readRaw(): eCO2 と逆相関することを確認
  （eCO2 の変化倍率が H2 の濃度換算比と平均誤差 4.3% で一致）
- getBaseline(): 未確立時は 0、init() から約15秒で有効化。3セッションで再現
- setBaseline(): 現在値と異なる値を書いて読み戻し、元の値に復元できることを確認
```

---

## 想定される質問と回答

### Q. なぜ Sensirion の統合ガイド通りに永続化を実装しないのか

1. **責務の分離** — 永続化はドライバーの仕事ではない。ドライバーはファイルシステムを持たず、
   値がいつ保存されたかも知りようがない。7日以内の判定はアプリケーション側のポリシー
2. **example の前例** — 既存の esm-examples に状態をディスクへ永続化している例がない
3. **正しい使い方を妨げていない** — API は公開済みで、4つの条件も README に明記した。
   アプリケーション側で統合ガイド準拠の実装が今すぐできる

そのうえで検証範囲（I2C レベルまで、12時間の運転は未検証）を自分から開示する。
「12時間回すのが難しいから」を主理由にすると努力回避に聞こえるため、順序に注意する。

### Q. なぜ湿度補正（Set_humidity, 0x2061）がないのか

補正が効いたかを外部から検証できない。絶対湿度への換算式と 8.8 固定小数点の実装コストに対し、
確認できるのは「エラーが出ない」ことだけ。実用には SHT30 等の第2センサーが必要で、
example が2デバイス構成になる。Typical ユースケースから外れると判断した。

### Q. なぜセルフテスト（Measure_test, 0x2032）がないのか

データシートに「`sgp30_iaq_init` の後には使うべきでない」「実行後はスリープモードに入る」と
明記されており、`init()` 内での安全な配置に追加検証が必要。同じ Sensirion の sgp40 ドライバーは
init 内で self-test しているが、SGP30 で同じ構成にしていいかは別途確認が必要と判断した。

### Q. feature set の判定が Adafruit と違うのはなぜか

Adafruit は `(featureSet & 0xF0) === 0x0020` で判定しているが、この条件は不適切。

- **SGP40（`0x3220`）も通ってしまう** — `& 0xF0` すると同じ `0x20` になる
- **将来の版数変更で誤判定する** — データシート Table 9 は
  "the last 5 bits of the product version are subject to change" と明記している

データシート Table 9 では上位バイトが製品タイプ（SGP30 は 0）なので、
製品タイプだけで判定するようにした。`0x0020` / `0x0022` / 将来の版数を受け入れ、
SGP40 を拒否することをモックで確認済み。

### Q. なぜ生信号（readRaw）を公開するのか

1. `read()` の値はベースライン補正を受けるため「最近いちばんきれいだった空気からの相対値」で、
   絶対的な空気の状態を表さない。独自の判定ロジックを組む場合は生信号が必要
2. **`read()` の出力には上限がある。** 実測で TVOC が 60000ppb に張り付いた一方、
   生信号は動き続けた。上限はセンサーの限界ではなく出力フォーマットの限界であり、
   強い VOC イベントを扱うには生信号が必要
3. 初期化フェーズの15秒間も生信号は動くため、疎通確認に使える

### Q. なぜ `read()` を1秒間隔で呼ぶ前提なのか。ドライバー内で待たないのか

1秒間隔はデータシートの指定で、動的ベースライン補正がこの周期を前提にしている。

ドライバー内で15秒待たせる実装にはしなかった。ドライバーが黙って15秒ブロックすると
利用者から見て不可解で、「起動しない」と誤解されるため。代わりに example のコメントと
README に明記した。

### Q. エラー処理が throw なのはなぜか（DRIVER_GUIDE は console.error + return null）

リポジトリの `docs/contributing/coding-standards.md` と `appendix.md` が
`throw new Error(...)` を例示しているため、リポジトリ側の規約に合わせた。
DRIVER_GUIDE.md の記述とは方針が異なる点は認識している。
`console.error` + `return null` に揃えるべきならその方針に従う。

---

## 提出物チェックリスト

### chirimen-drivers

- [ ] `packages/hello-world` をコピーして `packages/sgp30/` を作る
- [ ] `sgp30.js` を `index.js` としてコピー
- [ ] `package.json` を編集（`name` / `description` / `version` / `repository.directory` /
      `peerDependencies` に `node-web-i2c`）
- [ ] `PACKAGE_README.md` を `README.md` として配置
- [ ] Prettier でフォーマット
- [ ] ルートで `npm install` して `package-lock.json` を更新
- [ ] ブランチ `feat/sgp30` を作成、Conventional Commits で `feat: add sgp30 driver`

### chirimen.org

- [ ] `pizero/src/esm-examples/sgp30/` を作る
- [ ] `main.js` を配置（import を `"@chirimen/sgp30"` に書き換え）
- [ ] `readme.md` を配置
- [ ] **`schematic.png` を作る（Fritzing。最大の残タスク）**
- [ ] `index_examples.csv` に1行追加（I2C セクション）
- [ ] `_data/partslist.csv` にレコード追加
- [ ] `partsImgs/` にパーツ写真を追加（QCIF〜QVGA 程度）

### 提出前の最終確認

- [ ] `readme.md` から `sgp30_baseline` への参照を消す（提出しないため）
- [ ] `main.js` の import が `"@chirimen/sgp30"` になっているか
- [ ] 「要確認」等の作業メモ的なコメントが残っていないか
- [ ] インデントが2スペースか
- [ ] `node main.js` が実機で通るか（提出直前にもう一度）
