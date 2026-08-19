# 工程4 成果物 — SGP30 ドライバー API 確定仕様

Example（`main.js`）を先に書くことで確定した API。**工程5（Driver 作成）はこの仕様を満たすように実装する。**

## 確定した API

### `new SGP30(i2cPort, slaveAddress)`

| 引数           | 型      | 説明                                                  |
| -------------- | ------- | ----------------------------------------------------- |
| `i2cPort`      | I2CPort | `i2cAccess.ports.get(1)` で取得したポートオブジェクト |
| `slaveAddress` | Number  | `0x58` 固定。省略時のデフォルトも `0x58`              |

### `async init()`

I2C ポートを open し、疎通確認をしてから測定を開始できる状態にする。使用前に必ず 1 回実行する。

内部でやること（工程5で実装）:

1. `i2cPort.open(slaveAddress)`
2. `0x202F`（Get Feature Set）で疎通確認 — **配線ミス・アドレス違いをここで検出する**
3. `0x2003`（Init air quality）で IAQ アルゴリズムを開始

### `async read()`

| 返り値   | 型     | 説明                                           |
| -------- | ------ | ---------------------------------------------- |
| `o`      | Object | 測定結果                                       |
| `o.eCO2` | Number | 二酸化炭素相当値。単位は **ppm**（400〜60000） |
| `o.tvoc` | Number | 総揮発性有機化合物。単位は **ppb**（0〜60000） |

内部でやること: `0x2008`（Measure air quality）送信 → 12ms 待ち → 6 バイト読み → CRC 検証 → ビッグエンディアンで合成。
バイト並びは `[eCO2_hi, eCO2_lo, CRC, TVOC_hi, TVOC_lo, CRC]`（**eCO2 が先**）。

**実装するのはこの 2 メソッドのみ。** `raw`（H2/Ethanol）、`baseline`（get/set）、`humidity` 補正、`measure_test` は
Typical ユースケースではないため実装しない（工程3 の調査結果に基づく判断）。

## 命名の根拠

| 決めたこと        | 選んだもの           | 理由                                                                                                                                         |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| read 系メソッド名 | `read()`             | DRIVER_GUIDE.md 準拠。`adt7410` 等が採用。`scd40` の `getData()` は「更新フラグも返す」ためのもので、今回は該当しない                        |
| 返り値のキー      | `eCO2` / `tvoc`      | データシートの表記（CO2eq → eCO2、TVOC）に合わせつつキャメルケース化。`co2` にすると実測 CO2 と誤解されるため `eCO2`（equivalent CO2）を維持 |
| 返り値の形        | 名前付きオブジェクト | 配列 `[eCO2, tvoc]` だと順番を間違える。example 側で分割代入できる                                                                           |
| 単位              | ppm / ppb そのまま   | デバイスの出力がそのまま人間に分かる単位なので変換不要                                                                                       |

## example のループ形式について（判断を明記）

`setInterval` ではなく **`while (true)` + `await sleep(1000)`** を採用した。

- 理由1: `pizero/src/esm-examples/` の全 example がこの形式（規約準拠。レビューが通りやすい）
- 理由2: `read()` が遅延したときに呼び出しが重ならない（DRIVER_GUIDE 6章の「値がたまに化ける」対策そのもの）
- トレードオフ: 実周期は `1000ms + read() の所要時間`（実測 12〜15ms）＝ 約 1.015 秒になる。
  SGP30 のベースライン補正は「1s 間隔」を要求するがこの程度の誤差は許容範囲。
  厳密な 1.000 秒が必要になった場合は、経過時間を測って `sleep(1000 - elapsed)` にする。

## ファイル配置

### テスト段階（工程6 まで）— 1 ディレクトリで完結させる

```
sgp30/
├── main.js       ← example。driver を "./sgp30.js" で相対 import
├── sgp30.js      ← 工程5で作成する driver
├── package.json  ← Raspi で npm i するための最小構成
└── readme.md
```

### コントリビュート段階（工程7）— 2 リポジトリに分割する

工程3 の調査で判明した公式手順（`docs/contributing/add-driver.md`）に従う:

| 置き場所                                                | ファイル                                  | 備考                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `chirimen-drivers` の `packages/sgp30/`                 | `index.js` / `package.json` / `README.md` | **ドライバー本体のファイル名は `index.js`**（`sgp30.js` ではない）。`packages/hello-world` をコピーして作る |
| `chirimen.org` の `pizero/src/esm-examples/sgp30/`      | `main.js` / `readme.md` / `schematic.png` | `main.js` の import を `"@chirimen/sgp30"` に書き換える。`index_examples.csv` に 1 行追加                   |
| `chirimen.org` の `_data/partslist.csv` と `partsImgs/` | パーツ情報と写真                          | 推奨                                                                                                        |

**残タスク:** `schematic.png`（Fritzing による実体配線図）の作成。M5Stack U088 の Fritzing パーツが
存在しない場合はパーツの作成も推奨されている。

## 工程4 の検証結果

モックの `node-web-i2c`（0x58 の SGP30 を模擬）とプロトタイプドライバーを立てて `main.js` を実走させ、
以下を確認済み:

- [x] `init()` → `0x202F` → `0x2003` の順にコマンドが出る
- [x] `read()` が `0x2008` を 1 秒ごとに送る
- [x] 6 バイト応答から `{ eCO2, tvoc }` が正しく取り出せる（eCO2 が先の並び）
- [x] CRC-8（多項式 0x31 / 初期値 0xFF）の実装がデータシートの検算値 **CRC(0xBEEF) = 0x92** と一致
- [x] 初期化フェーズ 15 秒間は 400ppm / 0ppb、以降は実測値に切り替わる挙動を example が正しく表示
- [x] `node --check` 通過、Prettier で差分なし

## 工程5 で決める（＝まだ決めていない）こと

- `sleep` ヘルパーを**モジュールレベルの `const`**（`scd40/index.js` の実際の書き方）にするか、
  DRIVER_GUIDE の骨格テンプレートどおり **`async wait(ms)` メソッド**にするか
  → リポジトリの実装に合わせて前者を推奨。公開メソッドを増やさずに済む
- コマンド送信・CRC 検証を `#private` メソッドに切り出す粒度
- `init()` 失敗時に `throw` するか `console.error` + `return null` にするか
  → `docs/contributing/coding-standards.md` は「わかりやすいエラーメッセージを返す」、
  `appendix.md` は `throw new Error(...)` の例を挙げているため **throw を推奨**。
  DRIVER_GUIDE の `console.error` + `return null` とは方針が異なる点を要確認
- Feature Set の判定条件（Adafruit は `(featureSet & 0xF0) === 0x0020`）をデータシートの
  Feature set 章と突き合わせて確定させる
