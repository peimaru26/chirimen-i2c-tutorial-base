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
> さらにパラメータ順の罠があります。`sgp30_set_iaq_baseline` は **(TVOC, CO2eq)** の順で
> 送るのに対し、`sgp30_get_iaq_baseline` の応答は **(CO2eq, TVOC)** の順です。
> このドライバーは引数・返り値をどちらも eCO2 を先に統一し、電文の入れ替えは内部で吸収しています。

## 実機で分かった挙動（公式資料に記載のないもの）

Raspberry Pi Zero + M5Stack U088 での実測。**いずれも公式資料に記述がなく、実機で確認した事実**です。

### 1. 未確立のときは `{ eCO2: 0, tvoc: 0 }` が返る

`init()` の直後に `getBaseline()` を呼ぶと `0` が返ります。ベースラインがまだ確立していない状態です。
「無効」を意味する値が `0` であることは公式資料に明記されていませんが、実機の挙動として確認できました。

### 2. 有効になるのは16秒後（統合ガイドの「約60分」より大幅に早い）

1秒ごとに `getBaseline()` を呼んで観測した結果:

```
[15s] baseline: {"eCO2":0,"tvoc":0}
[16s] baseline: {"eCO2":36451,"tvoc":36382}
```

**15秒目まで `0`、16秒目に非ゼロ。** 15秒の初期化フェーズ終了の直後です。
統合ガイドの "approx. 60min" とは大きく食い違います。

> [!WARNING]
> **非ゼロになったことは「保存してよい」を意味しません。** 統合ガイドの「保存には12時間の
> 連続運転が必要」は別条件で、こちらは依然有効と考えるべきです。16秒で得られる値は暫定値です。
> このサンプルが待つのは「検証ができる状態」までであり、「保存できる状態」ではありません。

### 3. 未確立の間の `setBaseline()` は受理されるが反映されない

未確立の状態で `setBaseline(0x1234, 0x5678)` を送ると、**エラーにはならない**（CRC エラーも例外も出ない）
のに、直後の `getBaseline()` は `{ eCO2: 0, tvoc: 0 }` を返しました。
書き込みは ACK されるが、アルゴリズムがベースラインを持つまでは無視されるようです。

**この挙動が「現在値を書き戻す往復テスト」を成立させなくします。** 詳細は後述。

### 4. ベースライン値は生信号のティック値ではない

実測値 `0x8e63`（36451）/ `0x8e1e`（36382）に対し、生信号から逆算した基準値は約 13910 / 19885 でした。
別セッションでは 38159 / 39842 でした。生信号との比が一定にならないため、
**生信号とは別の内部エンコード**です。
Adafruit の example にあるコメント値（`0x8E68` / `0x8F41`）と同じオーダーで、そちらと整合的です。

データシートが値の意味を説明していないのは妥当で、**保存して書き戻すだけの不透明な値**として
扱うのが正しい、ということになります。

### 5. ベースラインは短時間では変化しない

16秒目と46秒目で同じ値（36451 / 36382）でした。秒単位で揺れる量ではないため、
書き込み→読み戻しの比較が値の更新で誤検知することはありません。

## 検証方法の設計 — 3回作り直した

パラメータ順が正しく扱われているかを確認する方法は、実測によって2回否定されました。

| 版         | 方式                                            | 否定された理由                                           |
| ---------- | ----------------------------------------------- | -------------------------------------------------------- |
| 初版       | 現在値を書き戻して読み直す（非破壊）            | 起動直後は両方 `0` で、入れ替わりを検出できない（挙動1） |
| 2版        | 未確立時に既知の2値をプローブとして書き込む     | 未確立時の書き込みは反映されない（挙動3）                |
| 3版        | 有効化を待ってから現在値を書き戻す              | **書き込みが無視されても一致してしまう**（下記）         |
| **確定版** | **有効化を待ってから、異なる値のプローブ→復元** | —                                                        |

### 3版が抱えていた論理的な穴

`setBaseline(現在値)` → `getBaseline()` → 現在値、という往復は**必ず一致します**。
`setBaseline()` が無視された場合でも、`getBaseline()` はアルゴリズム自身の値
（＝書き込もうとした値と同じ）を返すからです。

つまり**「書き込みが効いた」と「書き込みが無視された」を区別できていませんでした。**
挙動3で「無視される状態が実在する」ことを観測しているので、これは机上の心配ではありません。

### 確定版

現在値とは**異なる**既知の値を一度書き込んで確認し、そのあと元の値に戻します。

1. 有効化を待つ（上限60秒、超えたら例外）
2. `setBaseline(0x1234, 0x5678)` → `getBaseline()` が**そのプローブ値と一致する**ことを確認
   - 逆順で返る → パラメータ順の不一致として例外
   - 別の値が返る → 書き込みが反映されていないとして例外
3. 元の値を書き戻し、読み直して復元を確認

これで「書き込みが効いている」「順番が正しい」「元に戻せる」の3つを同時に確認できます。
プローブ値が有効なのは一瞬（数十ミリ秒）で、直後に元の値へ戻すため実害はありません。

## ドライバのインストール

```sh
npm i node-web-i2c @chirimen/sgp30
```

## サンプルコード

同ディレクトリの [main.js](main.js) と同じ内容です。

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

// --- パラメータ順と書き込みの検証 -------------------------------------
// setBaseline() の電文はデータシート上 (TVOC, eCO2) の順ですが、
// getBaseline() の応答は (eCO2, TVOC) の順です。この入れ替えをドライバーが
// 正しく吸収できているかを確認します。
//
// 現在値をそのまま書き戻す方式は使えません。setBaseline() が無視された場合でも
// getBaseline() はアルゴリズム自身の値 (= 書いた値と同じ) を返すため、
// 「書き込みが効いた」と「無視された」を区別できないからです。
// そこで現在値とは異なる既知の値を一度書き込んで確認し、そのあと元の値に戻します。
const probe = { eCO2: 0x1234, tvoc: 0x5678 };
await sgp30.setBaseline(probe.eCO2, probe.tvoc);
const echo = await sgp30.getBaseline();
console.log("probe:", probe, "->", echo);

if (echo.eCO2 === probe.tvoc && echo.tvoc === probe.eCO2) {
  throw new Error(
    "setBaseline / getBaseline のパラメータ順が一致していません (TVOC と eCO2 が入れ替わっています)",
  );
}
if (echo.eCO2 !== probe.eCO2 || echo.tvoc !== probe.tvoc) {
  throw new Error(
    `setBaseline() が反映されていません (期待 ${JSON.stringify(probe)} / 実際 ${JSON.stringify(echo)})`,
  );
}

// 元のベースラインに戻す
await sgp30.setBaseline(baseline.eCO2, baseline.tvoc);
const restored = await sgp30.getBaseline();
console.log("restore:", baseline, "->", restored);
if (restored.eCO2 !== baseline.eCO2 || restored.tvoc !== baseline.tvoc) {
  throw new Error("元のベースラインに戻せませんでした");
}
console.log("パラメータ順・書き込み・復元をすべて確認しました");

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

## 動作確認のしかた

| 確認項目                   | やりかた                                                    | 期待される結果                                |
| -------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| 未確立の検出               | 電源投入直後に `node main.js`                               | 15秒間 `baseline: {"eCO2":0,"tvoc":0}` が続く |
| 有効化                     | そのまま待つ                                                | 16秒前後で非ゼロに変わる                      |
| 書き込みが効いているか     | 同上（自動）                                                | `probe:` の前後が一致する                     |
| パラメータ順               | 同上（自動）                                                | `probe:` が逆順で返らない                     |
| 復元                       | 同上（自動）                                                | `restore:` の前後が一致する                   |
| **検証の検出力（順番）**   | ドライバーの `setBaseline()` の2語をわざと入れ替えて実行    | 「パラメータ順が一致していません」の例外      |
| **検証の検出力（無反映）** | ドライバーの `setBaseline()` の中身をコメントアウトして実行 | 「反映されていません」の例外                  |
| タイムアウト               | `BASELINE_TIMEOUT` を 3 に縮めて実行                        | 3秒で「有効になりませんでした」の例外         |
| 引数チェック               | `await sgp30.setBaseline(-1, 0)` を試す                     | 範囲外を知らせる例外                          |

モックで3パターン（正常 / デバイスが逆順解釈 / 書き込みを無視）を検証し、
すべて期待どおりに判定することを確認済みです。
