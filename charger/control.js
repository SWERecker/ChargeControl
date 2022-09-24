const mqtt = require("mqtt");
const moment = require('moment');

const client = mqtt.connect("mqtt://127.0.0.1:1883")

client.on("connect", () => {
    console.log("服务器连接成功")
    // client.subscribe("esp/#", { qos: 0 })
})

const controlRelay = action => {
    client.publish("esp/control/relay", `{"a":"${action}"}`);
}

// client.on("message", (topic, message) => {
//   let tpc = topic.toString();
//   let msg = message.toString();
//   // console.log(tpc, "=>", msg)
//   if (tpc === "esp/status") {
//     // console.log("status_update")
//     stat_json = JSON.parse(msg)
//     stat_json.time = moment().format("HH:mm:ss")
//     status = JSON.stringify(stat_json);
//     // console.log(stat_json)
//   }
// })

module.exports = {
    controlRelay
}