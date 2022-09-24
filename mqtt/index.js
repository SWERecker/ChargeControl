const aedes = require("aedes")();
const moment = require("moment");
const { createServer } = require("aedes-server-factory");
const db = require("../utils/db");
const { datetime_format } = require("../utils/util");
const request = require("request");
const port = 1883;

let datas = {
  start: "",
  has_data_flag: false,
  c: 0,
  lastmin: 99,
  lastmin_count: 0,
  lastmin_sum: 0,
  chrid: "",
  lastmin_min: 9999,
  lastmin_max: 0,
  idle_min: 0,
  config: {},
};

const server = createServer(aedes);

server.listen(port, function () {
  console.log("server started and listening on port", port);
});

const dataHandler = async (__data) => {
  const configs = await db.getConfig(0);
  const FACTOR = configs.factor;
  let conductor = __data.c;

  // 接触器电平发生变化
  if (datas.c !== conductor) {
    // 上升沿，开始充电了
    if (datas.c == 0 && conductor == 1) {
      console.log("start charging");

      // 先写入启动时间，获取本次充电的_id（数据库生成）
      let res = await db.updatePowerData({
        start: moment().format(datetime_format)
      });
      console.log("chrid =>", res._id);

      // 内存中datas保存这次充电的临时数据
      // 保存充电_id    chrid => _id
      datas.chrid = res._id;
      // 记录这一分钟为  lastmin
      datas.lastmin = moment().minute();

      // 读取系统设置（闲置停止充电）
      datas.config = configs;
    }

    // 下降沿，停止充电了
    if (datas.c == 1 && conductor == 0) {
      console.log("stop charging");
      let result = {};

      // 如果有数据，使数据库计算本次充电的功率平均、最大最小值
      if (datas.has_data_flag) {
        result = await db.aggregatePowerData(datas.chrid);
      }
      // 带上结束时间和上一分钟的数据
      result.end = moment().format(datetime_format);

      let current_min = moment().minute();

      // 若datas.lastmin == current_min，说明内存中的是这一分钟的数据
      // 否则，内存中的数据是上一分钟的数据
      let endmin_time = moment().subtract(1, "minute");
      if (datas.lastmin == current_min) {
        endmin_time = moment();
      }
      result.data = {
        time: endmin_time.format("YYYY/MM/DD HH:mm"),
        voltage: {
          min: datas.lastmin_min == 9999 ? 0 : datas.lastmin_min,
          max: datas.lastmin_max,
          avg: datas.lastmin_count > 0 ? Math.round(datas.lastmin_sum / 19) : 0,
        },
        power: {
          min: datas.lastmin_min == 9999 ? 0 : (FACTOR * datas.lastmin_min).toFixed(2),
          max: parseFloat((FACTOR * datas.lastmin_max).toFixed(2)),
          avg: datas.lastmin_count > 0 ? parseFloat((FACTOR * (datas.lastmin_sum / 19)).toFixed(2)) : 0,
        },
      };
      db.updatePowerData(result);

      datas.mins = "";
      datas.chrid = "";
      datas.lastmin = "";
      datas.has_data_flag = false;
      datas.idle_min = 0;
    }
  }

  // 记录接触器状态
  datas.c = conductor;

  // 若接触器接通, 记录数据
  if (conductor == 1) {
    let current_min = moment().minute();

    /**
     * lastmin_min   => 上一分钟最小值
     * lastmin_max   => 上一分钟最大值
     * lastmin_sum   => 上一分钟功率之和
     * lastmin_count => 上一分钟记录到的数据数量
     */

    if (current_min == datas.lastmin) {
      // 同一分钟内，记录分钟总和
      datas.lastmin_sum += __data.v;
      // 记录数据数量
      datas.lastmin_count++;
      // 记录最大值
      if (__data.v > datas.lastmin_max) {
        datas.lastmin_max = __data.v;
      }
      // 记录最小值
      if (__data.v < datas.lastmin_min) {
        datas.lastmin_min = __data.v;
      }
    } else {
      // 分钟发生变化且上一分钟有数据，记录至数据库内
      if (datas.lastmin_count > 0) {
        console.log("updatePowerData");
        let _toupdateData = {
          _id: datas.chrid,
          data: {
            // time => 分钟发生了变化，所以减去一分钟，为上一分钟的数据
            time: moment().subtract(1, "minute").format("YYYY/MM/DD HH:mm"),
            voltage: {
              min: datas.lastmin_min,
              max: datas.lastmin_max,
              avg: Math.round(datas.lastmin_sum / 19), // 取整
            },
            power: {
              min: parseFloat((FACTOR * datas.lastmin_min).toFixed(2)),
              max: parseFloat((FACTOR * datas.lastmin_max).toFixed(2)),
              avg: parseFloat((FACTOR * (datas.lastmin_sum / 19)).toFixed(2)),
            },
          },
        };
        db.updatePowerData(_toupdateData);
        datas.has_data_flag = true;

        // 若开启了闲置停止充电
        if (datas.config.enableAutoStopCharge) {
          // 若功率低于设定值，则开始计数
          if (_toupdateData.data.power.avg < datas.config.autoStopThreshold) {
            datas.idle_min++;
            console.log("Idle:", datas.idle_min, "min");
          } else {
            datas.idle_min = 0;
          }
          if (datas.idle_min > datas.config.autoStopChargeTime) {
            console.log("Stop charge.");
            // 发送停止信号
            aedes.publish({
              topic: "esp/control/relay",
              payload: '{"a":"off"}',
            });
          }
        }
      }

      datas.lastmin_sum = 0;
      datas.lastmin_count = 0;
      datas.lastmin = current_min;
      datas.lastmin_max = 0;
      datas.lastmin_min = 9999;
    }
  }
};

aedes.on("publish", async (packet, client) => {
  if (client) {
    // let timestamp = parseInt(Date.now() / 1000);
    // console.log(`[${moment().format("HH:mm:ss")}] | Client: ${client.id} => ${packet.topic}: ${packet.payload}`)

    if (packet.topic === "esp/status") {
      let data = JSON.parse(packet.payload.toString());
      data.latest = moment().format(datetime_format);
      db.updateSystemData(0, data);
      dataHandler(data);
    }
    if (packet.topic === "esp/ready") {
      console.log(`${moment()}:boot.`);
      db.updateSystemData(0, {
        boot: moment().format(datetime_format),
      });
    }
  }
});
