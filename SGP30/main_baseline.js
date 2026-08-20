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
