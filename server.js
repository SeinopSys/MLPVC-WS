// jshint strict:false,-W079
/* global process,console */
process.title = 'MLPVC-WS';

const
	PORT = 8667,
	fs = require('fs'),
	pg = require('pg'),
	_ = require('underscore'),
	config = require('./config'),
	moment = require('moment-timezone'),
	Server = require('socket.io'),
	express = require('express'),
	https = require('http2'),
	cors = require('cors'),
	createHash = require('sha.js'),
	sha256hash = data => createHash('sha256').update(data, 'utf8').digest('hex'),
	POST_UPDATES_CHANNEL = 'post-updates';

let Database = new pg.Client('postgres://'+config.DB_USER+':'+config.DB_PASS+'@'+config.DB_HOST+'/mlpvc-rr'),
	app = express();

// CORS
app.use(cors(function(req, callback){
	let corsOptions = { origin: false };
	if (/^https:\/\/mlpvc-rr\.(ml|lc)/.test(req.header('Origin')))
		corsOptions.origin = true;
	callback(null, corsOptions);
}));

app.get('/', function (req, res) {
	res.sendStatus(403);
});

let server;
if (config.LOCALHOST === true){
	server = https.createServer({
		cert: fs.readFileSync(config.SSL_CERT),
		key: fs.readFileSync(config.SSL_KEY),
	}, app);
}
else {
	let lex = require('greenlock-express').create({
		server: 'https://acme-v01.api.letsencrypt.org/directory',
		email: 'seinopsys@gmail.com',
		agreeTos: true,
		approveDomains: [ 'ws.mlpvc-rr.ml'],
	});
	server = https.createServer(lex.httpsOptions, lex.middleware(app));
}
server.listen(PORT);
let io = Server.listen(server);

moment.locale('en');
moment.tz.add('Europe/Budapest|CET CEST|-10 -20|01010101010101010101010|1BWp0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00 11A0 1o00 11A0 1qM0 WM0 1qM0 WM0 1qM0 11A0 1o00 11A0 1o00|11e6');
moment.tz.setDefault('Europe/Budapest');
function log(text){
	console.log(moment().format('YYYY-MM-DD HH:mm:ss.SSS')+' | ' + text);
}
function _respond(message, status, extra){
	let response;
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

		socket.emit('notif-cnt', _respond({ cnt: parseInt(result[0].cnt,10) }));
	}));
}
function json_decode(data){
	return typeof data === 'string' ? JSON.parse(data) : data;
}
function findAuthCookie(socket){
	if (!socket.handshake.headers.cookie || !socket.handshake.headers.cookie.length)
		return;
	let cookieArray = socket.handshake.headers.cookie.split('; '),
		cookies = {};
	for (let i=0; i<cookieArray.length; i++){
		let split = cookieArray[i].split('=');
		cookies[split[0]] = split[1];
	}
	return cookies.access;
}
const getGuestID = (socket) => 'Guest#'+socket.id;

Database.connect(function(err) {
	if (err !== null){
		log('[Database] Connection failed, exiting ('+err+')');
		return process.exit();
	}

	log('[Database] Connection successful');
});
Database.on('error',function(err){
	console.log(err);
	if (err.fatal)
		process.exit();
});
io.on('connection', function(socket){
	//log('> Incoming connection');
	let User = { id: getGuestID(socket) },
		inrooms = {},
		joinroom = room => {
			socket.join(room);
			inrooms[room] = true;
		},
		leaveroom = room => {
			socket.leave(room);
			delete inrooms[room];
		},
		isGuest = () => typeof User.role === 'undefined',
		userlog = function(msg){ log('['+User.id+'] '+msg) },
		authByCookie = () => {
			let access = findAuthCookie(socket);
			if (access === config.WS_SERVER_KEY){
				User = { id: 'Web Server', role: 'server'};
				userlog('> Authenticated');
			}
			else if (typeof access === 'string' && access.length){
				let token = sha256hash(access);
				Database.query('SELECT u.* FROM users u LEFT JOIN sessions s ON s.user = u.id WHERE s.token = $1', [token], queryhandle(function(result){
					if (typeof result[0] !== 'object'){
						socket.emit('auth-guest');
						return;
					}

					User = result[0];

					let isServer = User.role === 'server';
					if (!isServer){
						socket.join(User.id);
						userlog('> Authenticated');
					}
					socket.emit('auth', _respond({ name: User.name }));
					if (!isServer)
						pleaseNotify(socket, User.id);
				}));
			}
			else socket.emit('auth-guest');
		};

	authByCookie();

	socket.on('notify-pls',function(data, fn){
		if (User.role !== 'server')
			return respond(fn);

		userlog('> Sent notification count to '+data.user);

		data = json_decode(data);
		pleaseNotify(io.in(data.user), data.user);
	});
	socket.on('mark-read',function(data, fn){
		if (User.role !== 'server')
			return respond(fn);

		data = json_decode(data);
		Database.query('UPDATE notifications SET read_at = NOW(), read_action = $2 WHERE id = $1', [data.nid, data.action], queryhandle(function(){

			userlog('> Marked notification &'+data.nid+' read');

			Database.query('SELECT u.id FROM users u LEFT JOIN notifications n ON n.user = u.id WHERE n.id = $1', [data.nid], queryhandle(function(result){
				let userid = result[0].id;

				pleaseNotify(io.in(userid), userid);
			}));
		}));
	});
	socket.on('notify-pls',function(data, fn){
		if (User.role !== 'server')
			return respond(fn);

		userlog('> Sent notification count to '+data.user);

		data = json_decode(data);
		pleaseNotify(io.in(data.user), data.user);
	});
	socket.on('unauth',function(data, fn){
		if (isGuest())
			return respond(fn);

		let oldid = User.id;
		User = { id: getGuestID(socket) };
		userlog(`> Unauthenticated (was ${oldid})`);
		respond(fn, true);
		socket.emit('auth-guest');
	});
	socket.on('status',function(data, fn){
		if (config.LOCALHOST !== true)
			return respond(fn);

		respond(fn, { User, rooms: Object.keys(inrooms) });
	});
	const postaction = (what) => function(data){
		if (User.role !== 'server')
			return respond(fn);

		data = json_decode(data);
		userlog(`> Post ${what.replace(/e?$/,'ed')} (${data.type}-${data.id})`);
		io.in(POST_UPDATES_CHANNEL).emit('post-'+what,data);
	};
	socket.on('post-add',postaction('add'));
	socket.on('post-update',postaction('update'));
	socket.on('post-delete',postaction('delete'));
	socket.on('post-updates',function(data, fn){
		if (User.role === 'server')
			return respond(fn);

		let action;
		switch(data){
			case "true":
				joinroom(POST_UPDATES_CHANNEL);
				action = 'Joined';
			break;
			case "false":
				leaveroom(POST_UPDATES_CHANNEL);
				action = 'Left';
			break;
			default: return;
		}
		let msg = action+' '+POST_UPDATES_CHANNEL+' notification channel';
		userlog('> '+msg);
		return respond(fn, msg, 1);
	});
	socket.on('disconnect', function(){
		if (isGuest() || User.role === 'server')
			return;

		userlog('> Disconnected');
	});
});
