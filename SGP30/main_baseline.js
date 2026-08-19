import { requestI2CAccess } from "node-web-i2c";
import SGP30 from "./sgp30.js";
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
