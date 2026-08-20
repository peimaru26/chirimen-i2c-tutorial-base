# ドライバ追加 入力シート

## 基本情報

- device（必須）: sgp30
- display_name（必須）: SGP30
- interface（必須）: i2c

## リポジトリのパス

- プロトタイピングリポジトリのパス（必須）: /Users/x-sh-ueda/IS/chirimen-i2c-tutorial-base
- index.jsの元にするファイル（任意）: SGP30/sgp30.js
- 個人Forkした chirimen-drivers のローカルパス（必須）: /Users/x-sh-ueda/IS/chirimen-drivers

## I2Cアドレス

- アドレス: 0x58

## デバイスの説明（必須）

Sensirion SGP30 を搭載した室内空気品質センサ。eCO2（CO2相当値、ppm）と TVOC（総揮発性有機
化合物、ppb）を I2C で取得できる。センサー素子の生信号（水素・エタノール）も読み出せる。
動作確認は M5Stack の TVOC/eCO2 ガスセンサユニット（SKU: U088、HY2.0-4P / Grove 互換
コネクタ）で行った。I2Cアドレスは 0x58 固定で変更できない。

使用上の注意が3点ある。

1. init() 直後の約15秒間は初期化フェーズで、eCO2 = 400ppm / TVOC = 0ppb の固定値が返る。
   この間センサーは測定していないため、値を捨てる必要がある。生信号（readRaw）は
   ベースライン補正を受けないため、この期間も実際の値が返る（ただしヒーター暖機中）。
2. read() は約1秒間隔で呼び続ける必要がある。動的ベースライン補正アルゴリズムが
   この周期を前提にしており、間隔が乱れると補正が正しく働かない。
3. eCO2 は本物の CO2 濃度ではない。SGP30 は MOX（金属酸化物）方式で CO2 を直接検出できず、
   室内では CO2 と他のガスが一緒に増えるという相関から推定した値である。換気の指標には
   使えるが、CO2 濃度計としては使えない。アルコールを近づけると CO2 が増えていないのに
   数千 ppm を示す。

配線上の注意として、M5Stack U088 は 5V と表示されているが、Raspberry Pi に接続する場合は
VCC を 3.3V ピンに繋ぐ。基板上のレベルシフタ（BSS138）の高圧側プルアップがコネクタの
VCC ピンに接続されているため、I2C のロジックレベルが VCC に与えた電圧に追従する。5V を
与えると Pi の SDA/SCL に 5V が乗り、GPIO を破損させるおそれがある。SGP30 チップ本体
（1.62〜1.98V）は基板上の LDO（RT9193-1.8V）から駆動されるため、VCC 3.3V で問題ない。

## 参考情報

- データシートURL（任意）: https://sensirion.com/media/documents/984E0DD5/61644B8B/Sensirion_Gas_Sensors_Datasheet_SGP30.pdf
- 参考にした実装元URL（任意）: https://github.com/adafruit/Adafruit_SGP30

## Fork先URL

- 個人Fork（必須）: https://github.com/peimaru26/chirimen-drivers