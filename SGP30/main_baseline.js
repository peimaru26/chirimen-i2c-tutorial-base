import { requestI2CAccess } from "node-web-i2c";
import SGP30 from "./sgp30.js";
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
