import { requestGPIOAccess } from "chirimen";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); // sleep 関数を定義

const gpioAccess = await requestGPIOAccess(); // GPIO を操作する
const port = gpioAccess.ports.get(26); // 26 番ポートを操作する

await port.export("out"); // ポートを出力モードに設定

// switch用
const port2 = gpioAccess.ports.get(5);
await port2.export("in");
port2.onchange = async (e) => {
  console.log(e.value);
  if (e.value == 0) {
    await port.write(1);
  } else {
    await port.write(0);
  }
};
