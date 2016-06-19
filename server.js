// jshint strict:false,-W079
/* global process,console */
process.title = 'MLPVC-WS';

var PORT = 8667,
	pg = require('pg'),
	sha1 = require('sha1'),
	_ = require('underscore'),
	config = require('./config'),
	Database = new pg.Client('postgres://'+config.DB_USER+':'+config.DB_PASS+'@'+config.DB_HOST+'/mlpvc-rr'),
	moment = require('moment-timezone'),
	Server = require('socket.io'),
	express = require('express'),
	app = express(),
	LEX = require('letsencrypt-express'),
	LEX_PATH = __dirname+'/letsencrypt',
	https = require('http2'),
	cors = require('cors'),
	mkdirp = require('mkdirp');

mkdirp(LEX_PATH, function(err) {
	if (err){
		console.log('Failed to create LEX config dir');
		process.exit();
	}
});

app.use(cors());

app.get('/', function (req, res) {
  res.sendStatus(403);
});

var lex = LEX.create({
	configDir: LEX_PATH,
	letsencrypt: null,
	approveRegistration: function (hostname, cb) {
		cb(null, {
			domains: ['ws.mlpvc-rr.ml'],
			email: 'seinopsys@gmail.com',
			agreeTos: true
		});
	}
});

var server = https.createServer(lex.httpsOptions, LEX.createAcmeResponder(lex, app));
server.listen(PORT);
var io = Server.listen(server);

moment.locale('en');
moment.tz.add('Europe/Budapest|CET CEST|-10 -20|01010101010101010101010|1BWp0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00|11e6');
moment.tz.setDefault('Europe/Budapest');
function log(text){
	console.log(moment().format('YYYY-MM-DD HH:mm:ss.SSS')+' | ' + text);
}
function _respond(message, status, extra){
	var response;
	if (message === true)
		response = {status:true};
	else if (_.isObject(message) && !status && !extra){
		message.status = true;
		response = message;
	}
	else response = {
		"message": message || 'Insufficient permissions',
		"status": Boolean(status),
	};
	if (extra)
		_.extend(response, extra);
	return response;
}
function respond(fn){
	if (typeof fn !== 'function')
		return;
	fn(JSON.stringify(_respond.apply(undefined, [].slice.call(arguments,1))));
}
function queryhandle(f){
	return function(err, result){
		if(err) {
	      return console.error('error running query', err);
	    }
	    f(result.rows, result);
	};
}
function pleaseNotify(socket, userid){
	Database.query('SELECT COUNT(*) as cnt FROM notifications WHERE "user" = $1 AND read_at IS NULL', [userid], queryhandle(function(result){
		if (typeof result[0] !== 'object')
			return;

		socket.emit('notif-cnt', _respond({ cnt:parseInt(result[0].cnt,10) }));
	}));
}
function json_decode(data){
	return typeof data === 'string' ? JSON.parse(data) : data;
}

Database.connect(function(err) {
	if (err !== null) return console.log(err);

	log('@ [Database] Connection successful');
});
Database.on('error',function(err){
	console.log(err);
	if (err.fatal)
		process.exit();
});
io.on('connection', function(socket){
	//log('> Incoming connection');
	var User = {},
		userlog = function(msg){ log('['+User.id+'] '+msg) };
	socket.on('auth', function(data, fn){
		data = json_decode(data);

		var access = data.access;
		if (access === config.WS_SERVER_KEY){
			User = {id:'PHP-SERVER',role: 'server'};
			//userlog('> Connected');
			return respond(fn, 'Authenticated as PHP Server');
		}
		var token = sha1(access);
		Database.query('SELECT u.* FROM users u LEFT JOIN sessions s ON s.user = u.id WHERE s.token = $1', [token], queryhandle(function(result){
			if (typeof result[0] !== 'object')
				return respond(fn, 'Authentication failed');

			User = result[0];
			respond(fn, 'Authenticated as '+User.name, 1);
			socket.join(User.id);

			pleaseNotify(io.in(User.id), User.id);
		}));
	});
	socket.on('notify-pls',function(data, fn){
		if (User.role !== 'server')
			return respond(fn);

		data = json_decode(data);
		pleaseNotify(io.in(data.user), data.user);
	});
	socket.on('mark-read',function(data, fn){
		if (User.role !== 'server')
			return respond(fn);

		data = json_decode(data);
		Database.query('UPDATE notifications SET read_at = NOW() WHERE id = $1', [data.nid], queryhandle(function(){

			Database.query('SELECT u.id FROM users u LEFT JOIN notifications n ON n.user = u.id WHERE n.id = $1', [data.nid], queryhandle(function(result){
				var userid = result[0].id;

				pleaseNotify(io.in(userid), userid);
			}));
		}));
	});
	socket.on('disconnect', function(){
		//userlog('> Disconnected');
	});
});
