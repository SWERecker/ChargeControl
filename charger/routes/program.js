const express = require("express");
const moment = require("moment");
const fs = require("fs");
const path = require("path");

const route = express.Router();

const {
  get_tasks,
  add_task,
  edit_task,
  del_task,
  switch_status,
} = require("../task");
const {
  getSystemStatus,
  getHistoryData,
  getHistoryDataByMonth,
  getHistoryDetail,
  getUserData,
  getActiveJobCount,
  WriteLog,
  getConfig,
  setConfig,
} = require("../../utils/db");
const {
  get_system_uptime,
  requirePermission,
  datetime_format,
} = require("../../utils/util");
const ctrl = require("../control");

const config_file = path.resolve(__dirname, "../../system.json");

route.use((req, res, next) => {
  // console.log(req.headers)
  // console.log(req.ips)
  let auth = req.header("x-mp-auth");
  if (typeof req.header("x-from-where") == "undefined") {
    next();
  } else {
    if (typeof auth != "undefined") {
      next();
    } else {
      res.status(401).send();
    }
  }
});

const permMiddleware = (target_perm) => {
  return async (req, res, next) => {
    if (typeof req.header("x-from-where") == "undefined") {
      next();
    } else {
      let userPermission = await getUserData(
        req.header("x-mp-auth"),
        "permission"
      );
      let has_perm = requirePermission(userPermission, target_perm);
      console.log(req.url, "user:", userPermission, "has_perm:", has_perm);
      if (has_perm) {
        next();
      } else {
        res.json({
          code: 401,
        });
      }
    }
  };
};

route.get("/", (req, res) => {
  res.send("Hello World!");
});

route.get("/ping", (req, res) => {
  res.status(204).send();
});

route.get("/status", permMiddleware("VISITOR"), async (req, res) => {
  let _status = await getSystemStatus();
  _status.task_count = await getActiveJobCount();
  delete _status.boot;
  res.json(_status);
});

//route.get('/system', permMiddleware('VISITOR'), async (req, res) => {
route.get("/system", async (req, res) => {
  let sys_info = {
    controller: await getSystemStatus(),
    server: {},
  };
  if (sys_info.controller.boot && sys_info.controller.latest) {
    sys_info.controller.updays = (
      moment(sys_info.controller.latest, datetime_format).diff(
        moment(sys_info.controller.boot, datetime_format),
        "seconds"
      ) / 86400
    ).toFixed(2);
  }
  sys_info.server.updays = await get_system_uptime();
  sys_info.server.load = fs
    .readFileSync("/proc/loadavg")
    .toString()
    .substring(0, 14);

  res.json(sys_info);
});

/** GET /tasks => 任务列表 */
route.get("/tasks", permMiddleware("VISITOR"), async (req, res) => {
  let tasks = await get_tasks();
  res.json(tasks);
});

/**
 * POST /tasks/{action}
 * action = add       param: task
 *          edit      param: id and params to edit
 *          del       param: id
 *          callback  param: id, type
 * 
 * timespot task example: 
   {
        "type": "timespot",
        "time": "22:00",
        "day": 0,
        "action": 1,
        "date": "2022/08/10"  // optional
    }
 * period task example   
    {
        "type": "period",
        "start": "22:00",
        "end": "09:00",
        "start_day": 0,
        "end_day": 1,
        "action": 2,
        "start_date": "2022/08/10", // optional
        "end_date": "2022/08/11",   // optional
    }
 */
route.post("/tasks/:act", permMiddleware("MANAGER"), async (req, res) => {
  let act = req.params.act;
  let req_param = req.body;
  req_param.session = req.header("x-mp-auth");
  console.log(req.url);
  console.log(req.body);
  if (act == "add") {
    let result = await add_task(req_param);
    res.json({ code: 0, _id: result._id });
  } else if (act == "edit") {
    let result = await edit_task(req_param);
    res.json({ code: 0, modifiedCount: result });
  } else if (act == "del") {
    let result = await del_task(req_param._id);
    res.json({ code: 0, deletedCount: result });
  } else if (act == "enable") {
    req_param.status = true;
    let result = await switch_status(req_param);
    res.json({ code: 0, modifiedCount: result });
  } else if (act == "disable") {
    req_param.status = false;
    let result = await switch_status(req_param);
    res.json({ code: 0, modifiedCount: result });
  } else {
    res.json({ code: 0, msg: "unknown_action" });
  }
});

/** POST /control/on | /control/off */
route.post("/control/:act", permMiddleware("MANAGER"), async (req, res) => {
  let act = req.params.act;
  // console.log(act);
  WriteLog(req.header("x-mp-auth"), `relay_control_${act}`, `Relay: ${act}`);
  ctrl.controlRelay(act);
  res.json({ code: 0, a: act });
});

route.get("/history", permMiddleware("MANAGER"), async (req, res) => {
  console.log(req.query);
  let result = { err: "missing_param" };
  if (typeof req.query.id !== "undefined" && req.query.id != "") {
    result = await getHistoryDetail(req.query.id);
  } else if (typeof req.query.page !== "undefined" && req.query.page != "") {
    result = await getHistoryData(parseInt(req.query.page));
  } else if (
    typeof req.query.year !== "undefined" &&
    typeof req.query.month !== "undefined"
  ) {
    result = await getHistoryDataByMonth(req.query.year, req.query.month);
  }
  res.json(result);
});

route.get("/log", permMiddleware("MANAGER"), async (req, res) => {
  console.log(req.query);
  res.json({ code: 0 });
});

route.get("/config", async (req, res) => {
  let config = await getConfig(0);
  res.json(config);
});

route.get("/hasperm", permMiddleware("ADMINISTRATOR"), (req, res) => {
  res.json({ code: 0 });
});

route.post("/config", permMiddleware("ADMINISTRATOR"), async (req, res) => {
  let result = await setConfig(0, req.body);
  res.json({ code: 0, modifiedCount: result });
});

module.exports = route;
