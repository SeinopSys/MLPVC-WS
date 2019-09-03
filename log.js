const moment = require('./moment-setup');
module.exports = text => console.log(moment().format('YYYY-MM-DD HH:mm:ss.SSS')+' | ' + text);
