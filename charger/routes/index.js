const miniprogram = require('./miniprogram');
const program = require('./program');

module.exports = (app) => {
    app.use('/index', program);
    app.use('/miniprogram', miniprogram);
}
