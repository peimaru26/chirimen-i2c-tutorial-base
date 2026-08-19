# SGP30 ベースラインの保存と復元

SGP30 の動的ベースライン補正アルゴリズムの内部状態を取得・復元するサンプルです。

SGP30 は電源投入ごとにベースラインをゼロから学習し直すため、精度が出るまでに時間がかかります。
`getBaseline()` で得た値を保存しておき、次回起動時に `setBaseline()` で復元すると、
学習をやり直さずに済みます。

## 配線図

[sgp30](../sgp30/) と同じです。

![配線図](../sgp30/schematic.png "schematic")

## ベースラインの時間的な制約

データシートには記載がなく、[Sensirion の SGP30 Driver Integration Guide][dig] と
[Sensirion 公式ドライバー][emb] に記載されている条件です。**実装上とても重要**なので先に挙げます。

| 条件                 | 値                   | 出典の記述                                                                               |
| -------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| 有効な値が返るまで   | `init()` から約60分  | "A valid baseline value is only returned approx. 60min after a call to sgp30_iaq_init()" |
| 保存してよくなるまで | **12時間**の連続運転 | "the sensor has to run for 12 hours until the baseline can be stored"                    |
| 保存の推奨間隔       | **約1時間ごと**      | "the current baseline value should be stored approximately once per hour"                |
| 保存値の有効期限     | **最大7日**          | "While the sensor is off, baseline values are valid for a maximum of seven days"         |

[dig]: https://files.seeedstudio.com/wiki/Grove-VOC_and_eCO2_Gas_Sensor-SGP30/res/Sensirion_Gas_Sensors_SGP30_Driver-Integration-Guide_HW_I2C.pdf
[emb]: https://github.com/Sensirion/embedded-sgp/blob/master/sgp30/sgp30.h

> [!IMPORTANT]
> **1週間以上前に保存した値を `setBaseline()` してはいけません。** 古い基準で補正すると
> 測定値がずれます。保存時刻も一緒に記録しておき、復元前に経過時間を確認してください。
> ドライバー側では保存時刻を知りようがないため、このチェックはアプリケーション側の責任です。

> [!IMPORTANT]
> `setBaseline()` はデータシートの指定により **`init()`（= `sgp30_iaq_init`）の後に**
> 実行する必要があります。
>
> ベースラインの電文にはパラメータ順の罠があります。`sgp30_set_iaq_baseline` は
> **(TVOC, CO2eq)** の順で送るのに対し、`sgp30_get_iaq_baseline` の応答は
> **(CO2eq, TVOC)** の順です。このドライバーは引数・返り値をどちらも eCO2 を先に統一し、
> 電文の入れ替えは内部で吸収しています。サンプル中の往復テストがその検証を兼ねています。

## 実機で分かった挙動（データシート・統合ガイドに記載のないもの）

Raspberry Pi Zero + M5Stack U088 での実測。**いずれも公式資料に記述がなく、実機で確認した事実**です。

### 1. 未確立のときは `{ eCO2: 0, tvoc: 0 }` が返る

`init()` の直後に `getBaseline()` を呼ぶと `0` が返ります。ベースラインがまだ確立していない状態です。
「無効」を意味する値が `0` であることは公式資料に明記されていませんが、実機の挙動として確認できました。

### 2. 有効になるのは約30秒後（統合ガイドの「約60分」より早い）

統合ガイドは "approx. 60min" と述べていますが、実測では **`init()` から約30秒で非ゼロの値が返りました**
（`eCO2 = 0x950f` / `tvoc = 0x9ba2`）。15秒の初期化フェーズ終了とほぼ同時期です。

> [!WARNING]
> **非ゼロになったことは「保存してよい」を意味しません。** 統合ガイドの「保存には12時間の
> 連続運転が必要」は別の条件です。早期に得られる値は暫定値と考えてください。
> このサンプルが待つのは「往復テストができる状態」までであり、「保存できる状態」ではありません。

### 3. 未確立の間の `setBaseline()` は受理されるが反映されない

未確立の状態で `setBaseline(0x1234, 0x5678)` を送ると、**エラーにはならない**（CRC エラーも例外も出ない）
のに、直後の `getBaseline()` は `{ eCO2: 0, tvoc: 0 }` を返しました。
書き込みは ACK されるが、アルゴリズムがベースラインを持つまでは無視されるようです。

**帰結として、未確立の状態では `setBaseline()` の検証ができません。**
このサンプルはベースラインが有効になるまで待ってから往復テストを行います。

### 4. ベースライン値は生信号のティック値ではない

実測値 `0x950f`（38159）/ `0x9ba2`（39842）に対し、生信号から逆算した基準値は約 13910 / 19885 でした。
比が 2.74 と 2.00 で一致しないため、**生信号とは別の内部エンコード**です。
Adafruit の example にあるコメント値（`0x8E68` / `0x8F41`）と同じオーダーで、そちらと整合的です。

データシートが値の意味を説明していないのは妥当で、**保存して書き戻すだけの不透明な値**として
扱うのが正しい、ということになります。

## ドライバのインストール

```sh
npm i node-web-i2c @chirimen/sgp30
```

## サンプルコード

同ディレクトリの [main.js](main.js) と同じ内容です。

処理の流れ:

1. `init()` の後、`getBaseline()` が非ゼロを返すまで待つ（上限 60 秒、超えたら例外）。
   待つ間も動的ベースライン補正のため 1 秒間隔で `read()` を呼び続ける
2. 現在値をそのまま書き戻して読み直す**非破壊**の往復テストでパラメータ順を検証する
3. 以降 1 秒間隔で測定し、30 秒ごとにベースラインを表示する

```javascript
import { requestI2CAccess } from "node-web-i2c";
import SGP30 from "@chirimen/sgp30";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ベースラインが有効になるのを待つ上限 [秒]
const BASELINE_TIMEOUT = 60;

const i2cAccess = await requestI2CAccess();
const i2cPort = i2cAccess.ports.get(1);
const sgp30 = new SGP30(i2cPort, 0x58);
await sgp30.init();

// 前回保存したベースラインの復元。
// データシートの指定どおり、iaq_init (= init()) の後に実行します。
// 保存から1週間以上経った値は使ってはいけません (Sensirion ドライバー統合ガイド)。
// await sgp30.setBaseline(0x8e68, 0x8f41);

// --- ベースラインが有効になるまで待つ ---------------------------------
// init() 直後は未確立で { eCO2: 0, tvoc: 0 } が返ります。
// 待っている間も、動的ベースライン補正のため 1 秒間隔で read() を呼び続けます。
let baseline = { eCO2: 0, tvoc: 0 };
for (let i = 0; i < BASELINE_TIMEOUT; i++) {
  const { eCO2, tvoc } = await sgp30.read();
  baseline = await sgp30.getBaseline();
  console.log(
    `[${i + 1}s] eCO2: ${eCO2} ppm, TVOC: ${tvoc} ppb, baseline: ${JSON.stringify(baseline)}`,
  );
  if (baseline.eCO2 !== 0 || baseline.tvoc !== 0) break;

  await sleep(1000);
}
if (baseline.eCO2 === 0 && baseline.tvoc === 0) {
  throw new Error(
    `ベースラインが ${BASELINE_TIMEOUT} 秒待っても有効になりませんでした`,
  );
}

// --- 往復テスト (非破壊) -----------------------------------------------
// setBaseline() の電文はデータシート上 (TVOC, eCO2) の順ですが、
// getBaseline() の応答は (eCO2, TVOC) の順です。ドライバーがこの入れ替えを
// 正しく吸収できているかを、現在値を書き戻して読み直すことで確認します。
// 同じ値を書き戻すだけなのでセンサーの状態は変わりません。
await sgp30.setBaseline(baseline.eCO2, baseline.tvoc);
const echo = await sgp30.getBaseline();
console.log("baseline round-trip:", baseline, "->", echo);

if (echo.eCO2 === baseline.tvoc && echo.tvoc === baseline.eCO2) {
  throw new Error(
    "setBaseline / getBaseline のパラメータ順が一致していません (TVOC と eCO2 が入れ替わっています)",
  );
} else if (echo.eCO2 !== baseline.eCO2 || echo.tvoc !== baseline.tvoc) {
  // アルゴリズムが学習を進めて値が更新された可能性。入れ替わりとは区別します。
  console.warn("値が変化しました。アルゴリズムが更新した可能性があります");
} else if (baseline.eCO2 === baseline.tvoc) {
  console.warn(
    "eCO2 と TVOC のベースラインが同値のため、順番の入れ替わりは検出できません",
  );
}

// --- 測定とベースラインの定期取得 -------------------------------------
// 実運用では取得した値を保存時刻とともにファイル等に記録し、次回起動時に復元します。
// Sensirion のドライバー統合ガイドは、保存できるようになるまで12時間の連続運転が必要で、
// その後は約1時間ごとの保存を推奨しています。
// ここでは動作が見えるように30秒ごとに表示します。
let count = 0;
while (true) {
  const { eCO2, tvoc } = await sgp30.read();
  console.log(`eCO2: ${eCO2} ppm, TVOC: ${tvoc} ppb`);

  count++;
  if (count % 30 === 0) {
    const current = await sgp30.getBaseline();
    console.log(
      `baseline: eCO2 = 0x${current.eCO2.toString(16)}, tvoc = 0x${current.tvoc.toString(16)}`,
    );
  }

  await sleep(1000);
}
```

判定は3つに分けています。**「入れ替わり」と「値の変化」を区別する**のが要点です。
アルゴリズムが学習を進めて値が変わっただけのケースでバグを報告してしまわないようにしています。

| 読み戻し結果                                | 判定                                    |
| ------------------------------------------- | --------------------------------------- |
| 元の値と一致                                | ✅ 正常                                 |
| eCO2 と tvoc が**ちょうど入れ替わっている** | ❌ 例外を投げる                         |
| それ以外の値に変化                          | ⚠️ 警告（アルゴリズムが更新した可能性） |

## 動作確認のしかた

| 確認項目         | やりかた                                                 | 期待される結果                                      |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------- |
| 未確立の検出     | `node main.js` を起動直後に実行                          | `baseline: {"eCO2":0,"tvoc":0}` が数十秒続く        |
| 有効化の待ち     | そのまま待つ                                             | 30 秒前後で非ゼロの値に変わり、往復テストに進む     |
| 往復テスト       | 同上                                                     | `baseline round-trip:` の前後が一致し、例外が出ない |
| **検証の検出力** | ドライバーの `setBaseline()` の2語をわざと入れ替えて実行 | 値が逆順で読み戻り、例外が投げられる                |
| タイムアウト     | `BASELINE_TIMEOUT` を 3 に縮めて実行                     | 3 秒で「有効になりませんでした」の例外が出る        |
| 引数チェック     | `await sgp30.setBaseline(-1, 0)` を試す                  | 範囲外を知らせる例外が出る                          |
