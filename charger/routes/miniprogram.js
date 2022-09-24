/*
    @file miniprogram.js
    @description 小程序后端
    @root /miniprogram
 */

const express = require('express');
const request = require('request');
const crypto = require('crypto');
const moment = require('moment');
const { updateUserData, WriteLog } = require('../../utils/db')
const { WX_APPID, WX_APPSECRET, WX_API } = require('../../settings')
const { getMpAccessToken } = require('../../utils/util')
const fs = require('fs')
const path = require('path')
const token_file = path.resolve(__dirname, './token.json')

let route = express.Router();

route.get('/about', (req, res) => {
    res.json({
        "version": '1.0.0'
    })
})

/**
 * GET /miniprogram/dologin/{js_code}
 */
route.get('/dologin/:js_code', (req, res) => {
    let js_code = req.params.js_code;
    if (typeof js_code == 'undefined') {
        res.status(500).send()
    } else {
        request.get(WX_API, {
            qs: {
                js_code: js_code,
                appid: WX_APPID,
                secret: WX_APPSECRET,
                grant_type: "authorization_code"
            }
        }, (err, resp, body) => {
            if (err) {
                res.status(500).send()
            } else {
                // console.log(resp)
                let resp_data = JSON.parse(body);
                console.log(resp_data)
                if (resp_data.openid && resp_data.session_key) {
                    sha1 = crypto.createHash('sha1');
                    sha1.update(resp_data.session_key);
                    let skey = sha1.digest('hex');
                    let newData = {
                        openid: resp_data.openid,
                        session_key: skey
                    }
                    if (resp_data.unionid) { newData.unionid = resp_data.unionid }
                    updateUserData(resp_data.openid, newData)
                    // WriteLog()
                    res.json({
                        "code": 0,
                        "msg": "ok",
                        "session": skey
                    })
                } else {
                    res.json({
                        "code": resp_data.errcode,
                        "msg": resp_data.errmsg
                    })
                }
            }
        })
    }
})

route.post('/apply', (req, res) => {
    res.json({ code: 0 })
})

/**
 * POST /miniprogram/sendnotification
 * 发送订阅消息
 * 消息示例：
 * {
 *     "user": "user_open_id",
 *     "template": "on",
 *     "data": {
 *         "thing1": {
 *             "value": "xxx"
 *         },
 *         "thing2": {
 *             "value": "yyy"
 *         }
 *     }
 * }
 */
route.post('/sendnotification', async (req, res) => {
    let token_data = JSON.parse(fs.readFileSync(token_file, 'UTF-8').toString())
    let template_id = ''

    console.log(req.body)

    // 参数检查
    let valid = typeof req.body.user != 'undefined' && typeof req.body.template != 'undefined' && typeof req.body.template != 'undefined'
    if (!valid) {
        res.json({
            code: 500,
            msg: 'missing_param'
        })
        return
    }

    if (req.body.template == 'on') {
        template_id = 'cSKbEvSNSqnSqiFaN60a0-pyy4S_sQO25zr4_uNitVc'
    } else if (req.body.template == 'off') {
        template_id = 'peIQ0o5LQvlOoL4JiQiTJrGr6b1zq622zi_Nk8Z16QU'
    } else {
        res.json({
            code: 500,
            msg: 'wrong_param'
        })
        return
    }

    if (typeof token_data.expires_in == 'undefined' || moment(token_data.expires_in).isSameOrBefore(moment())) {
        console.log("Token not found or expired. Get new token.")
        token_data = await getMpAccessToken()
        token_data.expires_in = moment().add(token_data.expires_in, 'seconds')
        fs.writeFileSync(token_file, JSON.stringify(token_data))
    }

    console.log("token:", token_data.access_token)

    console.log("to User:", req.body.user)
    console.log("template id:", template_id)
    console.log("req.body:")
    console.log(req.body)

    request.post('https://api.weixin.qq.com/cgi-bin/message/subscribe/send', {
    // request.post('http://192.168.2.120:7000/api', {
        qs: {
            access_token: token_data.access_token
        },
        body: JSON.stringify({
            touser: req.body.user,
            template_id: template_id,
            page: "/pages/index/index",
            lang: "zh_CN",
            data: req.body.data
        })
    }, (err, result, body) => {
        let resp_data = JSON.parse(body);
        res.json({ code: resp_data.errcode, msg: resp_data.errmsg })
    })
})

module.exports = route;