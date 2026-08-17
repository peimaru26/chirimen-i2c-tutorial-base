import {requestI2CAccess,SHT40} from "chirimen";

const sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

const i2cAccess = await requestI2CAccess();
const port = i2cAccess.ports.get(1);
const sht40 = new SHT40(port, 0x44);
await sht40.init();

while (true) {
  const { humidity, temperature } = await sht40.readData();
  console.log("Humidity: "+humidity.toFixed(2)+"%,Temperature: "+temperature.toFixed(2)+"℃");
  await sleep(500);
}