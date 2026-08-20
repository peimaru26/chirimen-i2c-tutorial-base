# SGP30 TVOC/eCO2ガスセンサ

## 配線図

![配線図](./schematic.png "schematic")

> [!IMPORTANT]
> **VCC は Raspberry Pi の 3.3V ピン（1番）に接続してください。5V ピンではありません。**
>
> このユニットは 5V と表示されていますが、基板上のレベルシフタ（BSS138）の高圧側プルアップが
> コネクタの VCC ピンに接続されているため、**I2C のロジックレベルは VCC に与えた電圧そのままに
> なります。** 5V を与えると Pi の SDA/SCL に 5V が乗り、GPIO を破損させるおそれがあります。
>
> SGP30 チップ本体は 1.8V 動作ですが、基板上の LDO（RT9193-1.8V）が生成するため、
> VCC は 3.3V で問題ありません。

| ユニット側 | Raspberry Pi Zero      |
| ---------- | ---------------------- |
| 黒 GND     | 6番ピン (GND)          |
| 赤 VCC     | **1番ピン (3.3V)**     |
| 黄 SDA     | 3番ピン (GPIO2 / SDA1) |
| 白 SCL     | 5番ピン (GPIO3 / SCL1) |

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
console.log(`serial number: ${await sgp30.readSerialNumber()}`);

// init() 直後から約15秒間は初期化フェーズのため、
// eCO2 = 400ppm / tvoc = 0ppb の固定値が返ります。
// また動的ベースライン補正のため、約1秒間隔で read() を呼び続ける必要があります。
while (true) {
  const { eCO2, tvoc } = await sgp30.read();
  const { h2, ethanol } = await sgp30.readRaw();
  console.log(
    `eCO2: ${eCO2} ppm, TVOC: ${tvoc} ppb, raw H2: ${h2}, raw Ethanol: ${ethanol}`,
  );

  await sleep(1000);
}
```

## 動作確認のしかた

| 確認項目             | やりかた                                         | 期待される結果                                     |
| -------------------- | ------------------------------------------------ | -------------------------------------------------- |
| I2C の疎通           | `i2cdetect -y 1`                                 | `0x58` が表示される                                |
| `init()`             | `node main.js`                                   | エラーが出ずに次に進む                             |
| `readSerialNumber()` | 何度か再実行する                                 | 毎回同じ 12 桁の16進文字列が出る（全ゼロではない） |
| 初期化フェーズ       | 起動から15秒待つ                                 | 400ppm / 0ppb の固定値から実測値に切り替わる       |
| `read()`             | アルコール系ウェットティッシュや消毒液を近づける | TVOC / eCO2 が跳ね上がる（元に戻るまで数分かかる） |
| `readRaw()`          | 息を吹きかける                                   | raw H2 の値が動く（生値なので単位はティック）      |

`readRaw()` はベースライン補正を受けないため、初期化フェーズの15秒間も実際の値が返ります
（ただしヒーターの暖機中は値が動き続けます）。

ベースラインの取得・復元（`getBaseline()` / `setBaseline()`）については
[ドライバのリファレンス](https://github.com/chirimen-oh/chirimen-drivers/tree/master/packages/sgp30)
を参照してください。
