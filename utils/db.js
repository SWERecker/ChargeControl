const mongoose = require('../mqtt/node_modules/mongoose')
const moment = require('../mqtt/node_modules/moment')
const { datetime_format } = require('../utils/util')
const __page_size = 10

const statusSchema = new mongoose.Schema({
    id: Number,
    boot: Date,
    latest: Date,
    c: Number,
    v: Number
})

const chargeHistoryChildSchema = new mongoose.Schema({
    avg: [Number],
    min: [Number],
    max: [Number]
})

const chargeHistorySchema = new mongoose.Schema({
    start: Date,
    end: Date,
    p_min: Number,
    p_avg: Number,
    p_max: Number,
    p_draw: Number,
    times: [String],
    voltage: chargeHistoryChildSchema,
    power: chargeHistoryChildSchema
})

const userSchema = new mongoose.Schema({
    session_key: [String],
    openid: String,
    unionid: String,
    nickname: String,
    permission: {
        type: Number,
        default: 0
    },
})

const logSchema = new mongoose.Schema({
    time: Date,
    operator: String,
    op_nickname: String,
    action: String,
    content: String
})

const jobSchema = new mongoose.Schema({
    id: Number,
    type: String,
    status: {
        type: Boolean,
        default: false
    },
    enabled_by: String,

    date: String,   // Timespot
    day: Number,
    time: String,
    action: Number,

    start: String,  // Period
    end: String,
    start_day: Number,
    end_day: Number,
    start_date: String,
    end_date: String,
})

const configSchema = new mongoose.Schema({
    id: Number,
    factor: Number,
    enableAutoStopCharge: Boolean,
    autoStopChargeTime: Number,
    autoStopThreshold: Number
})

const SystemStatus = mongoose.model('SystemData', statusSchema);
const ChargeHistory = mongoose.model('ChargeHistory', chargeHistorySchema);
const User = mongoose.model('User', userSchema);
const Log = mongoose.model('Log', logSchema);
const Job = mongoose.model('Job', jobSchema);
const Config = mongoose.model('Config', configSchema);

const connect = async () => {
    console.log('Connect to mongodb.')
    await mongoose.connect('mongodb://localhost:27017/chargedb');
}

connect().catch(err => console.log(err));

const getSystemStatus = async (__id) => {
    const data = await SystemStatus.findOne({ id: typeof __id == 'undefined' ? 0 : __id }, { _id: 0, __v: 0 }).exec()
    let result = data ? data.toJSON() : {}
    if (result.latest) { result.latest = moment(result.latest).format(datetime_format) }
    if (result.boot) { result.boot = moment(result.boot).format(datetime_format) }
    return result
}

const updateSystemData = async (__id, __data) => {
    const res = await SystemStatus.updateOne({ id: __id }, __data, { upsert: true })
    return res.modifiedCount
}

// {data: {time: '2022/08/14 22:40', voltage: {min: 0, max: 100, avg: 50}, power: {min: 0, max: 100, avg:40}}}
const updatePowerData = async (__data) => {
    console.log(__data)
    let updateContent = {}
    if (__data.data) {
        updateContent.$push = {
            times: __data.data.time,
            'voltage.min': __data.data.voltage.min,
            'voltage.max': __data.data.voltage.max,
            'voltage.avg': __data.data.voltage.avg,
            'power.min': __data.data.power.min,
            'power.max': __data.data.power.max,
            'power.avg': __data.data.power.avg
        }
    }
    updateContent.$set = {}
    if (__data.start || __data.end) {
        if (__data.start) { updateContent.$set.start = __data.start }
        if (__data.end) { updateContent.$set.end = __data.end }
    }
    if (__data.p_min) { updateContent.$set.p_min = __data.p_min }
    if (__data.p_avg) { updateContent.$set.p_avg = __data.p_avg }
    if (__data.p_max) { updateContent.$set.p_max = __data.p_max }
    if (__data.p_draw) { updateContent.$set.p_draw = __data.p_draw }
    let res;
    if (__data._id) {
        res = await ChargeHistory.updateOne({ _id: __data._id }, updateContent, { upsert: true })
    } else {
        let newData = new ChargeHistory(__data)
        res = await newData.save()
        console.log(res)
    }
    return res
}

const aggregatePowerData = async (__id) => {
    console.log(__id)
    const aggreData = ChargeHistory.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(__id)
            }
        }, {
            $project: {
                p_avg: { $avg: "$power.avg" },
                p_min: { $min: "$power.min" },
                p_max: { $max: "$power.max" },
                p_total: { $sum: "$power.avg" }
            }
        }, {
            $project: {
                p_avg: 1,
                p_min: 1,
                p_max: 1,
                p_draw: { $divide: ["$p_total", 60] }
            }
        }
    ])
    let res = await aggreData.exec()
    console.log(res)
    res[0].p_avg = parseFloat(res[0].p_avg.toFixed(2))
    res[0].p_draw = parseFloat(res[0].p_draw.toFixed(2))
    return res[0]
}

const getHistoryData = async (__page) => {
    let queryRes = await ChargeHistory.find({ end: { $exists: true } }, { __v: 0, times: 0, power: 0, voltage: 0 }).limit(__page_size).skip(__page * __page_size).sort({ _id: -1 }).exec()
    return queryRes
}

const getHistoryDataByMonth = async (__year, __month) => {
    let queryRes = await ChargeHistory.find({
        start: {
            $gte: moment().year(parseInt(__year)).month(parseInt(__month) - 1).startOf('month').toISOString(),
            $lte: moment().year(parseInt(__year)).month(parseInt(__month) - 1).endOf('month').toISOString()
        }
    }, { __v: 0, times: 0, power: 0, voltage: 0 }).sort({ _id: -1 }).exec()
    return queryRes
}

const getHistoryDetail = async (__id) => {
    let queryRes = await ChargeHistory.findOne({ _id: __id }, { _id: 0, __v: 0, id: 0, start: 0, end: 0, 'power._id': 0, 'voltage._id': 0 }).exec()
    return queryRes ? queryRes.toJSON() : {}
}

/**
 * 修改用户信息
 * @param {String} __openid 用户的openid
 * @param {Object} __data 需要修改的数据
 * @returns 
 */
const updateUserData = async (__openid, __data) => {
    let session = __data.session_key
    delete __data.session_key
    let toUpdateData = {
        $set: __data,
        $addToSet: {
            session_key: session
        }
    }
    const res = await User.updateOne({ openid: __openid }, toUpdateData, { upsert: true })
    return res.modifiedCount
}

/**
 * 获取用户信息.
 * @param {String} __session 用户的session_key
 * @param {String} target 所需要的参数(Default: '')
 * @returns 用户信息Object | 所需要的参数
 */
const getUserData = async (__session, target = '') => {
    const res = await User.findOne({ session_key: { $elemMatch: { $eq: __session } } }, { _id: 0, __v: 0 }).exec()
    let result = res ? res.toJSON() : {}
    if (target != '') {
        return result[target]
    }
    return result
}

/**
 * 添加任务.
 * @param {Object} __data 所添加的任务信息
 * @returns 新添加的Document
 */
const addJob = async (__data) => {
    console.log("addJob got:")
    console.log(__data)
    let newJob = new Job(__data)
    let userOpenid = await getUserData(__data.session, 'openid')
    newJob.enabled_by = userOpenid
    newJob.status = true
    return await newJob.save()
}

/**
 * 编辑任务.
 * @param {Object} __data 所编辑任务的信息
 * @returns 修改的文档数量（1为成功）
 */
const editJob = async (__data) => {
    let id = __data._id
    delete __data._id
    const res = await Job.updateOne({ _id: id }, __data)
    return res.modifiedCount
}

/**
 * 
 * @param {*} __id 
 * @param {*} __operator 
 * @param {*} newStatus 
 * @returns 
 */
const switchJobStatus = async (__id, __session, newStatus) => {
    let userOpenid = await getUserData(__session, 'openid')
    const res = await Job.updateOne({ _id: __id }, {
        status: newStatus,
        enabled_by: userOpenid
    })
    return res.modifiedCount
}

/**
 * 删除任务.
 * @param {Number} __id 任务的id
 * @returns 删除的文档数量（1为成功）
 */
const delJob = async (__id) => {
    const res = await Job.deleteOne({ _id: __id })
    console.log(res)
    return res.deletedCount
}

/**
 * 获取任务列表.
 * @returns {Array<String>} 任务列表
 */
const getJobs = async () => {
    const res = await Job.find({}, { __v: 0 }).exec()
    return res
}

/**
 * 获取启动的任务数量
 * @returns {Number} status为true的任务数量
 */
const getActiveJobCount = async () => {
    const res = await Job.countDocuments({ status: true }).exec();
    return res
}

/**
 * 写入日志.
 * @param {String} __operator 操作人
 * @param {String} __action 操作
 * @param {String} __content 详细内容
 */
const WriteLog = async (__operator, __action, __content) => {
    toInsert = {
        operator: __operator,
        time: moment(),
        content: __content
    }
    let user = await getUserData(__operator)
    if (user.nickname) { toInsert.op_nickname = user.nickname }
    let log = new Log(toInsert)
    log.save()
}

const getConfig = async (__id, __key = '') => {
    const res = await Config.findOne({ id: __id }, { _id: 0, __v: 0 }).exec()
    if (__key != '') {
        return res[__key]
    }
    return res
}

const setConfig = async (__id, __data) => {
    const res = await Config.updateOne({ id: __id }, __data, { upsert: true })
    return res.modifiedCount
}

module.exports = {
    getSystemStatus,
    updateSystemData,

    updatePowerData,
    aggregatePowerData,

    getHistoryData,
    getHistoryDetail,
    getHistoryDataByMonth,

    updateUserData,
    getUserData,

    WriteLog,

    addJob,
    editJob,
    delJob,
    getJobs,
    getActiveJobCount,
    switchJobStatus,

    getConfig,
    setConfig
}