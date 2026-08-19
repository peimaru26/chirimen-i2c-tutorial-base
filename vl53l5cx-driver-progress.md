# VL53L5CX CHIRIMEN Driver 開発進捗まとめ

作成日: 2026-08-18

## タスク概要
CHIRIMEN（node-web-i2c）向けに、ToF測距センサー VL53L5CX (SparkFun Qwiic Mini ToF Imager, [switch-science #7934](https://www.switch-science.com/products/7934)) のドライバをコントリビュートする。

## 開発環境
- 対象ボード: Raspberry Pi Zero 2 W（ホスト: `pi@pz01`）
- OS: Raspberry Pi OS Lite (Trixie, 64bit)
- Node.js: v24.19.0（NodeSource経由でインストール）
- 作業ディレクトリ: `~/vl53l5cx-driver/`（Pi上）
- I2C: `raspi-config`で有効化済み、センサーは`0x29`で認識（`i2cdetect -y 1`で確認済み）

## 進捗ステータス（9ステップ中）

| # | ステップ | 状態 |
|---|---|---|
| 1 | デバイス選定 | ✅ 完了（VL53L5CX） |
| 2 | データシート・他PF調査 | ✅ 完了 |
| 3 | Web I2C API仕様の把握 | ✅ 完了 |
| 4 | Example作成 | ✅ 完了（`vl53l5cx-example.mjs`） |
| 5 | Driver作成 | ✅ 完了（`vl53l5cx.js`） |
| 6 | Raspi実機でのデバッグ | ✅ 概ね完了（実データ取得成功、物理的な妥当性確認済み） |
| 7 | CHIRIMENコミュニティ作法でのコントリビュート | ❌ 未着手 |
| 8 | コミュニティレビュー対応 | ❌ 未着手 |
| 9 | マージ | ❌ 未着手 |

## 主要な技術的知見

### デバイス仕様
- VL53L5CX、8×8マルチゾーンToF、I2Cアドレス`0x29`（7bit）、電圧2.7〜3.3V
- レジスタは**16bitアドレス**でインデックスされる（一般的な8bitレジスタ前提のデバイスと異なる）

### Web I2C API / node-web-i2cの制約
- `write8`/`read8`は内部でSMBus形式（1バイトレジスタアドレス前提）を使っており、VL53L5CXの16bitアドレスには**使用不可**
- 代わりにnode-web-i2c独自拡張の`writeBytes`/`readBytes`でレジスタアドレスを自前のバイト列として組み立てる必要がある
- node-web-i2cの`writeBytes`→`readBytes`は別々のI2Cトランザクション（STOP→START）になる。VL53L5CXでは今のところ問題なく動作している

### ファームウェア関連
- VL53L5CXは初期化(`init()`)時に**約84KB(86016バイト)のファームウェアをI2C経由でRAMに転送**する必要がある（ULD API方式）
- ファームウェア/設定データは[ST公式ULDドライバ](https://www.st.com/resource/en/user_manual/um2884-a-guide-to-using-the-vl53l5cx-multizone-timeofflight-ranging-sensor-with-a-wide-field-of-view-ultra-lite-driver-uld-stmicroelectronics.pdf)由来、**BSD-3-clauseとのデュアルライセンス**（SparkFun版はBSD-3-clauseとして公開）なので再配布・改変可能
- バイナリは2つの独立した情報源（[Abstract-Horizon/vl53l5cx_python](https://github.com/Abstract-Horizon/vl53l5cx_python)のPython版と、[SparkFun Arduinoライブラリ](https://github.com/sparkfun/SparkFun_VL53L5CX_Arduino_Library)のCヘッダー版）を突き合わせてバイト単位で検証済み
- 検証時、SparkFun版CヘッダーをC言語マクロ(`VL53L5CX_FW_NBTAR_RANGING`)を考慮せず単純な正規表現で抽出すると1バイトずれて設定データが壊れることが判明。Python版（`self.VL53L5CX_FW_NBTAR_RANGING`を`2`に置換）を正としている

### ドライバ移植で踏んだ罠
- Python版`get_ranging_data()`の`for i in range(16, data_read_size, 4): ... i += msize`は、Pythonの`for`-`range`ループでは**ループ変数への再代入が次周回に反映されない**ため、実際には`msize`分のジャンプではなく**常に4バイトずつ全域をスキャンする**動作になっている
- これをそのまま「意図した動き」としてJSに移植（`i += msize`でジャンプする実装）してしまい、`distanceMm`/`targetStatus`が常に0になるバグが発生。単純に4バイトずつインクリメントする実装に修正して解決

### 実機での動作確認結果
- `isAlive()` → `true`
- `init()`（ファームウェア転送含む） → エラーなく完走
- `startRanging()` → 成功
- `distanceMm`/`targetStatus`を取得 → 値が変動し、物理的に妥当（近距離のゾーンは数mm、範囲外のゾーンは飽和値`0xFFFF/4≈16383.75`付近）
- ⚠️ センサー前面の保護テープが貼られたままの可能性を指摘済み、手をかざしての最終物理テストは未実施

### 現在のドライバのスコープ（MVP）
- 解像度は4×4固定（8×8は未対応）
- `nb_target_per_zone = 1`固定
- 出力は`distanceMm`と`targetStatus`のみ（ambient, signal, sigma, reflectance, motion indicator等は無効化）

## 成果物の場所
- Mac側（検証済み・syntaxチェック済み）: `/private/tmp/claude-503/-Users-x-sh-ueda/cde84d3b-9a99-4c8a-aa31-2411802e4d72/scratchpad/`
  - `vl53l5cx.js`（ドライバ本体）
  - `vl53l5cx-example.mjs`（使用例、4x4グリッド表示対応）
  - `deploy/`（配布用一式、firmware/ディレクトリに検証済みバイナリ4種を含む）
- Pi側: `~/vl53l5cx-driver/`に展開済み、動作確認済み

⚠️ 上記Mac側のscratchpadはセッション固有の一時ディレクトリのため、消える可能性がある。**恒久的に残したい場合は別途Gitリポジトリ等に保存すること。**

## 次のアクション候補
1. 保護テープ除去・手をかざしての最終物理テスト
2. Step7: CHIRIMEN既存ドライバ（例: `@chirimen/adt7410`）の構成・命名規則・コントリビュートガイドを調査
3. リポジトリ構成をCHIRIMEN作法に合わせて整備（`package.json`、README、`@chirimen/vl53l5cx`パッケージ名など）
4. 8×8解像度対応や他の出力フィールド対応をコントリビュート前に追加するか検討
5. PR作成 → レビュー対応 → マージ
