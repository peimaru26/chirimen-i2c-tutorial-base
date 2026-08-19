# SGP30 ベースラインの保存と復元

SGP30 の動的ベースライン補正アルゴリズムの内部状態を取得・復元するサンプルです。

SGP30 は電源投入ごとにベースラインをゼロから学習し直すため、精度が出るまでに時間がかかります。
`getBaseline()` で得た値を保存しておき、次回起動時に `setBaseline()` で復元すると、
学習をやり直さずに済みます。

## 配線図

[sgp30](../sgp30/) と同じです。

![配線図](../sgp30/schematic.png "schematic")

> [!IMPORTANT]
> `setBaseline()` はデータシートの指定により **`init()`（= `sgp30_iaq_init`）の後に**実行する
> 必要があります。
>
> ベースラインの電文にはパラメータ順の罠があります。`sgp30_set_iaq_baseline` は
> **(TVOC, CO2eq)** の順で送るのに対し、`sgp30_get_iaq_baseline` の応答は
> **(CO2eq, TVOC)** の順です。このドライバーは引数・返り値をどちらも eCO2 を先に統一し、
> 電文の入れ替えは内部で吸収しています。サンプル中の往復テストがその検証を兼ねています。

> [!NOTE]
> ベースラインが十分に安定するまでには、データシートによれば最大 12 時間の連続運転が必要です。
> 保存間隔についてはデータシートに規定がないため、このサンプルでは 30 秒ごとに表示するだけに
> しています。実運用での保存間隔は用途に応じて決めてください。

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

const i2cAccess = await requestI2CAccess();
const i2cPort = i2cAccess.ports.get(1);
const sgp30 = new SGP30(i2cPort, 0x58);
await sgp30.init();

// 前回保存したベースラインの復元。
// データシートの指定どおり、iaq_init (= init()) の後に実行します。
// 値はセンサー個体ごとに異なるため、前回 getBaseline() で得た値に書き換えてください。
// await sgp30.setBaseline(0x8e68, 0x8f41);

// --- 往復テスト -------------------------------------------------------
// setBaseline() の電文はデータシート上 (TVOC, eCO2) の順ですが、
// getBaseline() の応答は (eCO2, TVOC) の順です。ドライバーがこの入れ替えを
// 正しく吸収できているかを、現在値を書き戻して読み直すことで確認します。
// 同じ値を書き戻すだけなのでセンサーの状態は変化しません。
const before = await sgp30.getBaseline();
await sgp30.setBaseline(before.eCO2, before.tvoc);
const after = await sgp30.getBaseline();
console.log("baseline round-trip:", before, "->", after);

if (before.eCO2 !== after.eCO2 || before.tvoc !== after.tvoc) {
  throw new Error(
    "setBaseline / getBaseline のパラメータ順が一致していません (TVOC と eCO2 が入れ替わっています)",
  );
}
if (before.eCO2 === before.tvoc) {
  console.warn(
    "eCO2 と TVOC のベースラインが同値のため、順番の入れ替わりは検出できません",
  );
}

// --- 測定とベースラインの定期取得 -------------------------------------
// 実運用では取得した値をファイル等に保存し、次回起動時に復元します。
// 保存間隔はデータシートに規定がないため、ここでは30秒ごとに表示します。
let count = 0;
while (true) {
  const { eCO2, tvoc } = await sgp30.read();
  console.log(`eCO2: ${eCO2} ppm, TVOC: ${tvoc} ppb`);

  count++;
  if (count % 30 === 0) {
    const baseline = await sgp30.getBaseline();
    console.log(
      `baseline: eCO2 = 0x${baseline.eCO2.toString(16)}, tvoc = 0x${baseline.tvoc.toString(16)}`,
    );
  }

  await sleep(1000);
}
```

## 動作確認のしかた

| 確認項目             | やりかた                                                       | 期待される結果                                     |
| -------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| 往復テスト           | `node main.js`                                                 | `before` と `after` が一致し、例外が出ない         |
| パラメータ順の検出力 | ドライバーの `setBaseline()` の 2 語をわざと入れ替えて実行する | 往復テストが例外を投げる（＝テストが機能している） |
| 値の妥当性           | 30 秒ごとの表示を見る                                          | 0x0000 や 0xffff ではない値が出る                  |
| 引数チェック         | `await sgp30.setBaseline(-1, 0)` を試す                        | 範囲外を知らせる例外が出る                         |
