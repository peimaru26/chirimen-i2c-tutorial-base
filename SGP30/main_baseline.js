import { requestI2CAccess } from "node-web-i2c";
import SGP30 from "./sgp30.js";
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
