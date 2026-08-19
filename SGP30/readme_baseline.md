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

| 条件                 | 値                      | 出典の記述                                                                               |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| 有効な値が返るまで   | `init()` から**約60分** | "A valid baseline value is only returned approx. 60min after a call to sgp30_iaq_init()" |
| 保存してよくなるまで | **12時間**の連続運転    | "the sensor has to run for 12 hours until the baseline can be stored"                    |
| 保存の推奨間隔       | **約1時間ごと**         | "the current baseline value should be stored approximately once per hour"                |
| 保存値の有効期限     | **最大7日**             | "While the sensor is off, baseline values are valid for a maximum of seven days"         |

[dig]: https://files.seeedstudio.com/wiki/Grove-VOC_and_eCO2_Gas_Sensor-SGP30/res/Sensirion_Gas_Sensors_SGP30_Driver-Integration-Guide_HW_I2C.pdf
[emb]: https://github.com/Sensirion/embedded-sgp/blob/master/sgp30/sgp30.h

> [!IMPORTANT]
> **1週間以上前に保存した値を `setBaseline()` してはいけません。** 古い基準で補正すると
> 測定値がずれます。保存時刻も一緒に記録しておき、復元前に経過時間を確認してください。
> ドライバー側では保存時刻を知りようがないため、このチェックはアプリケーション側の責任です。

> [!NOTE]
> **起動直後は `getBaseline()` が `{ eCO2: 0, tvoc: 0 }` を返します。**
> ベースラインがまだ確立していない状態を意味します（上表のとおり有効値になるまで約60分）。
> この値を保存しても意味がなく、`setBaseline()` に渡してもいけません。
> サンプルコードはこの状態を検出して分岐します。

> [!IMPORTANT]
> `setBaseline()` はデータシートの指定により **`init()`（= `sgp30_iaq_init`）の後に**
> 実行する必要があります。
>
> ベースラインの電文にはパラメータ順の罠があります。`sgp30_set_iaq_baseline` は
> **(TVOC, CO2eq)** の順で送るのに対し、`sgp30_get_iaq_baseline` の応答は
> **(CO2eq, TVOC)** の順です。このドライバーは引数・返り値をどちらも eCO2 を先に統一し、
> 電文の入れ替えは内部で吸収しています。サンプル中の検証がその確認を兼ねています。

## ドライバのインストール

```sh
npm i node-web-i2c @chirimen/sgp30
```

## サンプルコード

同ディレクトリの [main.js](main.js) と同じ内容です。

ベースラインが未確立（`0`）かどうかで処理を分けています。

- **未確立のとき** — 壊すものが無いので、既知の異なる2値を書いて読み戻し、
  パラメータ順が正しく扱われているかを検証します。検証後は `init()` をやり直して値を破棄します
- **確立済みのとき** — 現在値をそのまま書き戻して読み直す**非破壊**の往復テストをします。
  センサーの状態は変化しません

```javascript
import { requestI2CAccess } from "node-web-i2c";
import SGP30 from "@chirimen/sgp30";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const i2cAccess = await requestI2CAccess();
const i2cPort = i2cAccess.ports.get(1);
const sgp30 = new SGP30(i2cPort, 0x58);
await sgp30.init();

// 前回保存したベースラインの復元。
// データシートの指定どおり、iaq_init (= init()) の後に実行します。
// 保存から1週間以上経った値は使ってはいけません (Sensirion ドライバー統合ガイド)。
// await sgp30.setBaseline(0x8e68, 0x8f41);

const baseline = await sgp30.getBaseline();
console.log("baseline:", baseline);

if (baseline.eCO2 === 0 && baseline.tvoc === 0) {
  // ベースラインがまだ確立していません。Sensirion のドライバー統合ガイドによると、
  // 有効な値が得られるのは init() から約60分後、保存してよいのは12時間の連続運転後です。
  console.log(
    "ベースラインは未確立です (有効な値になるまで init() から約60分)",
  );

  // 未確立のうちは壊すものが無いので、既知の異なる2値を書いて読み戻し、
  // setBaseline (電文は TVOC, eCO2 の順) と getBaseline (応答は eCO2, TVOC の順) の
  // 入れ替えをドライバーが正しく吸収できているかを確認します。
  const probe = { eCO2: 0x1234, tvoc: 0x5678 };
  await sgp30.setBaseline(probe.eCO2, probe.tvoc);
  const echo = await sgp30.getBaseline();
  console.log("パラメータ順の検証:", probe, "->", echo);

  if (echo.eCO2 === probe.tvoc && echo.tvoc === probe.eCO2) {
    throw new Error(
      "setBaseline / getBaseline のパラメータ順が一致していません (TVOC と eCO2 が入れ替わっています)",
    );
  } else if (echo.eCO2 !== probe.eCO2 || echo.tvoc !== probe.tvoc) {
    // センサーが設定直後の値をまだ読み返さない段階。バグとは区別します。
    console.warn(
      "設定した値が読み戻せませんでした。順番の検証は保留します (センサーがまだ値を保持しない状態)",
    );
  }

  // 検証用の値を残さないよう iaq_init をやり直します。
  // 再度15秒の初期化フェーズに入ります。
  await sgp30.init();
  console.log("検証用の値を破棄しました");
} else {
  // 確立済みの場合は、現在値を書き戻して読み直す非破壊の往復テストをします。
  await sgp30.setBaseline(baseline.eCO2, baseline.tvoc);
  const echo = await sgp30.getBaseline();
  console.log("往復テスト:", baseline, "->", echo);

  if (echo.eCO2 !== baseline.eCO2 || echo.tvoc !== baseline.tvoc) {
    throw new Error(
      "setBaseline / getBaseline のパラメータ順が一致していません (TVOC と eCO2 が入れ替わっています)",
    );
  }
  if (baseline.eCO2 === baseline.tvoc) {
    console.warn(
      "eCO2 と TVOC のベースラインが同値のため、順番の入れ替わりは検出できません",
    );
  }
}

// --- 測定とベースラインの定期取得 -------------------------------------
// 実運用では取得した値をファイル等に保存し、次回起動時に復元します。
// Sensirion のドライバー統合ガイドは約1時間ごとの保存を推奨しています。
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

| 確認項目           | やりかた                                                 | 期待される結果                                                        |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------- |
| 未確立の検出       | 電源投入直後に `node main.js`                            | `baseline: { eCO2: 0, tvoc: 0 }` と表示され、未確立のメッセージが出る |
| パラメータ順       | 同上（プローブ値で自動検証される）                       | `{ eCO2: 4660, tvoc: 22136 }` がそのまま読み戻る                      |
| **検証の検出力**   | ドライバーの `setBaseline()` の2語をわざと入れ替えて実行 | 値が逆順で読み戻り、例外が投げられる                                  |
| 非破壊の往復テスト | 60分以上運転してから実行                                 | `往復テスト:` の前後が一致し、例外が出ない                            |
| 値の妥当性         | 60分以上運転してから30秒ごとの表示を見る                 | `0x0` や `0xffff` ではない値が出る                                    |
| 引数チェック       | `await sgp30.setBaseline(-1, 0)` を試す                  | 範囲外を知らせる例外が出る                                            |

### 実測結果（Raspberry Pi Zero / M5Stack U088）

起動直後に実行した結果:

```
baseline: { eCO2: 0, tvoc: 0 }
```

`init()` の約2秒後だったため、上表の「約60分」に達しておらず未確立。想定どおりの挙動。
パラメータ順の検証にはプローブ値を使う分岐が必要になった。
