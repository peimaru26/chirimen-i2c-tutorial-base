# SGP30 TVOC/eCO2ガスセンサ

## 配線図

![配線図](./schematic.png "schematic")

> [!WARNING]
> このユニット (M5Stack U088) の電源は **5V** です。Raspberry Pi の 5V ピンから給電してください。
> SDA/SCL は 3.3V ロジックです。Pi に接続する前に、5V を給電した状態で SDA/SCL の電圧が
> 3.3V であることをテスターで確認することを推奨します。

> [!NOTE]
> SGP30 は `init()` 直後の約 15 秒間は初期化フェーズのため、eCO2 = 400ppm / TVOC = 0ppb の
> 固定値を返します。値が動き出すまで待ってください。
> また、動的ベースライン補正アルゴリズムを正しく動作させるため、約 1 秒間隔で `read()` を
> 呼び続ける必要があります。

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

// init() 直後から約15秒間は初期化フェーズのため、
// eCO2 = 400ppm / tvoc = 0ppb の固定値が返ります。
// また動的ベースライン補正のため、約1秒間隔で read() を呼び続ける必要があります。
while (true) {
  const { eCO2, tvoc } = await sgp30.read();
  console.log(`eCO2: ${eCO2} ppm, TVOC: ${tvoc} ppb`);

  await sleep(1000);
}
```

## 動作確認のしかた

1. `i2cdetect -y 1` で `0x58` が見えることを確認する
2. `node main.js` を実行し、`init()` がエラーなく通ることを確認する
3. 起動から 15 秒経過後、値が固定値から動き出すことを確認する
4. アルコール系のウェットティッシュや消毒液を近づけると TVOC / eCO2 が跳ね上がる
   （元の値に戻るまでには数分かかります）
