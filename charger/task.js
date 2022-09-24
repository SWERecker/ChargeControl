const request = require('request')
const { addJob, editJob, delJob, getJobs, switchJobStatus } = require('../utils/db')

const sche_server = 'http://127.0.0.1:5583/'

const add_task = async (param) => {
    let res = await addJob(param)
    sche_reload_task()
    return res
}

const edit_task = async (param) => {
    let res = await editJob(param)
    sche_reload_task()
    return res
}

const del_task = async (id) => {
    let res = await delJob(id)
    sche_reload_task()
    return res
}

const get_tasks = async () => {
    let res = await getJobs()
    return res
}

const switch_status = async (param) => {
    if (typeof param._id != 'undefined' && typeof param.session != 'undefined' && typeof param.status != 'undefined') {
        let result = await switchJobStatus(param._id, param.session, param.status)
        sche_reload_task()
        return result
    }
    return -1
}

const sche_reload_task = () => {
    request.post(sche_server + 'reload')
}

module.exports = {
    add_task, edit_task, del_task, get_tasks, switch_status
}