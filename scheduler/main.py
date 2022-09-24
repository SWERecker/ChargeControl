from flask import Flask
from flask_apscheduler import APScheduler
import datetime
import pymongo
import requests
import time
import threading
import pytz
import sys
from gevent import pywsgi

from warnings import filterwarnings
from pytz_deprecation_shim import PytzUsageWarning
filterwarnings('ignore', category=PytzUsageWarning)


app = Flask(__name__)
scheduler = APScheduler()

tzinfo = pytz.timezone('Asia/Shanghai')

mongo_client = pymongo.MongoClient('localhost', tz_aware=True, tzinfo=tzinfo)
db = mongo_client['chargedb']
col = db['jobs']
sys = db['systemdatas']
cfg = db['configs']
send_command = 'http://127.0.0.1:5580/index/control/'
send_notificaiton_url = 'http://127.0.0.1:5580/miniprogram/sendnotification'


def get_sys_config(_key = ''):
    config = cfg.find_one({'id': 0})
    if not _key == '':
        return config.get(_key)
    return config


def send_notificaiton(user_openid, action):
    sys_data = sys.find_one({'id': 0})
    # print('conductor:', sys_data['c'], 'voltage:', sys_data['v'])
    # print('sending to user:', user_openid, 'for action:', action)
    current_conductor_status = '吸合' if sys_data['c'] == 1 else '断开'
    to_send_data = {
        "user": user_openid,
        "template": action,
        "data": {}
    }
    current_power = round(get_sys_config('factor') * sys_data['v'], 2)

    if action == 'on':
        to_send_data['data'] = {
            "thing1": {
                "value": "智能充电桩"
            },
            "thing3": {
                "value": f"定时充电已开始"
            },
            "time4": {
                "value": time.strftime("%Y-%m-%d %H:%M", time.localtime())
            },
            "thing5": {
                "value": f"当前状态：{current_conductor_status}，功率：{current_power}kW"
            }
        }
    else:
        to_send_data['data'] = {
            "thing1": {
                "value": "智能充电桩"
            },
            "thing2": {
                "value": f"定时充电已结束，当前状态：{current_conductor_status}"
            },
            "time4": {
                "value": time.strftime("%Y-%m-%d %H:%M", time.localtime())
            }
        }
    # print('to_send_data:')
    # print(to_send_data)
    res = requests.post(send_notificaiton_url, json=to_send_data)
    # print(res.text)
    return res.text


def publish_command(action):
    requests.post(send_command + action,
                  headers={'x-mp-auth': 'Scheduled-Task'})
    print('publish task:', action)
    pass


def set_job_status(_id, new_status):
    col.update_one({'_id': _id}, {'$set': {'status': new_status}})


def task_on(id, job_type, enabled_by):
    # print(id, job_type)
    print("task on exec!")
    publish_command('on')
    s = threading.Timer(30, send_notificaiton, (enabled_by, 'on'))
    s.start()
    if job_type == 'timespot':
        set_job_status(id, False)


def task_off(id, job_type, enabled_by):
    # print(id, job_type)
    publish_command('off')
    # print("task off exec!")
    set_job_status(id, False)
    s = threading.Timer(30, send_notificaiton, (enabled_by, 'off'))
    s.start()
    

def controller_restart():
    publish_command('restart')


def load_jobs():
    tasks = []
    _tasks = col.find({'status': True}, {'__v': 0})
    for task in _tasks:
        tasks.append(task)
    # print(tasks)
    scheduler.remove_all_jobs()
    scheduler.add_job(func=controller_restart, id='cron_restart', trigger='cron', hour=14,minute=00)
    for task in tasks:
        try:
            if task['type'] == 'timespot':
                action = task_on if task['action'] == 0 else task_off
                action_date = (datetime.date.today() + datetime.timedelta(days=task['day'])).strftime('%Y-%m-%d')

                if datetime.datetime.strptime(f"{action_date} {task['time']}", '%Y-%m-%d %H:%M') < datetime.datetime.now():
                    print('skip this task since expired already. Set job status to false')
                    set_job_status(task['_id'], False)
                else:
                    print('adding task:', task['_id'], task['type'], task['action'], action_date, task['time'])
                    scheduler.add_job(
                        func=action,
                        id=f"{task['_id']}.timespot.{task['action']}",
                        args=[task['_id'], task['type'], task['enabled_by']],
                        trigger='date',
                        run_date=f"{action_date} {task['time']}",
                        replace_existing=True
                    )
                    col.update_one(
                        {'_id': task['_id']},
                        {'$set': { 'run_date': tzinfo.localize(datetime.datetime.strptime(f"{action_date} {task['time']}", '%Y-%m-%d %H:%M')).astimezone(pytz.utc) }},
                        upsert=True
                    )

            elif task['type'] == 'period':
                action_start_date = (datetime.date.today() + datetime.timedelta(days=task['start_day'])).strftime('%Y-%m-%d')
                action_end_date = (datetime.date.today() + datetime.timedelta(days=task['end_day'])).strftime('%Y-%m-%d')
                start_expired = False
                end_expired = False

                print('adding task:', task['_id'], task['type'], f"{action_start_date} {task['start']} ~", f"{action_end_date} {task['end']}")

                if datetime.datetime.strptime(f"{action_start_date} {task['start']}", '%Y-%m-%d %H:%M') < datetime.datetime.now():
                    print('skip:', f"{action_start_date} {task['start']}", ': expired.')
                    start_expired = True
                else:
                    scheduler.add_job(
                        func=task_on, 
                        id=f"{task['_id']}.period.0", 
                        trigger='date', 
                        args=[task['_id'], task['type'], task['enabled_by']],
                        run_date=f"{action_start_date} {task['start']}", 
                        replace_existing=True
                    )
                    col.update_one(
                        {'_id': task['_id']}, 
                        {'$set': {
                            'run_date_start': tzinfo.localize(datetime.datetime.strptime(f"{action_start_date} {task['start']}", '%Y-%m-%d %H:%M')).astimezone(pytz.utc) 
                             }
                         },
                        upsert=True
                    )

                if datetime.datetime.strptime(f"{action_end_date} {task['end']}", '%Y-%m-%d %H:%M') > datetime.datetime.now():
                    scheduler.add_job(
                        func=task_off, 
                        id=f"{task['_id']}.period.1", 
                        trigger='date', 
                        args=[task['_id'], task['type'], task['enabled_by']],
                        run_date=f"{action_end_date} {task['end']}", 
                        replace_existing=True
                    )
                    col.update_one(
                        {'_id': task['_id']}, 
                        {'$set': {
                            'run_date_end': tzinfo.localize(datetime.datetime.strptime(f"{action_end_date} {task['end']}", '%Y-%m-%d %H:%M')).astimezone(pytz.utc) 
                            }
                         },
                        upsert=True
                    )
                else:
                    print('skip:', f"{action_end_date} {task['end']}", ': expired.')
                    end_expired = True
                if start_expired and end_expired:
                    set_job_status(task['_id'], False)
            else:
                print('unknown task type.')
        except Exception as e:
            print('Failed to load task:', task['_id'], repr(e))
    print('Loaded', len(scheduler.get_jobs()), 'jobs.')


@app.route("/jobs", methods=["GET"])
def list_tasks():
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({"id": job.id, "trigger": str(job.trigger)})
    return {"code": 0, "jobs": jobs}


@app.route("/reload", methods=["POST"])
def task_change_callback():
    load_jobs()
    return {"code": 0}


if __name__ == '__main__':
    scheduler.init_app(app=app)
    scheduler.start()
    load_jobs()
    # app.run(host='0.0.0.0', port=5583, debug=False)
    try:
        server = pywsgi.WSGIServer(('0.0.0.0', 5583), app)
        print('running at 127.0.0.1:5583')
        server.serve_forever()
    except KeyboardInterrupt:
        server.stop()
        server.close()
        print('bye!')
    
