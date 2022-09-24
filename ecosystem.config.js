module.exports = {
  apps: [
    {
      name: "MQTT",
      cwd: "./mqtt",
      script: "index.js",
      autorestart: true,
      watch: false,
      out_file: './logs/mqtt.log',
      error_file: './logs/mqtt.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: "Web",
      cwd: "./charger",
      script: "index.js",
      autorestart: true,
      watch: false,
      out_file: './logs/web.log',
      error_file: './logs/web.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: "Scheduler",
      cwd: "./scheduler",
      script: "main.py",
      interpreter: '/usr/bin/python3',
      autorestart: true,
      watch: false,
      out_file: './logs/scheduler.log',
      error_file: './logs/scheduler.err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ],
};
