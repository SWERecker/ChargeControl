const { exec } = require("child_process");
const moment = require('../mqtt/node_modules/moment')
const { WX_APPID, WX_APPSECRET } = require('../settings')
const request = require('../mqtt/node_modules/request')

const app_perm = {
    "VISITOR": 0,
    "MANAGER": 1,
    "ADMINISTRATOR": 2
}

const get_system_uptime = async () => {
    let uptime_since = await new Promise(resolve => {
        exec("uptime -s", (err, stdout, stderr) => {
            resolve(stdout);
        });
    })
    return (moment().diff(moment(uptime_since, 'YYYY-MM-DD HH:mm:ss'), 'seconds') / 86400).toFixed(2)
}

const clone = (source) => {
    return JSON.parse(JSON.stringify(source));
}

const codeToErrMsg = code => {
    let msg = `未知错误代码：${code}`
    if (code == -1) {
        msg = "系统繁忙，请稍后再试"
    } else if (code == 45011) {
        msg = "达到频率限制"
    } else if (code == 40029) {
        msg = "code 无效"
    } else if (code == 40029) {
        msg = "高风险等级用户，小程序登录拦截"
    }
    return msg
}

const requirePermission = (perm, target_perm) => {
    // console.log(perm, '>=', app_perm[target_perm], '?')
    if (typeof perm == 'undefined' || typeof target_perm == 'undefined') {
        return false
    }
    return perm >= app_perm[target_perm]
}

const getMpAccessToken = async () => {
    return new Promise(resolve => {
        request.get('https://api.weixin.qq.com/cgi-bin/token', {
            qs: {
                "grant_type": "client_credential",
                "appid": WX_APPID,
                "secret": WX_APPSECRET
            }
        }, (err, resp, body) => {
            resolve(JSON.parse(body))
        })
    })
}

module.exports = {
    get_system_uptime,
    clone,
    codeToErrMsg,
    requirePermission,
    getMpAccessToken,
    datetime_format: 'YYYY/MM/DD HH:mm:ss'
}