# SGP30 (M5Stack U088 / TVOC・eCO2 ガスセンサユニット) — 工程1〜3 調査結果

対象デバイス: [TVOC/eCO2 ガスセンサユニット（SGP30）](https://www.switch-science.com/products/6619) / M5STACK-U088
調査日: 2026-08-19 ／ 対象工程: DRIVER_GUIDE.md の 1. デバイス選定 → 2. 資料調査 → 3. Web I2C API 仕様確認

**結論: CHIRIMEN ドライバー化は可能。工程4（Example 作成）へ進んで問題なし。**
ただし着手前に「電源電圧の実測」と「1秒周期の呼び出し必須」の 2 点を認識しておくこと（後述）。

---

## 1. デバイス選定

ガイドの必須 3 チェック:

| 確認項目 | 結果 | 根拠 |
|---|---|---|
| 既存ドライバーと重複していないか | **OK（重複なし）** | chirimen-drivers の 68 パッケージに `sgp30` は存在しない。近縁は `sgp40` / `scd40` / `ccs811` / `ens160` |
| しっかりしたデータシートがあるか | **OK（◎）** | Sensirion 公式 PDF（Version 0.92, 2019-04）。全コマンドの hex・応答フォーマット・CRC パラメータ・タイミングが明記 |
| I2C の「方言」を使っていないか | **OK（ただし要注意）** | ファームウェア転送等はなし。ただし「レジスタ番地」方式ではなく **Sensirion 方式（16bit コマンド + CRC 付き 2 バイトワード）**。→ 3章で対応可能と確認済み |

### 近縁デバイスの存在が追い風になる

`chirimen-drivers` に **SCD40（Sensirion CO2 センサ）ドライバーが既にある**。SGP30 と通信の作法が全く同じ（16bit コマンド送信 → 待ち → CRC 付き読み出し）なので、
**scd40.js は「移植のお手本」として実質 4 つ目の一次資料になる**。特に CRC-8 実装はそのまま流用できる。

### 選定にあたっての注意点（デバイス固有の癖）

| 癖 | 内容 | 影響 |
|---|---|---|
| **1 秒周期の呼び出しが必須** | `sgp30_iaq_init` 後は 1s 間隔で `measure_iaq` を送り続けないと、動的ベースライン補正アルゴリズムが正しく動かない | example は `setInterval(..., 1000)` 固定。周期を変えられる API にしない方が良い |
| **起動後 15 秒は固定値** | 初期化フェーズ中は eCO2=400ppm / TVOC=0ppb を返す | 「動作確認したのに値が動かない！」の第一の原因。README とコメントに必ず書く |
| **ベースラインの長期較正** | 実用精度には最大 12 時間の運転が必要。`get/set_baseline` で外部保存・復元できる | Typical ユースケースではない。**実装しない**（ガイドの「Typical に全集中」に従う） |
| **チップ本体は 1.8V 動作** | SGP30 の VDD は 1.62〜1.98V。3.3V/5V 直結は不可 | モジュール基板側のレギュレータ／レベル変換に依存 → 下記 |

### 電源まわり（要実機確認）

- M5Stack 公式ドキュメント上のユニット給電は **5V**（HY2.0-4P: 黒=GND / 赤=5V / 黄=SDA / 白=SCL）。
- M5Stack の PORT.A は「5V 給電 + 3.3V ロジックの I2C」なので、**基板上にレギュレータとレベル変換が載っている可能性が高い**が、
  公開されている回路図が画像形式のみで**部品構成を一次資料で確認できなかった**（M5_Hardware リポジトリには筐体データしかない）。
- **推奨アクション**: Raspberry Pi に繋ぐ前に、ユニットに 5V を与えた状態で **SDA/SCL の無通信時電圧をテスターで実測**し、3.3V であることを確認する。
  5V が乗っていた場合は Pi の GPIO に直結してはいけない。
- 3.3V のみでの動作可否は公式記述なし。**5V 給電 + 3.3V ロジック**の構成を前提にする。

---

## 2. 資料調査 — 3点セット（＋CHIRIMEN 内の参考実装）

| 資料 | URL | 用途 |
|---|---|---|
| **データシート**（Sensirion 公式） | https://sensirion.com/media/documents/984E0DD5/61644B8B/Sensirion_Gas_Sensors_Datasheet_SGP30.pdf | コマンド hex・CRC・タイミングの原本。**最終的な正はこれ** |
| **Arduino example (.ino)** | https://github.com/adafruit/Adafruit_SGP30/blob/master/examples/sgp30test/sgp30test.ino | Typical ユースケースの確認 |
| **Arduino driver (.cpp/.h)** | https://github.com/adafruit/Adafruit_SGP30 | 移植元。初期化手順・定数・CRC 検証 |
| ＋ **CHIRIMEN の同系ドライバー** | https://github.com/chirimen-oh/chirimen-drivers `packages/scd40` | Sensirion 方式の CHIRIMEN 流儀の書き方（CRC8・writeBytes/readBytes の使い方） |
| （参考）M5Stack ユニット資料 | https://docs.m5stack.com/en/unit/tvoc | ピンアサイン・I2C アドレス |

### 調査で答えを出す質問への回答

**Q. Typical ユースケースは何か？**
`sgp30test.ino` の `loop()` を見ると、実際に毎回使われているのは **`IAQmeasure()` による eCO2 / TVOC の取得だけ**。
`setHumidity()` は全行コメントアウト、`setIAQBaseline()` もコメントアウト、`getIAQBaseline()` は 30 回に 1 回のデバッグ表示、`IAQmeasureRaw()` は生値の参考表示。
→ **実装するのは `init()` + `read()`（eCO2 / TVOC）のみ**。raw / baseline / humidity は今回スコープ外。

**Q. I2C アドレスは？**
**`0x58` 固定**（`#define SGP30_I2CADDR_DEFAULT 0x58`）。ジャンパ等による変更手段なし。
※ 同じ Sensirion の SGP40 は 0x59 なので混同しないこと。

**Q. 対応電圧は？**
チップ 1.62〜1.98V / ユニットは 5V 給電（1章の注意参照）。

**Q. CHIRIMEN の電文で足りるか？**
**足りる。** Arduino 側は `Wire.beginTransmission → write(2バイトのコマンド) → endTransmission` と `Wire.requestFrom(addr, N)` の 2 パターンのみ。
これは node-web-i2c の `writeBytes()` / `readBytes()` にそのまま 1:1 対応する（3章）。

### コマンド一覧（データシート原本より）

| コマンド | Hex | 応答 | 測定時間 | 今回使う |
|---|---|---|---|---|
| Init_air_quality | `0x2003` | なし | 2〜10 ms | ✅ init() |
| Measure_air_quality | `0x2008` | 6 byte | 10〜12 ms | ✅ read() |
| Get_feature_set | `0x202F` | 3 byte | 1〜10 ms | ✅ init() の疎通確認 |
| Get_serial_id | `0x3682` | 9 byte | 0.5 ms | △ init() の疎通確認（任意） |
| Measure_raw | `0x2050` | 6 byte | 20〜25 ms | ✗ |
| Get_baseline | `0x2015` | 6 byte | 1〜10 ms | ✗ |
| Set_baseline | `0x201E` | なし | 1〜10 ms | ✗ |
| Set_humidity | `0x2061` | なし | 1〜10 ms | ✗ |
| Measure_test | `0x2032` | 3 byte | 200〜220 ms | ✗ |

### データフォーマット

- すべて **ビッグエンディアン（MSB first）**。`(hi << 8) | lo` で合成する（SGP40/SCD40 ドライバーと同じ）。
- 応答は **「データ 2 バイト + CRC 1 バイト」を 1 ワード**とする繰り返し。
- `Measure_air_quality`（6 byte）の並び: **`[eCO2_hi, eCO2_lo, CRC, TVOC_hi, TVOC_lo, CRC]`**
  → `eCO2` は ppm、`TVOC` は ppb。**eCO2 が先**（Adafruit の `reply[0]→eCO2, reply[1]→TVOC` と一致）。

### CRC-8 パラメータ

| 項目 | 値 |
|---|---|
| 多項式 | `0x31` (x^8 + x^5 + x^4 + 1) |
| 初期値 | `0xFF` |
| 入力/出力リフレクト | なし |
| 最終 XOR | `0x00` |
| 検算例 | CRC(0xBEEF) = `0x92` |

→ **`packages/scd40/scd40.js` の `_crc8()` と完全に同一**。実装時はそちらを踏襲する（下記）。

```js
_crc8(buffer) {
  let crc = 0xff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? (crc << 1) ^ 0x31 : crc << 1;
    }
  }
  return crc & 0xff;
}
```

### 初期化手順（Adafruit `begin()` の中身）

1. `0x36 0x82`（Get Serial ID）送信 → 10ms 待ち → 9 バイト読み（＝48bit シリアル + CRC×3）
2. `0x20 0x2F`（Get Feature Set）送信 → 10ms 待ち → 3 バイト読み → 上位バイトで機種チェック
   （Adafruit は `(featureset & 0xF0) == 0x0020` で判定。**実装時にデータシートの Feature set 章と要突き合わせ**）
3. `0x20 0x03`（IAQ init）送信 → 10ms 待ち → 読み出しなし
4. 以降 **1 秒間隔**で `0x20 0x08`（Measure air quality）→ 12ms 待ち → 6 バイト読み

→ ガイドの「WHOAMI で配線ミスを即検出」に相当するのが **手順 2 の Feature Set チェック**。ここを init() に入れておく。

---

## 3. Web I2C API 仕様確認

### 3-1. 標準仕様だけでは足りない

[Web I2C API 仕様](https://browserobo.github.io/WebI2C/)（W3C Browsers and Robotics CG Draft, 2016-01）が定義する `I2CSlaveDevice` は
**`read8` / `read16` / `write8` / `write16` の 4 つのみ**。いずれも **SMBus 形式（レジスタ番地バイトを必ず先頭に付ける）**。

SGP30 は「レジスタ番地」という概念を持たず、2 バイトのコマンドを投げて、番地なしで N バイト読む。
→ **標準仕様の 4 メソッドでは SGP30 は制御できない。**

### 3-2. node-web-i2c の CHIRIMEN 拡張で解決する

node-web-i2c（CHIRIMEN の実装）が追加している 4 メソッドの実体を確認した:

| メソッド | 内部実装 | 実際のバス上の動作 |
|---|---|---|
| `writeBytes(bytes)` | `bus.i2cWrite()` | **plain I2C write**。番地なしで生バイト列を送る |
| `readBytes(length)` | `bus.i2cRead()` | **plain I2C read**。番地を送らず N バイト読む |
| `writeByte(byte)` | `bus.sendByte()` | SMBus Send Byte（1 バイトだけ送る） |
| `readByte()` | `bus.receiveByte()` | SMBus Receive Byte（番地なしで 1 バイト読む） |
| `read8/write8/read16/write16` | `bus.readByte/writeByte/readWord/writeWord` | **SMBus 形式（レジスタ番地付き）** |

→ **`writeBytes()` と `readBytes()` の 2 つだけで SGP30 の全通信が成立する。実現可能。**

### 3-3. Arduino Wire → Web I2C 対応表（SGP30 版）

| やりたいこと | Arduino (Adafruit_SGP30) | Web I2C (node-web-i2c) |
|---|---|---|
| 16bit コマンドを送る | `beginTransmission(0x58)` + `write(0x20)` + `write(0x08)` + `endTransmission()` | `await this.i2cSlave.writeBytes([0x20, 0x08])` |
| 測定完了待ち | `delay(12)` | `await this.wait(12)` |
| CRC 付き N バイト読む | `requestFrom(0x58, 6)` + `read()`×6 | `await this.i2cSlave.readBytes(6)` → `Uint8Array` |
| 16bit 値の合成 | `(reply[0] << 8) \| reply[1]` | 同じ（**ビッグエンディアン**） |
| CRC 検証 | `generateCRC()` | scd40.js の `_crc8()` を流用 |

### 3-4. 実装時の落とし穴

| 落とし穴 | 対策 |
|---|---|
| `read16()` を使いたくなる | **使わない**。①レジスタ番地を勝手に付ける ②SMBus Read Word は**リトルエンディアン**なので SGP30（ビッグエンディアン）と逆になる |
| `readBytes()` の返り値 | `number[]` ではなく **`Uint8Array`**。`slice()` の挙動に注意（`_crc8()` に渡す際は scd40 同様 `ans.slice(i, i+2)` で OK） |
| SGP40 ドライバーの真似をしない | `packages/sgp40` の `Read()` は `writeByte(this.slaveAddress)` を打ってから `readBytes(3)` していて不自然（アドレスをデータとして送っている）。**SCD40 方式（`writeBytes(cmd)` → `wait()` → `readBytes(n)`）に倣うこと** |
| コマンドと読み出しの間に STOP が入る | `i2cWrite` と `i2cRead` は別トランザクションなので STOP が入るが、Sensirion 仕様上これで正しく、**SCD40 で実績あり**。Repeated Start は不要 |
| ポーリングの無限ループ | SGP30 は固定待ち時間方式なので原則ポーリング不要。入れる場合は必ず上限回数を設ける |

---

## 次工程（4. Example 作成）への引き継ぎ

決まった仕様:

- I2C アドレス: **`0x58`**
- クラス名: `SGP30`
- API: **`init()`** と **`read()`** の 2 つのみ
- `read()` の返り値: **`{ eCO2: <number, ppm>, tvoc: <number, ppb> }`**

```js
import { requestI2CAccess } from "chirimen";
import SGP30 from "./sgp30.js";

const i2cAccess = await requestI2CAccess();
const i2cPort = i2cAccess.ports.get(1);
const sgp30 = new SGP30(i2cPort, 0x58);

await sgp30.init();

// 注意: 動的ベースライン補正のため 1 秒間隔の呼び出しが必須。
// 起動後 15 秒間は eCO2=400 / tvoc=0 の固定値が返る。
setInterval(async () => {
  const data = await sgp30.read();
  console.log(data); // { eCO2: 400, tvoc: 0 }
}, 1000);
```

工程 6（Raspi デバッグ）での確認手順:

1. `i2cdetect -y 1` で **`0x58`** が見えること（見えなければコードより先に配線と電源を疑う）
2. `init()` で Feature Set が読めること（ここまでで疎通確認を完了させてから `read()` に進む）
3. 起動 15 秒後から値が動き出すこと
4. 物理応答の確認: **アルコール系のウェットティッシュや消毒液を近づけると TVOC / eCO2 が跳ね上がる**（元に戻るのに数分かかる）

---

## 出典

- [SGP30 データシート（Sensirion 公式）](https://sensirion.com/media/documents/984E0DD5/61644B8B/Sensirion_Gas_Sensors_Datasheet_SGP30.pdf)
- [TVOC/eCO2 ガスセンサユニット（SGP30） — スイッチサイエンス](https://www.switch-science.com/products/6619)
- [Unit TVOC/eCO2 — M5Stack Docs](https://docs.m5stack.com/en/unit/tvoc)
- [Adafruit_SGP30 (Arduino library)](https://github.com/adafruit/Adafruit_SGP30)
- [chirimen-drivers（パッケージ一覧・scd40 / sgp40 実装）](https://github.com/chirimen-oh/chirimen-drivers)
- [Web I2C API 仕様（W3C Browsers and Robotics CG Draft）](https://browserobo.github.io/WebI2C/)
- [node-web-i2c I2CSlaveDevice リファレンス](https://www.chirimen.org/node-web-i2c/interfaces/I2CSlaveDevice.html)
- [node-web-i2c ソース (index.ts)](https://cdn.jsdelivr.net/npm/node-web-i2c/index.ts)
- [i2c-bus README（i2cRead / i2cWrite の定義）](https://github.com/fivdi/i2c-bus)
